// Pal-Lock for an app that already has its own cart.
// The app sends its API key. Funguo places the PayPal hold or the Checkout
// capture, then tells the app's webhook what happened. The buyer approves on
// PayPal and returns to the app, not to the Funguo market.
import { Router } from 'express';
import { getAppByKey, getOrder } from '../db.js';
import * as escrow from '../escrow.js';

export const payments = Router();

function requireApp(req, res, next) {
  const header = req.headers.authorization || '';
  const key = header.startsWith('Bearer ') ? header.slice(7).trim() : req.headers['x-api-key'];
  const app = getAppByKey(key);
  if (!app) return res.status(401).json({ error: 'Send the app API key as Authorization: Bearer <key>' });
  req.funguoApp = app;
  next();
}

function owned(req, res) {
  const order = getOrder(req.params.id);
  if (!order || order.app_id !== req.funguoApp.id) {
    res.status(404).json({ error: 'Payment not found' });
    return null;
  }
  return order;
}

payments.use('/v1', requireApp);

payments.post('/v1/payments', async (req, res) => {
  const body = req.body ?? {};
  const order = await escrow.startExternalPayment({
    app: req.funguoApp,
    option: body.option,
    amount: body.amount,
    currency: body.currency,
    description: body.description,
    reference: body.reference,
    returnUrl: body.return_url,
    cancelUrl: body.cancel_url,
    buyerName: body.buyer_name,
    buyerEmail: body.buyer_email,
  });
  res.status(201).json({ payment: escrow.paymentPublic(order) });
});

payments.get('/v1/payments/:id', (req, res) => {
  const order = owned(req, res);
  if (!order) return;
  res.json({ payment: escrow.paymentPublic(order) });
});

payments.post('/v1/payments/:id/capture', async (req, res) => {
  const order = owned(req, res);
  if (!order) return;
  if (order.payment_option === 'checkout') {
    return res.status(409).json({ error: 'PayPal Checkout already paid the seller', payment: escrow.paymentPublic(order) });
  }
  if (['RELEASED', 'RESOLVED_RELEASE'].includes(order.state)) {
    return res.json({ payment: escrow.paymentPublic(order) });
  }
  const { order: next } = await escrow.confirmReceipt(order.id, 'app');
  res.json({ payment: escrow.paymentPublic(next) });
});

payments.post('/v1/payments/:id/void', async (req, res) => {
  const order = owned(req, res);
  if (!order) return;
  if (order.state === 'VOIDED' || order.state === 'RESOLVED_REFUND') {
    return res.json({ payment: escrow.paymentPublic(order) });
  }
  const { order: next } = await escrow.voidHold(order.id, 'app');
  res.json({ payment: escrow.paymentPublic(next) });
});
