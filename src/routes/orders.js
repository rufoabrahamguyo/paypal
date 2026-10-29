import { Router } from 'express';
import { listOrders } from '../db.js';
import * as escrow from '../escrow.js';

export const orders = Router();

const view = (res, id, status = 200, extra = {}) => {
  const v = escrow.orderView(id);
  if (!v) return res.status(404).json({ error: 'Order not found' });
  res.status(status).json({ ...v, ...extra });
};

orders.get('/orders', (req, res) => res.json(listOrders()));
orders.get('/orders/:id', (req, res) => view(res, req.params.id));

// Agent-facing: create an escrow order. payment_method "paypal" returns an
// approval_url for a human to approve; "card" (sandbox test card) places the
// hold immediately with no redirect, so an autonomous agent can complete it.
orders.post('/orders', async (req, res) => {
  const { listing_id, buyer_name, buyer_email, buyer_kind, payment_method } = req.body ?? {};
  const o = await escrow.startCheckout({
    listingId: listing_id,
    buyerName: buyer_name,
    buyerEmail: buyer_email,
    buyerKind: buyer_kind,
    paymentMethod: payment_method,
  });
  view(res, o.id, 201);
});

// For API clients that approved out-of-band: place the hold now.
orders.post('/orders/:id/authorize', async (req, res) => {
  await escrow.completeApproval(req.params.id);
  view(res, req.params.id);
});

orders.post('/orders/:id/ship', (req, res) => {
  const { carrier, tracking_number } = req.body ?? {};
  escrow.markShipped(req.params.id, { carrier, trackingNumber: tracking_number });
  view(res, req.params.id);
});

orders.post('/orders/:id/deliver', (req, res) => {
  escrow.markDelivered(req.params.id);
  view(res, req.params.id);
});

orders.post('/orders/:id/confirm', async (req, res) => {
  const { paypal } = await escrow.confirmReceipt(req.params.id, req.body?.actor === 'agent' ? 'agent' : 'buyer');
  view(res, req.params.id, 200, { paypal_response: paypal });
});
