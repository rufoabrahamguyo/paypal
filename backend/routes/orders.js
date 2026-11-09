import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { listOrders, getOrder } from '../db.js';
import * as escrow from '../escrow.js';
import { userFromRequest } from '../auth.js';

export const orders = Router();

const UPLOADS = path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };
const packingUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `${req.params.id}-packing-${Date.now()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Photo must be JPEG, PNG, WebP or GIF');
    err.status = 400;
    cb(err);
  },
});

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
  const body = req.body ?? {};
  const user = userFromRequest(req);
  const buyerName = user?.role === 'buyer' ? user.name : body.buyer_name;
  const buyerEmail = user?.role === 'buyer' ? user.email : body.buyer_email;
  const o = await escrow.startCheckout({
    listingId: body.listing_id,
    buyerName,
    buyerEmail,
    buyerKind: body.buyer_kind,
    paymentMethod: body.payment_method,
    paymentOption: body.option || body.payment_option,
  });
  view(res, o.id, 201);
});

// For API clients that approved out-of-band: place the hold now.
orders.post('/orders/:id/authorize', async (req, res) => {
  await escrow.completeApproval(req.params.id);
  view(res, req.params.id);
});

// JSON, or multipart with an optional `packing_photo` the dispute agent can
// compare against the buyer's photo later.
orders.post('/orders/:id/ship', packingUpload.single('packing_photo'), (req, res) => {
  const { carrier, tracking_number } = req.body ?? {};
  try {
    escrow.markShipped(req.params.id, {
      carrier,
      trackingNumber: tracking_number,
      packingPhoto: req.file ? { path: req.file.path, mime: req.file.mimetype } : null,
    });
  } catch (e) {
    if (req.file) fs.rmSync(req.file.path, { force: true });
    throw e;
  }
  view(res, req.params.id);
});

// Re-secure a hold after PayPal's honor period (also done hourly by the server).
orders.post('/orders/:id/reauthorize', async (req, res) => {
  const { paypal } = await escrow.reauthorizeHold(req.params.id, 'operator');
  view(res, req.params.id, 200, { paypal_response: paypal });
});

orders.get('/orders/:id/packing-photo', (req, res) => {
  const o = getOrder(req.params.id);
  if (!o?.packing_photo_path || !fs.existsSync(o.packing_photo_path)) return res.sendStatus(404);
  res.type(o.packing_photo_mime).sendFile(path.resolve(o.packing_photo_path));
});

orders.post('/orders/:id/deliver', (req, res) => {
  escrow.markDelivered(req.params.id);
  view(res, req.params.id);
});

orders.post('/orders/:id/confirm', async (req, res) => {
  const { paypal } = await escrow.confirmReceipt(req.params.id, req.body?.actor === 'agent' ? 'agent' : 'buyer');
  view(res, req.params.id, 200, { paypal_response: paypal });
});
