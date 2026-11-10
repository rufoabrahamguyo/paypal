// Developer portal API: apps, credentials, webhooks and the event log.
// Every route except the public demo app needs a signed-in user, and an app is
// only visible to the user who created it.
import { Router } from 'express';
import { config } from '../config.js';
import { userFromRequest } from '../auth.js';
import {
  appEventsFor,
  appPayments,
  appStats,
  appsForUser,
  deleteApp,
  ensureDemoApp,
  getApp,
  insertApp,
  insertAppEvent,
  rotateAppSecret,
  updateApp,
} from '../db.js';
import { deliverWebhook, paymentPublic } from '../escrow.js';

export const apps = Router();

function publicApp(app, withSecrets) {
  return {
    id: app.id,
    name: app.name,
    webhook_url: app.webhook_url,
    created_at: app.created_at,
    ...(withSecrets ? { api_key: app.api_key, webhook_secret: app.webhook_secret } : {}),
  };
}

function webhookUrl(raw) {
  if (raw == null || String(raw).trim() === '') return null;
  const url = new URL(String(raw).trim());
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
  return url.toString();
}

function requireUser(req, res, next) {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to manage apps' });
  req.user = user;
  next();
}

function ownedApp(req, res) {
  const app = getApp(req.params.id);
  if (!app || app.owner_user_id !== req.user.id) {
    res.status(404).json({ error: 'App not found' });
    return null;
  }
  return app;
}

// ---- public sandbox app (the Abode sample shop) ---------------------------------
apps.get('/apps/demo', (req, res) => {
  const app = ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);
  res.json({ app: publicApp(app, false), api_key: app.api_key, shop_url: `${config.baseUrl}/shop` });
});

apps.get('/apps/demo/events', (req, res) => {
  const app = ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);
  res.json({ events: appEventsFor(app.id) });
});

// ---- apps & credentials ----------------------------------------------------------------
apps.use('/developer', requireUser);

apps.get('/developer/apps', (req, res) => {
  res.json({
    apps: appsForUser(req.user.id).map((a) => ({ ...publicApp(a, false), stats: appStats(a.id) })),
  });
});

apps.post('/developer/apps', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  let webhook;
  try {
    webhook = webhookUrl(req.body?.webhook_url);
  } catch {
    return res.status(400).json({ error: 'webhook_url must be an http(s) URL' });
  }
  const app = insertApp({ name, webhook_url: webhook, owner_user_id: req.user.id });
  res.status(201).json({ app: publicApp(app, true) });
});

apps.get('/developer/apps/:id', (req, res) => {
  const app = ownedApp(req, res);
  if (!app) return;
  res.json({
    app: publicApp(app, true),
    stats: appStats(app.id),
    payments: appPayments(app.id).map((o) => ({ ...paymentPublic(o), created_at: o.created_at, updated_at: o.updated_at })),
    events: appEventsFor(app.id, 50),
  });
});

apps.patch('/developer/apps/:id', (req, res) => {
  const app = ownedApp(req, res);
  if (!app) return;
  const patch = {};
  if (req.body?.name !== undefined) {
    patch.name = String(req.body.name).trim();
    if (!patch.name) return res.status(400).json({ error: 'name cannot be empty' });
  }
  if (req.body?.webhook_url !== undefined) {
    try {
      patch.webhook_url = webhookUrl(req.body.webhook_url);
    } catch {
      return res.status(400).json({ error: 'webhook_url must be an http(s) URL' });
    }
  }
  res.json({ app: publicApp(updateApp(app.id, patch), true) });
});

apps.post('/developer/apps/:id/rotate', (req, res) => {
  const app = ownedApp(req, res);
  if (!app) return;
  const which = req.body?.which === 'webhook' ? 'webhook' : 'secret';
  res.json({ app: publicApp(rotateAppSecret(app.id, which), true) });
});

apps.post('/developer/apps/:id/webhook-test', async (req, res) => {
  const app = ownedApp(req, res);
  if (!app) return;
  if (!app.webhook_url) return res.status(400).json({ error: 'Add a webhook URL first' });
  const payload = { type: 'webhook.test', created_at: new Date().toISOString(), payment: null };
  const result = await deliverWebhook(app, 'webhook.test', payload);
  insertAppEvent({ appId: app.id, orderId: null, type: 'webhook.test', payload, delivered: result.delivered });
  res.json(result);
});

apps.delete('/developer/apps/:id', (req, res) => {
  const app = ownedApp(req, res);
  if (!app) return;
  deleteApp(app.id);
  res.status(204).end();
});
