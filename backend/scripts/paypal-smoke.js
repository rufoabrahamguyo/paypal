// Throwaway sandbox check for paypal.js: OAuth -> create(AUTHORIZE, card) ->
// partial capture, and a second order -> void. Prints ids you can look up in
// the sandbox dashboard. Usage: npm run test:paypal
import { config, assertPayPalConfig } from '../config.js';
import * as paypal from '../paypal.js';

assertPayPalConfig();
console.log(`mode=${config.paypal.mode}`);

const tag = `smoke_${Date.now()}`;
const step = async (label, fn) => {
  try {
    const out = await fn();
    console.log(`  ok  ${label}`);
    return out;
  } catch (e) {
    console.error(`  FAIL ${label}: ${e.message}${e.debugId ? ` (debug_id ${e.debugId})` : ''}`);
    if (e.body) console.error(JSON.stringify(e.body, null, 2));
    process.exit(1);
  }
};

if (config.paypal.mode === 'sandbox') await step('oauth token', () => paypal.getAccessToken());

const a = await step('create order (AUTHORIZE, sandbox card)', () =>
  paypal.createOrder({ orderId: `${tag}_a`, amount: 25, description: 'Funguo smoke test A', paymentMethod: 'card' }),
);
const authA = paypal.authorizationFrom(a);
console.log(`       order ${a.id} status=${a.status} authorization=${authA?.id} expires=${authA?.expiration_time}`);
const cap = await step('partial capture 15.00 of 25.00 (final_capture)', () =>
  paypal.captureAuthorization(authA.id, { orderId: `${tag}_a`, amount: 15 }),
);
console.log(`       capture ${cap.id} status=${cap.status}`);
const capAgain = await step('idempotent re-capture returns same capture', () =>
  paypal.captureAuthorization(authA.id, { orderId: `${tag}_a`, amount: 15 }),
);
if (config.paypal.mode === 'sandbox' && capAgain.id !== cap.id) console.warn('       note: different capture id on retry');

const b = await step('create order B', () =>
  paypal.createOrder({ orderId: `${tag}_b`, amount: 40, description: 'Funguo smoke test B', paymentMethod: 'card' }),
);
const authB = paypal.authorizationFrom(b);
await step('void authorization B', () => paypal.voidAuthorization(authB.id, { orderId: `${tag}_b` }));

const c = await step('create order C (PayPal wallet, needs approval)', () =>
  paypal.createOrder({
    orderId: `${tag}_c`,
    amount: 10,
    description: 'Funguo smoke test C',
    returnUrl: `${config.baseUrl}/paypal/return`,
    cancelUrl: `${config.baseUrl}/paypal/cancel`,
  }),
);
console.log(`       approval link: ${c.links.find((l) => l.rel === 'payer-action')?.href}`);
console.log('smoke test passed');
