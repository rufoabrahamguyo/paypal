import { Router } from 'express';
import { config } from '../config.js';
import { insertApp, ensureDemoApp, appEventsFor } from '../db.js';

export const apps = Router();

function publicApp(app, withKey) {
  return {
    id: app.id,
    name: app.name,
    webhook_url: app.webhook_url,
    created_at: app.created_at,
    ...(withKey ? { api_key: app.api_key } : {}),
  };
}

apps.get('/apps/demo', (req, res) => {
  const app = ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);
  res.json({ app: publicApp(app, true), shop_url: `${config.baseUrl}/shop` });
});

apps.get('/apps/demo/events', (req, res) => {
  const app = ensureDemoApp(`${config.baseUrl}/api/shop/webhook`);
  res.json({ events: appEventsFor(app.id) });
});

apps.post('/apps', (req, res) => {
  const name = String(req.body?.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  let webhook = req.body?.webhook_url ? String(req.body.webhook_url).trim() : null;
  if (webhook) {
    try {
      const url = new URL(webhook);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('bad protocol');
      webhook = url.toString();
    } catch {
      return res.status(400).json({ error: 'webhook_url must be an http(s) URL' });
    }
  }
  const app = insertApp({ name, webhook_url: webhook });
  res.status(201).json({ app: publicApp(app, true) });
});
