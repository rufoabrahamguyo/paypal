// The sample shop (Abode). Its cart is not a Funguo listing. It calls the same
// Pal-Lock API another developer would call, using the seeded demo app.
import { Router } from 'express';
import { config } from '../config.js';
import { ensureDemoApp, getOrder, appEventsForOrder } from '../db.js';
import * as escrow from '../escrow.js';

export const shop = Router();

const demo = () => ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);

shop.post('/shop/checkout', async (req, res) => {
  const option = req.body?.option === 'checkout' ? 'checkout' : 'pal_lock';
  const qty = Math.min(12, Math.max(1, Math.round(Number(req.body?.quantity) || 1)));
  const amount = qty * 200;
  const order = await escrow.startExternalPayment({
    app: demo(),
    option,
    amount,
    currency: 'USD',
    description: qty === 1 ? 'Modern Oak Cushion Chair' : `Modern Oak Cushion Chair × ${qty}`,
    reference: `abode_${Date.now().toString(36)}`,
    returnUrl: `${config.baseUrl}/shop/done`,
    cancelUrl: `${config.baseUrl}/shop?cancelled=1`,
    buyerName: 'Abode customer',
  });
  res.status(201).json({ payment: escrow.paymentPublic(order) });
});

shop.get('/shop/payments/:id', (req, res) => {
  const order = getOrder(req.params.id);
  const app = demo();
  if (!order || order.app_id !== app.id) return res.status(404).json({ error: 'Payment not found' });
  res.json({ payment: escrow.paymentPublic(order), events: appEventsForOrder(order.id), app: app.name });
});

shop.post('/shop/payments/:id/capture', async (req, res) => {
  const order = getOrder(req.params.id);
  const app = demo();
  if (!order || order.app_id !== app.id) return res.status(404).json({ error: 'Payment not found' });
  if (order.state === 'HELD') {
    const { order: next } = await escrow.confirmReceipt(order.id, 'app');
    return res.json({ payment: escrow.paymentPublic(next), events: appEventsForOrder(next.id), app: app.name });
  }
  res.json({ payment: escrow.paymentPublic(order), events: appEventsForOrder(order.id), app: app.name });
});

shop.post('/shop/payments/:id/void', async (req, res) => {
  const order = getOrder(req.params.id);
  const app = demo();
  if (!order || order.app_id !== app.id) return res.status(404).json({ error: 'Payment not found' });
  if (order.state === 'HELD') {
    const { order: next } = await escrow.voidHold(order.id, 'app');
    return res.json({ payment: escrow.paymentPublic(next), events: appEventsForOrder(next.id), app: app.name });
  }
  res.json({ payment: escrow.paymentPublic(order), events: appEventsForOrder(order.id), app: app.name });
});

shop.post('/shop/webhook', (req, res) => {
  res.status(204).end();
});
