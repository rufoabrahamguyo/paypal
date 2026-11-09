// Escrow operations: the only place that moves an order between states, and
// the only place that calls the money-moving PayPal endpoints.
//
//   Pal-Lock:  INITIATED -> HELD -> SHIPPED -> INSPECTED -> RELEASED
//                         \-> VOIDED
//                         \________\__________\______-> DISPUTED -> RESOLVED_*
//   Checkout:  INITIATED -> PAID
import { config } from './config.js';
import { paypalCharge } from './countries.js';
import * as paypal from './paypal.js';
import {
  getOrder, getListing, getSeller, getApp, insertOrder, updateOrder, recordTransition, recordNote, orderEvents, paypalCalls,
  disputesForOrder, sellerHistory, externalListingId, insertAppEvent, holdsDueForReauthorization,
} from './db.js';

export const TRANSITIONS = {
  INITIATED: ['HELD', 'PAID'],
  HELD: ['SHIPPED', 'RELEASED', 'DISPUTED', 'VOIDED'],
  SHIPPED: ['INSPECTED', 'RELEASED', 'DISPUTED'],
  INSPECTED: ['RELEASED', 'DISPUTED'],
  DISPUTED: ['RESOLVED_RELEASE', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND'],
  PAID: [],
  RELEASED: [],
  VOIDED: [],
  RESOLVED_RELEASE: [],
  RESOLVED_PARTIAL: [],
  RESOLVED_REFUND: [],
};

export class EscrowError extends Error {
  constructor(message, status = 409) {
    super(message);
    this.status = status;
  }
}

function assertCan(order, to) {
  if (!order) throw new EscrowError('Order not found', 404);
  if (!TRANSITIONS[order.state]?.includes(to)) {
    throw new EscrowError(`Cannot move order ${order.id} from ${order.state} to ${to}`);
  }
}

// Serialize money-moving work per order so a double click can't race itself.
const locks = new Map();
async function withLock(orderId, fn) {
  const prev = locks.get(orderId) ?? Promise.resolve();
  let release;
  const mine = new Promise((r) => (release = r));
  locks.set(orderId, prev.then(() => mine));
  await prev;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(orderId) === mine) locks.delete(orderId);
  }
}

const round2 = (n) => Math.round(n * 100) / 100;
const fee = (captured) => round2((captured * config.platformFeeBps) / 10_000);

function optionOf(value) {
  if (value == null || value === '') return 'pal_lock';
  if (value === 'pal_lock' || value === 'checkout') return value;
  throw new EscrowError('option must be "pal_lock" or "checkout"', 400);
}

function httpUrl(value, name) {
  if (!value) return null;
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new EscrowError(`${name} must be an http(s) URL`, 400);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new EscrowError(`${name} must be an http(s) URL`, 400);
  return url.toString();
}

export function paymentPublic(order) {
  if (!order) return null;
  return {
    id: order.id,
    option: order.payment_option || 'pal_lock',
    state: order.state,
    amount: order.amount,
    currency: order.currency,
    description: order.description,
    reference: order.external_reference,
    approval_url: order.state === 'INITIATED' ? order.approval_url : null,
    authorization_id: order.authorization_id,
    capture_id: order.capture_id,
    captured_amount: order.captured_amount,
    buyer_email: order.buyer_email,
  };
}

async function notify(order, type) {
  if (!order?.app_id) return;
  const app = getApp(order.app_id);
  const payload = { type, created_at: new Date().toISOString(), payment: paymentPublic(order) };
  let delivered = false;
  if (app?.webhook_url) {
    try {
      const res = await fetch(app.webhook_url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Funguo-Event': type },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(4000),
      });
      delivered = res.ok;
    } catch (e) {
      console.error(`[funguo] webhook ${type} failed: ${e.message}`);
    }
  }
  insertAppEvent({ appId: order.app_id, orderId: order.id, type, payload, delivered });
}

// ---- checkout ---------------------------------------------------------------

async function openPayPal(order, { description, paymentMethod }) {
  const billed = paypalCharge(order.amount, order.currency);
  const intent = order.payment_option === 'checkout' ? 'CAPTURE' : 'AUTHORIZE';
  let pp;
  try {
    pp = await paypal.createOrder({
      orderId: order.id,
      amount: billed.amount,
      currency: billed.currency,
      description,
      paymentMethod,
      intent,
      returnUrl: `${config.baseUrl}/paypal/return?order=${order.id}`,
      cancelUrl: `${config.baseUrl}/paypal/cancel?order=${order.id}`,
    });
  } catch (e) {
    if (paymentMethod === 'card') {
      e.message += ' — card payments need Advanced Credit & Debit Cards enabled on the sandbox business account; use payment_method "paypal" otherwise.';
    }
    throw e;
  }

  const approval = pp.links?.find((l) => l.rel === 'payer-action' || l.rel === 'approve')?.href ?? null;
  updateOrder(order.id, { paypal_order_id: pp.id, approval_url: approval });

  // A sandbox card is authorized or captured inline, with no buyer redirect.
  if (order.payment_option === 'checkout') {
    if (paypal.captureFrom(pp)) return placePaid(order.id, pp, order.buyer_kind);
  } else if (paypal.authorizationFrom(pp)) {
    return placeHold(order.id, pp, order.buyer_kind);
  }
  return getOrder(order.id);
}

export async function startCheckout({ listingId, buyerName, buyerEmail, buyerKind = 'human', paymentMethod = 'paypal', paymentOption }) {
  const listing = getListing(listingId);
  if (!listing || listing.id === 'lst_apps') throw new EscrowError('Listing not found', 404);
  if (!['paypal', 'card'].includes(paymentMethod)) throw new EscrowError('payment_method must be "paypal" or "card"', 400);
  const option = optionOf(paymentOption);

  const order = insertOrder({
    listing_id: listing.id,
    buyer_name: buyerName ?? null,
    buyer_email: buyerEmail ?? null,
    buyer_kind: buyerKind === 'agent' ? 'agent' : 'human',
    amount: listing.price,
    currency: listing.currency,
    payment_method: paymentMethod,
    payment_option: option,
  });
  return openPayPal(order, { description: listing.title, paymentMethod });
}

/** A shop with its own cart. Funguo is only the payment option, not the storefront. */
export async function startExternalPayment({ app, option, amount, currency = 'USD', description, reference, returnUrl, cancelUrl, buyerName, buyerEmail }) {
  if (!app) throw new EscrowError('Unknown app', 401);
  const chosen = optionOf(option);
  const price = round2(Number(amount));
  if (!(price > 0) || price > 10_000_000) throw new EscrowError('amount must be greater than 0', 400);
  const title = String(description || '').trim();
  if (!title) throw new EscrowError('description is required', 400);
  const code = String(currency || 'USD').toUpperCase();
  if (!/^[A-Z]{3}$/.test(code)) throw new EscrowError('currency must be a 3-letter code', 400);

  const order = insertOrder({
    listing_id: externalListingId(),
    buyer_name: buyerName ?? null,
    buyer_email: buyerEmail ?? null,
    buyer_kind: 'human',
    amount: price,
    currency: code,
    payment_method: 'paypal',
    payment_option: chosen,
    app_id: app.id,
    external_reference: reference ? String(reference).slice(0, 120) : null,
    description: title.slice(0, 200),
    return_url: httpUrl(returnUrl, 'return_url'),
    cancel_url: httpUrl(cancelUrl, 'cancel_url'),
  });
  return openPayPal(order, { description: title, paymentMethod: 'paypal' });
}

async function placeHold(orderId, ppOrder, actor) {
  const auth = paypal.authorizationFrom(ppOrder);
  if (!auth) throw new EscrowError('PayPal returned no authorization', 502);
  if (!['CREATED', 'PENDING'].includes(auth.status)) {
    throw new EscrowError(`Authorization ${auth.id} is ${auth.status}; no hold was placed`, 402);
  }
  const order = recordTransition(orderId, 'INITIATED', 'HELD', actor, `Pal-Lock authorization ${auth.id} (${auth.status}) holds ${auth.amount?.value} ${auth.amount?.currency_code}`, {
    authorization_id: auth.id,
    authorization_expires_at: auth.expiration_time ?? null,
    authorized_at: new Date().toISOString(),
  });
  await notify(order, 'payment.held');
  return getOrder(orderId);
}

async function placePaid(orderId, ppOrder, actor) {
  const cap = paypal.captureFrom(ppOrder);
  if (!cap) throw new EscrowError('PayPal returned no capture', 502);
  if (!['COMPLETED', 'PENDING'].includes(cap.status)) {
    throw new EscrowError(`Capture ${cap.id} is ${cap.status}; the seller was not paid`, 402);
  }
  const order = getOrder(orderId);
  const updated = recordTransition(orderId, 'INITIATED', 'PAID', actor, `PayPal Checkout captured ${order.amount} ${order.currency} (${cap.id}). The seller has been paid.`, {
    capture_id: cap.id,
    captured_amount: order.amount,
    platform_fee: fee(order.amount),
  });
  await notify(updated, 'payment.paid');
  return getOrder(orderId);
}

/** Buyer came back from PayPal approval: authorize = place the hold. */
export function completeApproval(orderId, paypalToken) {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    if (!order) throw new EscrowError('Order not found', 404);
    if (paypalToken && paypalToken !== order.paypal_order_id) throw new EscrowError('PayPal token does not match this order', 400);
    if (order.state !== 'INITIATED') return order; // already settled (refresh / double return)
    if (order.payment_option === 'checkout') {
      const pp = await paypal.captureOrder(order.paypal_order_id, { orderId });
      return placePaid(orderId, pp, order.buyer_kind);
    }
    const pp = await paypal.authorizeOrder(order.paypal_order_id, { orderId });
    return placeHold(orderId, pp, order.buyer_kind);
  });
}

// ---- fulfilment ---------------------------------------------------------------

/** Seller ships. An optional packing photo becomes seller-side evidence for any dispute. */
export function markShipped(orderId, { carrier, trackingNumber, packingPhoto }) {
  const order = getOrder(orderId);
  assertCan(order, 'SHIPPED');
  if (!trackingNumber) throw new EscrowError('tracking_number is required', 400);
  const note = `Shipped via ${carrier || 'carrier'} ${trackingNumber}${packingPhoto ? ' with a packing photo' : ''}`;
  return recordTransition(orderId, order.state, 'SHIPPED', 'seller', note, {
    carrier: carrier || 'DHL',
    tracking_number: trackingNumber,
    delivery_status: 'in_transit',
    ...(packingPhoto ? { packing_photo_path: packingPhoto.path, packing_photo_mime: packingPhoto.mime } : {}),
  });
}

/**
 * Carrier reports delivery -> buyer's inspection window opens.
 * TODO(live): drive this from a carrier tracking webhook (e.g. AfterShip/EasyPost)
 * instead of a button.
 */
export function markDelivered(orderId) {
  const order = getOrder(orderId);
  assertCan(order, 'INSPECTED');
  return recordTransition(orderId, order.state, 'INSPECTED', 'carrier', 'Carrier reported delivered; inspection window open', {
    delivery_status: 'delivered',
  });
}

// ---- money movement -------------------------------------------------------------

async function capture(order, amount, note) {
  const billed = paypalCharge(amount, order.currency, order.amount);
  const res = await paypal.captureAuthorization(order.authorization_id, {
    orderId: order.id,
    amount: billed.amount,
    currency: billed.currency,
    finalCapture: true,
    note,
  });
  return { res, fields: { capture_id: res.id, captured_amount: amount, platform_fee: fee(amount) } };
}

/** Happy path: buyer confirms the item is as described -> capture in full. */
export function confirmReceipt(orderId, actor = 'buyer') {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    assertCan(order, 'RELEASED');
    const { res, fields } = await capture(order, order.amount, 'Released by buyer confirmation');
    const next = recordTransition(orderId, order.state, 'RELEASED', actor, `Captured ${order.amount} ${order.currency} (capture ${res.id}, ${res.status})`, fields);
    await notify(next, 'payment.released');
    return { order: getOrder(orderId), paypal: res };
  });
}

export function openDispute(orderId) {
  const order = getOrder(orderId);
  assertCan(order, 'DISPUTED');
  return recordTransition(orderId, order.state, 'DISPUTED', 'buyer', 'Buyer opened a dispute; funds stay on hold');
}

/**
 * Execute an adjudication outcome. `refundAmount` is what goes back to the
 * buyer on a partial: we capture (amount - refundAmount) with final_capture,
 * and PayPal releases the rest of the hold.
 */
export function executeDecision(orderId, { decision, refundAmount, actor, note }) {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    if (!order) throw new EscrowError('Order not found', 404);
    if (order.state !== 'DISPUTED') throw new EscrowError(`Order is ${order.state}, not DISPUTED`);

    if (decision === 'release_full') {
      const { res, fields } = await capture(order, order.amount, 'Dispute resolved in seller\'s favour');
      const next = recordTransition(orderId, 'DISPUTED', 'RESOLVED_RELEASE', actor, note ?? `Captured ${order.amount}`, fields);
      await notify(next, 'payment.released');
      return { paypal: res, order: getOrder(orderId) };
    }
    if (decision === 'partial_refund') {
      const refund = round2(Number(refundAmount));
      if (!(refund > 0 && refund < order.amount)) {
        throw new EscrowError(`Partial refund must be between 0 and ${order.amount} (exclusive); got ${refundAmount}`, 400);
      }
      const captureAmount = round2(order.amount - refund);
      const { res, fields } = await capture(order, captureAmount, `Partial refund of ${refund.toFixed(2)} to buyer`);
      const next = recordTransition(orderId, 'DISPUTED', 'RESOLVED_PARTIAL', actor, note ?? `Captured ${captureAmount}, ${refund} of the hold returned to buyer`, fields);
      await notify(next, 'payment.partial');
      return { paypal: res, order: getOrder(orderId) };
    }
    if (decision === 'refund_full') {
      const res = await paypal.voidAuthorization(order.authorization_id, { orderId });
      const next = recordTransition(orderId, 'DISPUTED', 'RESOLVED_REFUND', actor, note ?? 'Authorization voided; buyer not charged');
      await notify(next, 'payment.voided');
      return { paypal: res, order: getOrder(orderId) };
    }
    throw new EscrowError(`Unknown decision ${decision}`, 400);
  });
}

/** App cancels a Pal-Lock before the item is settled. The buyer is not charged. */
export function voidHold(orderId, actor = 'app') {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    if (order?.payment_option === 'checkout') throw new EscrowError('PayPal Checkout already paid the seller', 409);
    assertCan(order, 'VOIDED');
    const res = await paypal.voidAuthorization(order.authorization_id, { orderId });
    const next = recordTransition(orderId, order.state, 'VOIDED', actor, 'Pal-Lock dropped. The buyer was not charged.');
    await notify(next, 'payment.voided');
    return { paypal: res, order: getOrder(orderId) };
  });
}

// ---- keeping long holds guaranteed -------------------------------------------------

const HELD_STATES = new Set(['HELD', 'SHIPPED', 'INSPECTED', 'DISPUTED']);
const honorMs = () => config.honorPeriodHours * 3600e3;

/**
 * PayPal guarantees authorized funds only for the ~3-day honor period. A slow
 * cross-border shipment or a long dispute can outlast that, so once it ends we
 * reauthorize: PayPal re-secures the funds and issues a new authorization id.
 * PayPal allows this for wallet payments only; card-funded holds keep the
 * original authorization for its 29-day window.
 */
export function reauthorizeHold(orderId, actor = 'system') {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    if (!order) throw new EscrowError('Order not found', 404);
    if (!HELD_STATES.has(order.state) || order.payment_option === 'checkout') {
      throw new EscrowError(`Nothing is on hold for an order that is ${order.state}`, 409);
    }
    if (order.payment_method !== 'paypal') {
      throw new EscrowError('PayPal reauthorizes wallet payments only; this hold was placed with a card', 409);
    }
    const age = Date.now() - Date.parse(order.authorized_at ?? order.created_at);
    if (age < honorMs()) {
      throw new EscrowError(`The honor period has not ended yet (${Math.ceil((honorMs() - age) / 3600e3)} h left)`, 409);
    }
    const billed = paypalCharge(order.amount, order.currency, order.amount);
    const res = await paypal.reauthorizeAuthorization(order.authorization_id, { orderId, amount: billed.amount, currency: billed.currency });
    const at = new Date().toISOString();
    recordNote(orderId, actor, `Honor period ended: PayPal reauthorized the hold as ${res.id} (was ${order.authorization_id})`, {
      authorization_id: res.id,
      authorization_expires_at: res.expiration_time ?? order.authorization_expires_at,
      authorized_at: at,
      reauthorized_at: at,
    });
    return { paypal: res, order: getOrder(orderId) };
  });
}

/** Reauthorize every wallet hold whose honor period has ended. Run on a timer. */
export async function reauthorizeDueHolds() {
  const due = holdsDueForReauthorization(honorMs());
  for (const id of due) {
    try {
      await reauthorizeHold(id);
      console.log(`[escrow] reauthorized hold on ${id}`);
    } catch (e) {
      console.error(`[escrow] could not reauthorize ${id}: ${e.message}`);
    }
  }
  return due.length;
}

// ---- read model -----------------------------------------------------------------

export function allowedActions(order) {
  const next = TRANSITIONS[order.state] ?? [];
  const a = [];
  if (order.state === 'INITIATED' && order.approval_url) a.push('approve');
  if (next.includes('SHIPPED')) a.push('ship');
  if (next.includes('INSPECTED')) a.push('deliver');
  if (next.includes('RELEASED')) a.push('confirm');
  if (next.includes('DISPUTED')) a.push('dispute');
  return a;
}

export function orderView(orderId) {
  const order = getOrder(orderId);
  if (!order) return null;
  const listing = getListing(order.listing_id);
  const app = order.app_id ? getApp(order.app_id) : null;
  const seller = app
    ? {
        seller_id: null,
        name: app.name,
        email: null,
        verified: true,
        total_orders: 0,
        total_disputes: 0,
        dispute_rate: null,
        member_since: app.created_at,
        photo_url: null,
        socials: [],
        app: true,
      }
    : { ...sellerHistory(listing.seller_id), email: getSeller(listing.seller_id).email, app: false };
  const shown = order.description
    ? { ...listing, title: order.description, description: order.description, price: order.amount, currency: order.currency }
    : listing;
  return {
    order: (({ packing_photo_path, packing_photo_mime, ...o }) => ({
      ...o,
      has_packing_photo: !!packing_photo_path,
      guaranteed_until: o.authorized_at && HELD_STATES.has(o.state)
        ? new Date(Date.parse(o.authorized_at) + honorMs()).toISOString()
        : null,
      allowed_actions: allowedActions(order),
    }))(order),
    listing: shown,
    seller,
    events: orderEvents(orderId),
    paypal_calls: paypalCalls(orderId),
    disputes: disputesForOrder(orderId).map(({ transcript, ...d }) => ({
      ...d,
      transcript_steps: transcript?.length ?? 0,
      live_steps: d.status === 'RUNNING' ? liveSteps(transcript) : undefined,
    })),
  };
}

// One line per step the agent has taken so far, for the "working" card.
function liveSteps(transcript) {
  const short = (v, n = 160) => {
    const s = typeof v === 'string' ? v : JSON.stringify(v);
    return s.length > n ? `${s.slice(0, n)}…` : s;
  };
  return (transcript ?? []).slice(1).map((t) => {
    if (t.role === 'reasoning') return { kind: 'reasoning', text: short(t.content, 220) };
    if (t.role === 'assistant' && t.tool) return { kind: 'call', tool: t.tool, text: short(t.content?.query ?? t.content?.text ?? t.content?.rationale ?? t.content) };
    if (t.role === 'tool') {
      const c = t.content;
      let text = short(c);
      if (t.tool === 'lookup_product_reference') {
        text = c?.price_stats ? `${c.source}: median $${c.price_stats.median} across ${c.price_stats.count} offers` : `${c?.source ?? ''}: no reference found`;
      } else if (t.tool === 'search_scam_patterns' && Array.isArray(c?.matches)) {
        text = `${c.backend}: ${c.matches.slice(0, 2).map((m) => `${m.label} (${Number(m.score).toFixed(2)})`).join('; ') || 'no close match'}`;
      } else if (c?.executed) {
        text = 'Executed against PayPal';
      } else if (c?.escalated) {
        text = c.guardrail ? `Guardrail: ${c.guardrail}` : 'Escalated; no money moved';
      }
      return { kind: 'result', tool: t.tool, text };
    }
    return { kind: 'note', text: short(t.content) };
  });
}

export { getOrderByPayPalId as orderByPayPalId } from './db.js';
