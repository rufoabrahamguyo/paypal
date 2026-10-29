// Escrow operations: the only place that moves an order between states, and
// the only place that calls the money-moving PayPal endpoints.
//
//   INITIATED -> HELD -> SHIPPED -> INSPECTED -> RELEASED
//                  \________\__________\______-> DISPUTED -> RESOLVED_RELEASE
//                                                         -> RESOLVED_PARTIAL
//                                                         -> RESOLVED_REFUND
import { config } from './config.js';
import * as paypal from './paypal.js';
import {
  getOrder, getListing, getSeller, insertOrder, updateOrder, recordTransition, orderEvents, paypalCalls,
  disputesForOrder, sellerHistory,
} from './db.js';

export const TRANSITIONS = {
  INITIATED: ['HELD'],
  HELD: ['SHIPPED', 'RELEASED', 'DISPUTED'],
  SHIPPED: ['INSPECTED', 'RELEASED', 'DISPUTED'],
  INSPECTED: ['RELEASED', 'DISPUTED'],
  DISPUTED: ['RESOLVED_RELEASE', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND'],
  RELEASED: [],
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

// ---- checkout ---------------------------------------------------------------

export async function startCheckout({ listingId, buyerName, buyerEmail, buyerKind = 'human', paymentMethod = 'paypal' }) {
  const listing = getListing(listingId);
  if (!listing) throw new EscrowError('Listing not found', 404);
  if (!['paypal', 'card'].includes(paymentMethod)) throw new EscrowError('payment_method must be "paypal" or "card"', 400);

  const order = insertOrder({
    listing_id: listing.id,
    buyer_name: buyerName ?? null,
    buyer_email: buyerEmail ?? null,
    buyer_kind: buyerKind === 'agent' ? 'agent' : 'human',
    amount: listing.price,
    currency: listing.currency,
    payment_method: paymentMethod,
  });

  let pp;
  try {
    pp = await paypal.createOrder({
      orderId: order.id,
      amount: listing.price,
      currency: listing.currency,
      description: listing.title,
      paymentMethod,
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

  // Card payments come back already authorized: the hold exists immediately.
  const auth = paypal.authorizationFrom(pp);
  if (auth) return placeHold(order.id, pp, order.buyer_kind);
  return getOrder(order.id);
}

function placeHold(orderId, ppOrder, actor) {
  const auth = paypal.authorizationFrom(ppOrder);
  if (!auth) throw new EscrowError('PayPal returned no authorization', 502);
  if (!['CREATED', 'PENDING'].includes(auth.status)) {
    throw new EscrowError(`Authorization ${auth.id} is ${auth.status}; no hold was placed`, 402);
  }
  return recordTransition(orderId, 'INITIATED', 'HELD', actor, `PayPal authorization ${auth.id} (${auth.status}) holds ${auth.amount?.value} ${auth.amount?.currency_code}`, {
    authorization_id: auth.id,
    authorization_expires_at: auth.expiration_time ?? null,
  });
}

/** Buyer came back from PayPal approval: authorize = place the hold. */
export function completeApproval(orderId, paypalToken) {
  return withLock(orderId, async () => {
    const order = getOrder(orderId);
    if (!order) throw new EscrowError('Order not found', 404);
    if (paypalToken && paypalToken !== order.paypal_order_id) throw new EscrowError('PayPal token does not match this order', 400);
    if (order.state !== 'INITIATED') return order; // already held (refresh / double return)
    const pp = await paypal.authorizeOrder(order.paypal_order_id, { orderId });
    return placeHold(orderId, pp, order.buyer_kind);
  });
}

// ---- fulfilment ---------------------------------------------------------------

export function markShipped(orderId, { carrier, trackingNumber }) {
  const order = getOrder(orderId);
  assertCan(order, 'SHIPPED');
  if (!trackingNumber) throw new EscrowError('tracking_number is required', 400);
  return recordTransition(orderId, order.state, 'SHIPPED', 'seller', `Shipped via ${carrier || 'carrier'} ${trackingNumber}`, {
    carrier: carrier || 'DHL',
    tracking_number: trackingNumber,
    delivery_status: 'in_transit',
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
  const res = await paypal.captureAuthorization(order.authorization_id, {
    orderId: order.id,
    amount,
    currency: order.currency,
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
    return {
      order: recordTransition(orderId, order.state, 'RELEASED', actor, `Captured ${order.amount} ${order.currency} (capture ${res.id}, ${res.status})`, fields),
      paypal: res,
    };
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
      return { paypal: res, order: recordTransition(orderId, 'DISPUTED', 'RESOLVED_RELEASE', actor, note ?? `Captured ${order.amount}`, fields) };
    }
    if (decision === 'partial_refund') {
      const refund = round2(Number(refundAmount));
      if (!(refund > 0 && refund < order.amount)) {
        throw new EscrowError(`Partial refund must be between 0 and ${order.amount} (exclusive); got ${refundAmount}`, 400);
      }
      const captureAmount = round2(order.amount - refund);
      const { res, fields } = await capture(order, captureAmount, `Partial refund of ${refund.toFixed(2)} to buyer`);
      return {
        paypal: res,
        order: recordTransition(orderId, 'DISPUTED', 'RESOLVED_PARTIAL', actor, note ?? `Captured ${captureAmount}, ${refund} of the hold returned to buyer`, fields),
      };
    }
    if (decision === 'refund_full') {
      const res = await paypal.voidAuthorization(order.authorization_id, { orderId });
      return { paypal: res, order: recordTransition(orderId, 'DISPUTED', 'RESOLVED_REFUND', actor, note ?? 'Authorization voided; buyer not charged') };
    }
    throw new EscrowError(`Unknown decision ${decision}`, 400);
  });
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
  const seller = getSeller(listing.seller_id);
  return {
    order: { ...order, allowed_actions: allowedActions(order) },
    listing,
    seller: { ...sellerHistory(seller.id), email: seller.email },
    events: orderEvents(orderId),
    paypal_calls: paypalCalls(orderId),
    disputes: disputesForOrder(orderId).map(({ transcript, ...d }) => ({ ...d, transcript_steps: transcript?.length ?? 0 })),
  };
}

export { getOrderByPayPalId as orderByPayPalId } from './db.js';
