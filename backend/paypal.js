// Thin PayPal REST client (Orders v2 + Payments v2) over fetch. No SDK.
//
// Escrow model: Funguo never takes custody of funds. The buyer's payment is an
// AUTHORIZATION (a hold on their funding source). We later either CAPTURE it
// (release to seller, fully or partially) or VOID it (full refund pre-capture).
//
//   * An authorization can be captured for up to 29 days after it is created.
//   * The first ~3 days are the "honor period", during which the funds are
//     guaranteed. Capturing after day 3 makes PayPal attempt to re-secure funds,
//     which can fail if the buyer's source no longer covers the amount, so
//     escrow.js reauthorizes wallet-funded holds once the honor period ends
//     (reauthorizeAuthorization below). PayPal does not reauthorize card-funded
//     authorizations; those holds rely on the 29-day window alone.
//
// Every mutating call carries a PayPal-Request-Id. The id is derived
// deterministically from (local order id, operation), so a retried or
// double-clicked capture is deduplicated by PayPal instead of double-charging.
import crypto from 'node:crypto';
import { config, isSimulated } from './config.js';
import { logPayPalCall } from './db.js';
import * as sim from './paypalSim.js';

export class PayPalError extends Error {
  constructor(op, status, body) {
    const issue = body?.details?.[0];
    super(`PayPal ${op} failed (${status}): ${issue ? `${issue.issue} - ${issue.description}` : body?.message || body?.error_description || 'unknown error'}`);
    this.op = op;
    this.status = status;
    this.body = body;
    this.debugId = body?.debug_id;
  }
}

/** Stable UUID-shaped idempotency key for (order, op). */
export function requestIdFor(...parts) {
  const h = crypto.createHash('sha256').update(parts.join(':')).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

// ---- OAuth ------------------------------------------------------------------

let tokenCache = { token: null, expiresAt: 0 };

export async function getAccessToken() {
  // Refresh 5 minutes before PayPal's stated expiry (typically ~9h).
  if (tokenCache.token && Date.now() < tokenCache.expiresAt - 5 * 60_000) return tokenCache.token;
  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.secret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new PayPalError('oauth', res.status, body);
  tokenCache = { token: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return tokenCache.token;
}

async function call(op, method, path, { body, requestId, orderId } = {}) {
  if (isSimulated()) {
    const out = await sim.handle(op, path, body, requestId);
    logPayPalCall({ orderId, op, requestId, status: out.status, request: { method, path, body }, response: out.body });
    if (out.status >= 400) throw new PayPalError(op, out.status, out.body);
    return out.body;
  }
  const headers = {
    Authorization: `Bearer ${await getAccessToken()}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation',
  };
  if (requestId) headers['PayPal-Request-Id'] = requestId;
  const res = await fetch(`${config.paypal.baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  // void returns 204 No Content.
  const text = await res.text();
  const json = text ? JSON.parse(text) : { status: res.status === 204 ? 'VOIDED' : undefined };
  logPayPalCall({ orderId, op, requestId, status: res.status, request: { method, path, body: redact(body) }, response: json });
  if (!res.ok) throw new PayPalError(op, res.status, json);
  return json;
}

function redact(body) {
  if (!body?.payment_source?.card) return body;
  const { number, security_code, ...card } = body.payment_source.card;
  return { ...body, payment_source: { card: { ...card, number: `****${String(number).slice(-4)}` } } };
}

const ZERO_DECIMAL = new Set(['JPY', 'HUF', 'TWD']);
const money = (n, currency = 'USD') => ({
  currency_code: currency,
  value: ZERO_DECIMAL.has(currency) ? String(Math.round(Number(n))) : Number(n).toFixed(2),
});

// ---- Orders v2 ----------------------------------------------------------------

/**
 * Create an order with intent AUTHORIZE (the escrow hold).
 *  - paymentMethod "paypal": returns a payer-action link the buyer opens to approve.
 *  - paymentMethod "card": sandbox test card, no redirect. Used by autonomous
 *    buyer agents. PayPal returns the authorization inline (status COMPLETED).
 */
export async function createOrder({ orderId, amount, currency = 'USD', description, returnUrl, cancelUrl, paymentMethod = 'paypal', card, intent = 'AUTHORIZE' }) {
  const payment_source =
    paymentMethod === 'card'
      ? {
          card: {
            name: card?.name ?? 'Funguo Agent Buyer',
            // PayPal sandbox test Visa. Sandbox only; never a real PAN.
            number: card?.number ?? process.env.SANDBOX_CARD_NUMBER ?? '4032039317984658',
            expiry: card?.expiry ?? '2030-12',
            security_code: card?.security_code ?? '123',
            attributes: { verification: { method: 'SCA_WHEN_REQUIRED' } },
          },
        }
      : {
          paypal: {
            experience_context: {
              brand_name: intent === 'CAPTURE' ? 'PayPal Checkout' : 'Pal-Lock',
              user_action: 'PAY_NOW',
              shipping_preference: 'NO_SHIPPING',
              return_url: returnUrl,
              cancel_url: cancelUrl,
            },
          },
        };
  return call('create_order', 'POST', '/v2/checkout/orders', {
    orderId,
    requestId: requestIdFor(orderId, 'create', paymentMethod, intent),
    body: {
      intent,
      purchase_units: [
        {
          reference_id: orderId,
          custom_id: orderId,
          description: description?.slice(0, 127),
          amount: money(amount, currency),
        },
      ],
      payment_source,
    },
  });
}

/** Place the hold after buyer approval. Returns the full order; see authorizationFrom(). */
export function authorizeOrder(paypalOrderId, { orderId } = {}) {
  return call('authorize', 'POST', `/v2/checkout/orders/${paypalOrderId}/authorize`, {
    orderId,
    requestId: requestIdFor(orderId ?? paypalOrderId, 'authorize'),
    body: {},
  });
}

export function getPayPalOrder(paypalOrderId, { orderId } = {}) {
  return call('get_order', 'GET', `/v2/checkout/orders/${paypalOrderId}`, { orderId });
}

/** Pull the authorization out of an order response (authorize or card-create). */
export function authorizationFrom(ppOrder) {
  return ppOrder?.purchase_units?.[0]?.payments?.authorizations?.[0] ?? null;
}

/** Capture a Checkout order (intent CAPTURE) after the buyer approves. */
export function captureOrder(paypalOrderId, { orderId } = {}) {
  return call('capture_order', 'POST', `/v2/checkout/orders/${paypalOrderId}/capture`, {
    orderId,
    requestId: requestIdFor(orderId ?? paypalOrderId, 'capture_order'),
    body: {},
  });
}

/** Pull the capture out of an order response. */
export function captureFrom(ppOrder) {
  return ppOrder?.purchase_units?.[0]?.payments?.captures?.[0] ?? null;
}

// ---- Payments v2 ------------------------------------------------------------

/**
 * Capture (release to seller). For a partial-refund decision we capture a
 * smaller amount with final_capture=true: the uncaptured remainder of the hold
 * is released back to the buyer automatically, which is the refund.
 *
 * Platform fee: Funguo's business model is a fee on released funds. With a
 * PayPal Commerce Platform partner account this would be
 *   payment_instruction: { platform_fees: [{ amount, payee: { merchant_id } }],
 *                          disbursement_mode: 'DELAYED' }
 * plus the seller onboarded via Partner Referrals. That requires partner
 * approval that isn't available to a sandbox app, so the fee is computed and
 * recorded locally but not split here.
 */
export function captureAuthorization(authorizationId, { orderId, amount, currency = 'USD', finalCapture = true, note }) {
  return call('capture', 'POST', `/v2/payments/authorizations/${authorizationId}/capture`, {
    orderId,
    requestId: requestIdFor(orderId ?? authorizationId, 'capture', Number(amount).toFixed(2)),
    body: {
      amount: money(amount, currency),
      final_capture: finalCapture,
      invoice_id: orderId,
      note_to_payer: note?.slice(0, 255),
      // payment_instruction: { platform_fees: [...] }  // see comment above
    },
  });
}

/**
 * Reauthorize after the honor period: PayPal re-secures the funds and returns a
 * NEW authorization (new id, fresh honor period) that later captures must use.
 * Only for PayPal-wallet payments, within the original 29-day window.
 */
export function reauthorizeAuthorization(authorizationId, { orderId, amount, currency = 'USD' }) {
  return call('reauthorize', 'POST', `/v2/payments/authorizations/${authorizationId}/reauthorize`, {
    orderId,
    requestId: requestIdFor(orderId ?? authorizationId, 'reauthorize', authorizationId),
    body: { amount: money(amount, currency) },
  });
}

/** Void the authorization: the hold is dropped, buyer is never charged. */
export function voidAuthorization(authorizationId, { orderId } = {}) {
  return call('void', 'POST', `/v2/payments/authorizations/${authorizationId}/void`, {
    orderId,
    requestId: requestIdFor(orderId ?? authorizationId, 'void'),
  });
}

/** Webhook signature verification (requires PAYPAL_WEBHOOK_ID). */
export async function verifyWebhookSignature(headers, event) {
  if (isSimulated() || !config.paypal.webhookId) return false;
  const res = await call('verify_webhook', 'POST', '/v1/notifications/verify-webhook-signature', {
    body: {
      auth_algo: headers['paypal-auth-algo'],
      cert_url: headers['paypal-cert-url'],
      transmission_id: headers['paypal-transmission-id'],
      transmission_sig: headers['paypal-transmission-sig'],
      transmission_time: headers['paypal-transmission-time'],
      webhook_id: config.paypal.webhookId,
      webhook_event: event,
    },
  });
  return res.verification_status === 'SUCCESS';
}
