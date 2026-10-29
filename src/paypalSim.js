// In-process PayPal stand-in, active ONLY when PAYPAL_MODE=simulate.
// It mirrors the response shapes of the sandbox endpoints Funguo uses so the
// full flow can be clicked through without credentials. The UI shows a banner
// whenever it is active; the README's "real vs stubbed" table lists it.
import crypto from 'node:crypto';
import { config } from './config.js';

const orders = new Map(); // paypal order id -> order body
const auths = new Map(); // authorization id -> { orderId, amount, status }
const replies = new Map(); // PayPal-Request-Id -> earlier response (idempotency, like the real API)

const rid = (p) => `${p}${crypto.randomBytes(8).toString('hex').toUpperCase()}`;
const ok = (body, status = 201) => ({ status, body });
const err = (status, issue, description) => ({
  status,
  body: { name: 'UNPROCESSABLE_ENTITY', debug_id: rid('SIMDBG'), details: [{ issue, description }] },
});

function authorize(order) {
  const id = rid('SIMAUTH');
  const amount = order.purchase_units[0].amount;
  auths.set(id, { orderId: order.id, amount, status: 'CREATED' });
  order.status = 'COMPLETED';
  order.purchase_units[0].payments = {
    authorizations: [
      {
        id,
        status: 'CREATED',
        amount,
        expiration_time: new Date(Date.now() + 29 * 864e5).toISOString(),
        seller_protection: { status: 'ELIGIBLE' },
      },
    ],
  };
  return order;
}

export async function handle(op, path, body, requestId) {
  if (requestId && replies.has(requestId)) return replies.get(requestId);
  const out = dispatch(op, path, body);
  if (requestId && out.status < 400) replies.set(requestId, out);
  return out;
}

function dispatch(op, path, body) {
  const seg = path.split('/');
  switch (op) {
    case 'create_order': {
      const id = rid('SIM');
      const order = { id, intent: body.intent, status: 'PAYER_ACTION_REQUIRED', purchase_units: body.purchase_units, links: [] };
      orders.set(id, order);
      if (body.payment_source?.card) return ok(authorize(order));
      order.links.push({ rel: 'payer-action', method: 'GET', href: `${config.baseUrl}/sim/paypal/approve?token=${id}` });
      return ok(order);
    }
    case 'get_order': {
      const o = orders.get(seg[4]);
      return o ? ok(o, 200) : err(404, 'RESOURCE_NOT_FOUND', 'Simulated order not found (simulator state resets on restart).');
    }
    case 'authorize': {
      const o = orders.get(seg[4]);
      if (!o) return err(404, 'RESOURCE_NOT_FOUND', 'Simulated order not found (simulator state resets on restart).');
      if (o.status === 'COMPLETED') return ok(o);
      if (o.status !== 'APPROVED') return err(422, 'ORDER_NOT_APPROVED', 'Payer has not yet approved the Order for payment.');
      return ok(authorize(o));
    }
    case 'capture': {
      const a = auths.get(seg[4]);
      if (!a) return err(404, 'RESOURCE_NOT_FOUND', 'Simulated authorization not found.');
      if (a.status !== 'CREATED') return err(422, 'AUTHORIZATION_ALREADY_CAPTURED', `Authorization is ${a.status}.`);
      if (Number(body.amount.value) > Number(a.amount.value)) return err(422, 'MAX_CAPTURE_AMOUNT_EXCEEDED', 'Capture exceeds authorized amount.');
      a.status = 'CAPTURED';
      return ok({ id: rid('SIMCAP'), status: 'COMPLETED', amount: body.amount, final_capture: body.final_capture, invoice_id: body.invoice_id });
    }
    case 'void': {
      const a = auths.get(seg[4]);
      if (!a) return err(404, 'RESOURCE_NOT_FOUND', 'Simulated authorization not found.');
      if (a.status !== 'CREATED') return err(422, 'CANNOT_BE_VOIDED', `Authorization is ${a.status}.`);
      a.status = 'VOIDED';
      return { status: 204, body: { status: 'VOIDED' } };
    }
    default:
      return err(400, 'UNSUPPORTED', `Simulator does not implement ${op}`);
  }
}

/** Called by the simulated approval page when the "buyer" clicks Approve. */
export function approve(paypalOrderId) {
  const o = orders.get(paypalOrderId);
  if (!o) return false;
  if (o.status === 'PAYER_ACTION_REQUIRED') o.status = 'APPROVED';
  return true;
}
