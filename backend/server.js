import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config, assertPayPalConfig, isSimulated } from './config.js';
import { db, getOrder, getUserByEmail, insertUser, ensureDemoApp } from './db.js';
import * as escrow from './escrow.js';
import * as sim from './paypalSim.js';
import { listings } from './routes/listings.js';
import { orders } from './routes/orders.js';
import { webhooks } from './routes/webhooks.js';
import { disputes, recoverInterruptedDisputes } from './routes/disputes.js';
import { dashboard } from './routes/dashboard.js';
import { account } from './routes/auth.js';
import { identity } from './routes/identity.js';
import { community } from './routes/community.js';
import { payments } from './routes/payments.js';
import { apps } from './routes/apps.js';
import { shop } from './routes/shop.js';
import { dashboardPath, hashPassword, userFromRequest } from './auth.js';

try {
  assertPayPalConfig();
} catch (e) {
  console.error(`\n[funguo] Cannot start: ${e.message}\n`);
  process.exit(1);
}

const here = path.dirname(fileURLToPath(import.meta.url));
const pub = path.join(here, '..', 'frontend');
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
app.use('/api', listings, orders, disputes, webhooks, dashboard, account, identity, community, payments, apps, shop);

// ---- PayPal redirects ----------------------------------------------------------
function withParams(target, params) {
  const url = new URL(target);
  for (const [key, value] of Object.entries(params)) {
    if (value != null && value !== '') url.searchParams.set(key, value);
  }
  return url.toString();
}

app.get('/paypal/return', async (req, res) => {
  const { order: orderId, token } = req.query;
  try {
    const order = await escrow.completeApproval(String(orderId), token ? String(token) : undefined);
    if (order?.return_url) {
      return res.redirect(withParams(order.return_url, {
        payment: order.id,
        state: order.state,
        reference: order.external_reference,
      }));
    }
    res.redirect(`/o/${orderId}`);
  } catch (e) {
    console.error('[paypal/return]', e.message);
    const order = getOrder(String(orderId));
    if (order?.return_url) {
      return res.redirect(withParams(order.return_url, { payment: order.id, error: e.message }));
    }
    res.redirect(`/o/${orderId}?error=${encodeURIComponent(e.message)}`);
  }
});

app.get('/paypal/cancel', (req, res) => {
  const o = getOrder(String(req.query.order));
  if (o?.cancel_url) return res.redirect(withParams(o.cancel_url, { payment: o.id, cancelled: '1' }));
  res.redirect(o?.listing_id && o.listing_id !== 'lst_apps' ? `/l/${o.listing_id}?cancelled=1` : '/');
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
app.get(['/shop', '/shop/done'], (req, res) => res.sendFile(path.join(pub, 'shop.html')));
app.get('/developers', (req, res) => res.sendFile(path.join(pub, 'developers.html')));
app.get('/o/:id', (req, res) => res.sendFile(path.join(pub, 'order.html')));
app.get('/market', (req, res) => res.sendFile(path.join(pub, 'market.html')));
app.get('/community', (req, res) => res.sendFile(path.join(pub, 'community.html')));
app.get('/login', (req, res) => res.sendFile(path.join(pub, 'login.html')));
app.get('/signup', (req, res) => res.sendFile(path.join(pub, 'signup.html')));
app.get('/i/:id', (req, res) => res.sendFile(path.join(pub, 'invite.html')));

function requireRole(role, file) {
  return (req, res) => {
    const user = userFromRequest(req);
    if (!user) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
    if (user.role !== role) return res.redirect(dashboardPath(user.role));
    res.sendFile(path.join(pub, file));
  };
}
app.get('/buyer', requireRole('buyer', 'buyer.html'));
app.get('/seller', requireRole('seller', 'seller.html'));
app.get('/admin', requireRole('admin', 'admin.html'));
app.get(['/support', '/support/:id'], (req, res) => {
  if (!userFromRequest(req)) return res.redirect(`/login?next=${encodeURIComponent(req.originalUrl)}`);
  res.sendFile(path.join(pub, 'support.html'));
});

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

if (!getUserByEmail('admin@funguo.test')) {
  insertUser({
    email: 'admin@funguo.test',
    name: 'Funguo admin',
    password_hash: hashPassword('funguo-demo'),
    role: 'admin',
  });
}

recoverInterruptedDisputes(db);
// Keep long holds guaranteed: reauthorize wallet holds once their honor period ends.
escrow.reauthorizeDueHolds().catch((e) => console.error('[escrow] reauthorize sweep failed:', e.message));
setInterval(() => escrow.reauthorizeDueHolds().catch((e) => console.error('[escrow] reauthorize sweep failed:', e.message)), 3600e3).unref();
ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);

app.listen(config.port, () => {
  console.log(`\n  Funguo escrow on ${config.baseUrl}`);
  console.log(`  PayPal: ${config.paypal.mode}${isSimulated() ? '  (SIMULATED - no real sandbox calls)' : ' (api-m.sandbox.paypal.com)'}`);
  console.log(`  Dispute agent: ${config.anthropic.apiKey ? config.anthropic.model : 'rules-fallback (set ANTHROPIC_API_KEY for Claude)'}\n`);
});
