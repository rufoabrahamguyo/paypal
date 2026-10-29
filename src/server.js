import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertPayPalConfig, isSimulated } from './config.js';
import { db, getOrder } from './db.js';
import * as escrow from './escrow.js';
import * as sim from './paypalSim.js';
import { listings } from './routes/listings.js';
import { orders } from './routes/orders.js';
import { webhooks } from './routes/webhooks.js';
import { disputes, recoverInterruptedDisputes } from './routes/disputes.js';

try {
  assertPayPalConfig();
} catch (e) {
  console.error(`\n[funguo] Cannot start: ${e.message}\n`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'public');
const app = express();
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));
app.use(express.static(pub));

// ---- JSON API (used by the UI and by autonomous buyer agents) ----------------
app.get('/api/health', (req, res) =>
  res.json({
    ok: true,
    paypal_mode: config.paypal.mode,
    agent_engine: config.anthropic.apiKey ? config.anthropic.model : 'rules-fallback',
    product_data: config.channel3.apiKey ? 'channel3' : 'seeded-mock',
    scam_search: config.elastic.url ? 'elastic' : 'local-cosine',
    base_url: config.baseUrl,
  }),
);
app.use('/api', listings, orders, disputes, webhooks);

// ---- PayPal redirects ----------------------------------------------------------
app.get('/paypal/return', async (req, res) => {
  const { order: orderId, token } = req.query;
  try {
    await escrow.completeApproval(String(orderId), token ? String(token) : undefined);
    res.redirect(`/o/${orderId}`);
  } catch (e) {
    console.error('[paypal/return]', e.message);
    res.redirect(`/o/${orderId}?error=${encodeURIComponent(e.message)}`);
  }
});

app.get('/paypal/cancel', (req, res) => {
  const o = getOrder(String(req.query.order));
  res.redirect(o ? `/l/${o.listing_id}?cancelled=1` : '/');
});

// Simulated PayPal approval page (PAYPAL_MODE=simulate only).
app.get('/sim/paypal/approve', (req, res) => {
  if (!isSimulated()) return res.status(404).send('Not found');
  res.sendFile(path.join(pub, 'sim-approve.html'));
});
app.post('/sim/paypal/approve', express.urlencoded({ extended: false }), (req, res) => {
  if (!isSimulated()) return res.status(404).send('Not found');
  const token = String(req.body.token);
  const order = escrow.orderByPayPalId(token);
  if (!order || !sim.approve(token)) return res.status(404).send('Unknown simulated order (simulator state resets on restart)');
  res.redirect(`/paypal/return?order=${order.id}&token=${token}`);
});

// ---- pages ------------------------------------------------------------------------
app.get('/l/:id', (req, res) => res.sendFile(path.join(pub, 'listing.html')));
app.get('/o/:id', (req, res) => res.sendFile(path.join(pub, 'order.html')));

// ---- errors -------------------------------------------------------------------------
app.use('/api', (req, res) => res.status(404).json({ error: `No route ${req.method} ${req.originalUrl}` }));
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const status = err.name === 'MulterError' ? 400 : err.status && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error(err);
  res.status(status).json({
    error: err.message,
    paypal_debug_id: err.debugId,
    paypal_details: err.body?.details,
  });
});

recoverInterruptedDisputes(db);

app.listen(config.port, () => {
  console.log(`\n  Funguo escrow on ${config.baseUrl}`);
  console.log(`  PayPal: ${config.paypal.mode}${isSimulated() ? '  (SIMULATED - no real sandbox calls)' : ' (api-m.sandbox.paypal.com)'}`);
  console.log(`  Dispute agent: ${config.anthropic.apiKey ? config.anthropic.model : 'rules-fallback (set ANTHROPIC_API_KEY for Claude)'}\n`);
});
