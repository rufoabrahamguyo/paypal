// PayPal webhooks. Funguo drives state from its own API calls, so webhooks are
// recorded for audit/reconciliation rather than trusted for state changes.
// With PAYPAL_WEBHOOK_ID set, signatures are verified via PayPal's API.
import { Router } from 'express';
import { recordWebhook } from '../db.js';
import { verifyWebhookSignature } from '../paypal.js';

export const webhooks = Router();

webhooks.post('/webhooks/paypal', async (req, res) => {
  const event = req.body ?? {};
  let verified = false;
  try {
    verified = await verifyWebhookSignature(req.headers, event);
  } catch (e) {
    console.warn('[webhook] verification error:', e.message);
  }
  recordWebhook(event, verified);
  console.log(`[webhook] ${event.event_type} ${event.resource?.id ?? ''} verified=${verified}`);
  // TODO(live): reconcile PAYMENT.AUTHORIZATION.VOIDED (e.g. expiry after 29 days)
  // and PAYMENT.CAPTURE.DENIED against local order state once verified.
  res.sendStatus(200);
});
