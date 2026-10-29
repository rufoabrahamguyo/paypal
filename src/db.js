// SQLite schema + helpers. better-sqlite3 is synchronous, which keeps the
// state machine simple: each transition is one transaction.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';

fs.mkdirSync(path.dirname(path.resolve(config.dbPath)), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
CREATE TABLE IF NOT EXISTS sellers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT,
  verified INTEGER NOT NULL DEFAULT 0,      -- mocked KYC flag
  prior_orders INTEGER NOT NULL DEFAULT 0,  -- history imported from elsewhere (seeded)
  prior_disputes INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS listings (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  price REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  image_url TEXT,
  verification_json TEXT,                   -- output of the listing-verification step
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  buyer_name TEXT,
  buyer_email TEXT,
  buyer_kind TEXT NOT NULL DEFAULT 'human', -- human | agent
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  platform_fee REAL NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  payment_method TEXT,
  paypal_order_id TEXT,
  approval_url TEXT,
  authorization_id TEXT,
  authorization_expires_at TEXT,
  capture_id TEXT,
  captured_amount REAL,
  carrier TEXT,
  tracking_number TEXT,
  delivery_status TEXT NOT NULL DEFAULT 'not_shipped', -- not_shipped | in_transit | delivered
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS orders_paypal ON orders(paypal_order_id);

CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_state TEXT,
  to_state TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS paypal_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT,
  op TEXT NOT NULL,
  request_id TEXT,
  http_status INTEGER,
  request_json TEXT,
  response_json TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS disputes (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  complaint TEXT NOT NULL,
  photo_path TEXT,
  photo_mime TEXT,
  status TEXT NOT NULL,                     -- OPEN | RUNNING | DECIDED | ESCALATED | FAILED
  decision TEXT,                            -- release_full | partial_refund | refund_full | escalate_to_human
  refund_amount REAL,
  confidence REAL,
  rationale TEXT,
  findings_json TEXT,
  engine TEXT,                              -- model id, or "rules-fallback"
  transcript_json TEXT,
  paypal_response_json TEXT,
  error TEXT,
  created_at TEXT NOT NULL,
  decided_at TEXT
);

CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  event_type TEXT,
  verified INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT,
  created_at TEXT NOT NULL
);
`);

export const now = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('base64url')}`;

const parse = (s) => (s ? JSON.parse(s) : null);

// ---- sellers / listings ---------------------------------------------------

export const getSeller = (id) => db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
export const listSellers = () => db.prepare('SELECT * FROM sellers ORDER BY created_at').all();

export function sellerHistory(sellerId) {
  const s = getSeller(sellerId);
  if (!s) return null;
  const live = db
    .prepare(
      `SELECT COUNT(DISTINCT o.id) AS orders, COUNT(DISTINCT d.order_id) AS disputes
       FROM orders o JOIN listings l ON l.id = o.listing_id
       LEFT JOIN disputes d ON d.order_id = o.id
       WHERE l.seller_id = ? AND o.state != 'INITIATED'`,
    )
    .get(sellerId);
  const totalOrders = s.prior_orders + live.orders;
  const totalDisputes = s.prior_disputes + live.disputes;
  return {
    seller_id: s.id,
    name: s.name,
    verified: !!s.verified,
    total_orders: totalOrders,
    total_disputes: totalDisputes,
    dispute_rate: totalOrders ? +(totalDisputes / totalOrders).toFixed(3) : null,
    member_since: s.created_at,
  };
}

export function insertListing(l) {
  const row = { id: newId('lst'), currency: 'USD', image_url: null, verification_json: null, created_at: now(), ...l };
  db.prepare(
    `INSERT INTO listings (id, seller_id, title, description, price, currency, image_url, verification_json, created_at)
     VALUES (@id, @seller_id, @title, @description, @price, @currency, @image_url, @verification_json, @created_at)`,
  ).run(row);
  return getListing(row.id);
}

export function getListing(id) {
  const l = db.prepare('SELECT * FROM listings WHERE id = ?').get(id);
  if (!l) return null;
  const { verification_json, ...rest } = l;
  return { ...rest, verification: parse(verification_json) };
}

export const listListings = () =>
  db.prepare('SELECT id FROM listings ORDER BY created_at DESC').all().map((r) => getListing(r.id));

// ---- orders ---------------------------------------------------------------

export function insertOrder(o) {
  const ts = now();
  const row = {
    id: newId('ord'),
    buyer_name: null,
    buyer_email: null,
    buyer_kind: 'human',
    currency: 'USD',
    platform_fee: 0,
    payment_method: null,
    created_at: ts,
    updated_at: ts,
    ...o,
    state: 'INITIATED',
  };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, listing_id, buyer_name, buyer_email, buyer_kind, amount, currency, platform_fee, state, payment_method, created_at, updated_at)
       VALUES (@id, @listing_id, @buyer_name, @buyer_email, @buyer_kind, @amount, @currency, @platform_fee, @state, @payment_method, @created_at, @updated_at)`,
    ).run(row);
    db.prepare(
      'INSERT INTO order_events (order_id, from_state, to_state, actor, note, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
    ).run(row.id, 'INITIATED', row.buyer_kind, 'order created', ts);
  })();
  return getOrder(row.id);
}

export const getOrder = (id) => db.prepare('SELECT * FROM orders WHERE id = ?').get(id);
export const getOrderByPayPalId = (pid) => db.prepare('SELECT * FROM orders WHERE paypal_order_id = ?').get(pid);

const ORDER_COLS = new Set([
  'payment_method', 'platform_fee', 'paypal_order_id', 'approval_url', 'authorization_id', 'authorization_expires_at',
  'capture_id', 'captured_amount', 'carrier', 'tracking_number', 'delivery_status',
]);

export function updateOrder(id, fields) {
  const keys = Object.keys(fields).filter((k) => ORDER_COLS.has(k));
  if (!keys.length) return getOrder(id);
  db.prepare(`UPDATE orders SET ${keys.map((k) => `${k} = @${k}`).join(', ')}, updated_at = @updated_at WHERE id = @id`).run({
    ...Object.fromEntries(keys.map((k) => [k, fields[k]])),
    updated_at: now(),
    id,
  });
  return getOrder(id);
}

/** Write a state change + its audit event atomically. Caller validates legality. */
export function recordTransition(id, from, to, actor, note, fields = {}) {
  db.transaction(() => {
    const res = db.prepare('UPDATE orders SET state = ?, updated_at = ? WHERE id = ? AND state = ?').run(to, now(), id, from);
    if (res.changes !== 1) throw new Error(`Order ${id} is no longer in state ${from}`);
    updateOrder(id, fields);
    db.prepare(
      'INSERT INTO order_events (order_id, from_state, to_state, actor, note, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(id, from, to, actor, note ?? null, now());
  })();
  return getOrder(id);
}

export const orderEvents = (id) => db.prepare('SELECT * FROM order_events WHERE order_id = ? ORDER BY id').all(id);
export const paypalCalls = (id) =>
  db.prepare('SELECT * FROM paypal_calls WHERE order_id = ? ORDER BY id').all(id).map((c) => ({
    ...c,
    request_json: undefined,
    response_json: undefined,
    request: parse(c.request_json),
    response: parse(c.response_json),
  }));

export function logPayPalCall({ orderId, op, requestId, status, request, response }) {
  db.prepare(
    'INSERT INTO paypal_calls (order_id, op, request_id, http_status, request_json, response_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  ).run(orderId ?? null, op, requestId ?? null, status ?? null, JSON.stringify(request ?? null), JSON.stringify(response ?? null), now());
}

export function listOrders() {
  return db
    .prepare(
      `SELECT o.*, l.title AS listing_title FROM orders o JOIN listings l ON l.id = o.listing_id ORDER BY o.created_at DESC LIMIT 100`,
    )
    .all();
}

// ---- disputes -------------------------------------------------------------

export function insertDispute(d) {
  const row = { id: newId('dsp'), photo_path: null, photo_mime: null, status: 'OPEN', created_at: now(), ...d };
  db.prepare(
    `INSERT INTO disputes (id, order_id, complaint, photo_path, photo_mime, status, created_at)
     VALUES (@id, @order_id, @complaint, @photo_path, @photo_mime, @status, @created_at)`,
  ).run(row);
  return getDispute(row.id);
}

const DISPUTE_COLS = new Set([
  'status', 'decision', 'refund_amount', 'confidence', 'rationale', 'findings_json', 'engine',
  'transcript_json', 'paypal_response_json', 'error', 'decided_at',
]);

export function updateDispute(id, fields) {
  const keys = Object.keys(fields).filter((k) => DISPUTE_COLS.has(k));
  if (keys.length) {
    db.prepare(`UPDATE disputes SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`).run({
      ...Object.fromEntries(keys.map((k) => [k, fields[k]])),
      id,
    });
  }
  return getDispute(id);
}

export function getDispute(id) {
  const d = db.prepare('SELECT * FROM disputes WHERE id = ?').get(id);
  if (!d) return null;
  const { findings_json, transcript_json, paypal_response_json, ...rest } = d;
  return {
    ...rest,
    findings: parse(findings_json),
    transcript: parse(transcript_json),
    paypal_response: parse(paypal_response_json),
  };
}

export const disputesForOrder = (orderId) =>
  db.prepare('SELECT id FROM disputes WHERE order_id = ? ORDER BY created_at DESC').all(orderId).map((r) => getDispute(r.id));

export function recordWebhook(evt, verified) {
  db.prepare('INSERT OR IGNORE INTO webhook_events (id, event_type, verified, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    evt.id ?? newId('whk'),
    evt.event_type ?? null,
    verified ? 1 : 0,
    JSON.stringify(evt),
    now(),
  );
}
