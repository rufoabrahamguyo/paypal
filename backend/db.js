// SQLite schema + helpers. better-sqlite3 is synchronous, which keeps the
// state machine simple: each transition is one transaction.
import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from './config.js';
import { labelForCurrency } from './countries.js';
import { platformLabel, profileUrl } from './socials.js';

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
  photo_path TEXT,
  photo_mime TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seller_documents (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  kind TEXT NOT NULL,                       -- id_front | id_back | face
  file_path TEXT NOT NULL,
  mime TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  UNIQUE (seller_id, kind)
);

CREATE TABLE IF NOT EXISTS seller_socials (
  id TEXT PRIMARY KEY,
  seller_id TEXT NOT NULL REFERENCES sellers(id),
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  code TEXT NOT NULL,
  status TEXT NOT NULL,                     -- pending | verified
  verified_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE (seller_id, platform)
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

CREATE TABLE IF NOT EXISTS support_tickets (
  id TEXT PRIMARY KEY,
  author_role TEXT NOT NULL,
  author_name TEXT,
  author_email TEXT NOT NULL,
  seller_id TEXT,
  order_id TEXT,
  topic TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS support_email ON support_tickets(author_email);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL,
  seller_id TEXT,
  country TEXT NOT NULL DEFAULT 'US',
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS community_reports (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  handle TEXT NOT NULL,
  profile_url TEXT NOT NULL,
  reason TEXT NOT NULL,
  body TEXT NOT NULL,
  author_id TEXT NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL,
  UNIQUE (platform, handle, author_id)
);
CREATE INDEX IF NOT EXISTS community_account ON community_reports(platform, handle);

CREATE TABLE IF NOT EXISTS sessions (
  token TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS invites (
  id TEXT PRIMARY KEY,
  listing_id TEXT NOT NULL REFERENCES listings(id),
  seller_user_id TEXT,
  recipient_email TEXT,
  recipient_phone TEXT,
  channel TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS invites_email ON invites(recipient_email);

CREATE TABLE IF NOT EXISTS apps (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key TEXT NOT NULL UNIQUE,
  webhook_url TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS app_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  order_id TEXT,
  type TEXT NOT NULL,
  payload_json TEXT,
  delivered INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS app_events_order ON app_events(order_id);
CREATE INDEX IF NOT EXISTS app_events_app ON app_events(app_id);

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
  author_role TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`);

function addColumn(table, name, def) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${def}`);
}
addColumn('users', 'country', "TEXT NOT NULL DEFAULT 'US'");
addColumn('users', 'currency', "TEXT NOT NULL DEFAULT 'USD'");
addColumn('sellers', 'photo_path', 'TEXT');
addColumn('sellers', 'photo_mime', 'TEXT');
addColumn('orders', 'payment_option', "TEXT NOT NULL DEFAULT 'pal_lock'");
addColumn('orders', 'app_id', 'TEXT');
addColumn('orders', 'external_reference', 'TEXT');
addColumn('orders', 'packing_photo_path', 'TEXT');
addColumn('orders', 'packing_photo_mime', 'TEXT');
addColumn('orders', 'authorized_at', 'TEXT');
addColumn('orders', 'reauthorized_at', 'TEXT');
addColumn('orders', 'description', 'TEXT');
addColumn('orders', 'return_url', 'TEXT');
addColumn('orders', 'cancel_url', 'TEXT');

export const now = () => new Date().toISOString();
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('base64url')}`;

const parse = (s) => (s ? JSON.parse(s) : null);

// ---- sellers / listings ---------------------------------------------------

export const getSeller = (id) => db.prepare('SELECT * FROM sellers WHERE id = ?').get(id);
export const listSellers = () => db.prepare("SELECT * FROM sellers WHERE id != 'sel_apps' ORDER BY created_at").all();

function presentSocial(row, codes) {
  return {
    id: row.id,
    platform: row.platform,
    label: platformLabel(row.platform),
    handle: row.handle,
    profile_url: row.profile_url,
    status: row.status,
    verified_at: row.verified_at,
    reports: communityCount(row.platform, row.handle),
    ...(codes && row.status !== 'verified' ? { code: row.code } : {}),
  };
}

export const REPORT_REASONS = {
  took_money: 'Took the money and disappeared',
  fake_item: 'Sent a fake or different item',
  never_shipped: 'Never sent the item',
  impersonation: 'Pretending to be another shop',
  off_platform: 'Pushed payment outside Funguo',
};

function presentReport(row) {
  return {
    id: row.id,
    platform: row.platform,
    handle: row.handle,
    label: platformLabel(row.platform),
    profile_url: row.profile_url,
    reason: row.reason,
    reason_label: REPORT_REASONS[row.reason] || row.reason,
    body: row.body,
    created_at: row.created_at,
  };
}

export function communityCount(platform, handle) {
  const row = db.prepare(
    'SELECT COUNT(*) AS n FROM community_reports WHERE platform = ? AND handle = ?',
  ).get(platform, String(handle || '').toLowerCase());
  return row?.n || 0;
}

export function communityAccounts() {
  return db.prepare(
    `SELECT platform, handle, profile_url, COUNT(*) AS reports, MAX(created_at) AS latest
     FROM community_reports
     GROUP BY platform, handle
     ORDER BY reports DESC, latest DESC`,
  ).all().map((row) => ({
    platform: row.platform,
    handle: row.handle,
    label: platformLabel(row.platform),
    profile_url: row.profile_url,
    reports: row.reports,
    latest: row.latest,
  }));
}

export function communityReports(platform, handle) {
  return db.prepare(
    'SELECT * FROM community_reports WHERE platform = ? AND handle = ? ORDER BY created_at DESC',
  ).all(platform, String(handle || '').toLowerCase()).map(presentReport);
}

export function insertCommunityReport({ platform, handle, profile_url, reason, body, author_id }) {
  const key = String(handle).toLowerCase();
  const existing = db.prepare(
    'SELECT id FROM community_reports WHERE platform = ? AND handle = ? AND author_id = ?',
  ).get(platform, key, author_id);
  if (existing) {
    const err = new Error('You already reported this account');
    err.status = 409;
    throw err;
  }
  const row = {
    id: newId('rep'),
    platform,
    handle: key,
    profile_url,
    reason,
    body,
    author_id,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO community_reports (id, platform, handle, profile_url, reason, body, author_id, created_at)
     VALUES (@id, @platform, @handle, @profile_url, @reason, @body, @author_id, @created_at)`,
  ).run(row);
  return presentReport(row);
}

export function socialsForSeller(sellerId, { codes = false } = {}) {
  const rows = db.prepare('SELECT * FROM seller_socials WHERE seller_id = ? ORDER BY created_at').all(sellerId);
  return rows.filter((r) => codes || r.status === 'verified').map((r) => presentSocial(r, codes));
}

export function getSocial(id) {
  return db.prepare('SELECT * FROM seller_socials WHERE id = ?').get(id) || null;
}

export function saveSocial({ seller_id, platform, handle }) {
  const profile_url = profileUrl(platform, handle);
  const existing = db.prepare('SELECT * FROM seller_socials WHERE seller_id = ? AND platform = ?').get(seller_id, platform);
  if (existing && existing.handle === handle) return getSocial(existing.id);
  const code = `FUNGUO-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  if (existing) {
    db.prepare(
      `UPDATE seller_socials SET handle = ?, profile_url = ?, code = ?, status = 'pending', verified_at = NULL WHERE id = ?`,
    ).run(handle, profile_url, code, existing.id);
    return getSocial(existing.id);
  }
  const row = { id: newId('soc'), seller_id, platform, handle, profile_url, code, status: 'pending', verified_at: null, created_at: now() };
  db.prepare(
    `INSERT INTO seller_socials (id, seller_id, platform, handle, profile_url, code, status, verified_at, created_at)
     VALUES (@id, @seller_id, @platform, @handle, @profile_url, @code, @status, @verified_at, @created_at)`,
  ).run(row);
  return getSocial(row.id);
}

export function markSocialVerified(id) {
  db.prepare(`UPDATE seller_socials SET status = 'verified', verified_at = ? WHERE id = ?`).run(now(), id);
  return getSocial(id);
}

export function deleteSocial(id, sellerId) {
  const row = getSocial(id);
  if (!row || row.seller_id !== sellerId) return false;
  db.prepare('DELETE FROM seller_socials WHERE id = ?').run(id);
  return true;
}

export function setSellerPhoto(id, photo_path, photo_mime) {
  const prev = getSeller(id);
  db.prepare('UPDATE sellers SET photo_path = ?, photo_mime = ? WHERE id = ?').run(photo_path, photo_mime, id);
  return prev?.photo_path || null;
}

export const IDENTITY_KINDS = ['id_front', 'id_back', 'face'];

export function identityStatus(sellerId) {
  const rows = db.prepare('SELECT kind, submitted_at FROM seller_documents WHERE seller_id = ?').all(sellerId);
  const saved = Object.fromEntries(rows.map((row) => [row.kind, row.submitted_at]));
  const status = {};
  for (const kind of IDENTITY_KINDS) status[kind] = Boolean(saved[kind]);
  const times = rows.map((row) => row.submitted_at).sort();
  return {
    ...status,
    complete: IDENTITY_KINDS.every((kind) => status[kind]),
    submitted_at: times.at(-1) || null,
  };
}

export function getSellerDocument(sellerId, kind) {
  if (!IDENTITY_KINDS.includes(kind)) return null;
  return db.prepare('SELECT * FROM seller_documents WHERE seller_id = ? AND kind = ?').get(sellerId, kind) || null;
}

export function saveSellerDocument(sellerId, kind, file_path, mime) {
  if (!IDENTITY_KINDS.includes(kind)) {
    const err = new Error('Choose the ID front, the ID back, or a photo of your face');
    err.status = 400;
    throw err;
  }
  const prev = getSellerDocument(sellerId, kind);
  const submitted_at = now();
  if (prev) {
    db.prepare('UPDATE seller_documents SET file_path = ?, mime = ?, submitted_at = ? WHERE id = ?').run(file_path, mime, submitted_at, prev.id);
    return prev.file_path;
  }
  db.prepare(
    `INSERT INTO seller_documents (id, seller_id, kind, file_path, mime, submitted_at)
     VALUES (@id, @seller_id, @kind, @file_path, @mime, @submitted_at)`,
  ).run({ id: newId('doc'), seller_id: sellerId, kind, file_path, mime, submitted_at });
  return null;
}

export function listIdentitySellers() {
  const rows = db.prepare(
    `SELECT s.id AS seller_id, s.name, s.email, d.kind, d.submitted_at
     FROM seller_documents d JOIN sellers s ON s.id = d.seller_id
     ORDER BY s.name`,
  ).all();
  const grouped = new Map();
  for (const row of rows) {
    let item = grouped.get(row.seller_id);
    if (!item) {
      item = {
        seller_id: row.seller_id,
        name: row.name,
        email: row.email,
        id_front: false,
        id_back: false,
        face: false,
        submitted_at: row.submitted_at,
      };
      grouped.set(row.seller_id, item);
    }
    if (IDENTITY_KINDS.includes(row.kind)) item[row.kind] = true;
    if (row.submitted_at > item.submitted_at) item.submitted_at = row.submitted_at;
  }
  return [...grouped.values()].map((item) => ({
    ...item,
    complete: item.id_front && item.id_back && item.face,
  }));
}

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
    photo_url: s.photo_path ? `/api/sellers/${s.id}/photo` : null,
    socials: socialsForSeller(s.id),
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

export const EXTERNAL_LISTING_ID = 'lst_apps';

export const listListings = () =>
  db.prepare("SELECT id FROM listings WHERE id != 'lst_apps' ORDER BY created_at DESC").all().map((r) => getListing(r.id));

/** Hidden listing so an app payment can share the orders table without a social-shop item. */
export function externalListingId() {
  if (!getSeller('sel_apps')) {
    db.prepare(
      `INSERT INTO sellers (id, name, email, verified, prior_orders, prior_disputes, created_at)
       VALUES ('sel_apps', 'Pal-Lock apps', NULL, 1, 0, 0, ?)`,
    ).run(now());
  }
  if (!db.prepare('SELECT id FROM listings WHERE id = ?').get(EXTERNAL_LISTING_ID)) {
    db.prepare(
      `INSERT INTO listings (id, seller_id, title, description, price, currency, image_url, verification_json, created_at)
       VALUES ('lst_apps', 'sel_apps', 'Pal-Lock payment', 'Payment created by an app using Pal-Lock.', 0, 'USD', NULL, NULL, ?)`,
    ).run(now());
  }
  return EXTERNAL_LISTING_ID;
}

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
    payment_option: 'pal_lock',
    app_id: null,
    external_reference: null,
    description: null,
    return_url: null,
    cancel_url: null,
    created_at: ts,
    updated_at: ts,
    ...o,
    state: 'INITIATED',
  };
  db.transaction(() => {
    db.prepare(
      `INSERT INTO orders (id, listing_id, buyer_name, buyer_email, buyer_kind, amount, currency, platform_fee, state, payment_method, payment_option, app_id, external_reference, description, return_url, cancel_url, created_at, updated_at)
       VALUES (@id, @listing_id, @buyer_name, @buyer_email, @buyer_kind, @amount, @currency, @platform_fee, @state, @payment_method, @payment_option, @app_id, @external_reference, @description, @return_url, @cancel_url, @created_at, @updated_at)`,
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
  'payment_method', 'payment_option', 'platform_fee', 'paypal_order_id', 'approval_url', 'authorization_id', 'authorization_expires_at',
  'capture_id', 'captured_amount', 'carrier', 'tracking_number', 'delivery_status',
  'app_id', 'external_reference', 'description', 'return_url', 'cancel_url',
  'packing_photo_path', 'packing_photo_mime', 'authorized_at', 'reauthorized_at',
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

/** An event that records something about an order without changing its state. */
export function recordNote(id, actor, note, fields = {}) {
  db.transaction(() => {
    const order = getOrder(id);
    updateOrder(id, fields);
    db.prepare(
      'INSERT INTO order_events (order_id, from_state, to_state, actor, note, created_at) VALUES (?, NULL, ?, ?, ?, ?)',
    ).run(id, order.state, actor, note ?? null, now());
  })();
  return getOrder(id);
}

/** Wallet-funded Pal-Lock holds whose honor period has ended and that have not expired. */
export function holdsDueForReauthorization(honorMs) {
  const cutoff = new Date(Date.now() - honorMs).toISOString();
  return db
    .prepare(
      `SELECT id FROM orders
       WHERE state IN ('HELD', 'SHIPPED', 'INSPECTED', 'DISPUTED')
         AND payment_option = 'pal_lock' AND payment_method = 'paypal'
         AND authorized_at IS NOT NULL AND authorized_at <= ?
         AND (authorization_expires_at IS NULL OR authorization_expires_at > ?)`,
    )
    .all(cutoff, now())
    .map((r) => r.id);
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
      `SELECT o.*, COALESCE(NULLIF(o.description, ''), l.title) AS listing_title
       FROM orders o JOIN listings l ON l.id = o.listing_id
       ORDER BY o.created_at DESC LIMIT 100`,
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

const HELD = ['HELD', 'SHIPPED', 'INSPECTED', 'DISPUTED'];
const RELEASED = ['RELEASED', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL', 'PAID'];

export function listBuyerEmails() {
  return db
    .prepare(
      `SELECT lower(buyer_email) AS email, MAX(buyer_name) AS name, COUNT(*) AS orders
       FROM orders
       WHERE buyer_email IS NOT NULL AND trim(buyer_email) != ''
       GROUP BY lower(buyer_email)
       ORDER BY MAX(created_at) DESC`,
    )
    .all();
}

const orderJoin = `
  SELECT o.*, COALESCE(NULLIF(o.description, ''), l.title) AS listing_title, l.image_url, l.seller_id,
         COALESCE(a.name, s.name) AS seller_name, s.email AS seller_email
  FROM orders o
  JOIN listings l ON l.id = o.listing_id
  JOIN sellers s ON s.id = l.seller_id
  LEFT JOIN apps a ON a.id = o.app_id
`;

export function ordersForBuyer(email) {
  return db.prepare(`${orderJoin} WHERE lower(o.buyer_email) = lower(?) ORDER BY o.updated_at DESC`).all(email);
}

export function ordersForSeller(sellerId) {
  return db.prepare(`${orderJoin} WHERE l.seller_id = ? ORDER BY o.updated_at DESC`).all(sellerId);
}

function moneySum(rows, states, field) {
  return rows.filter((o) => states.includes(o.state)).reduce((sum, o) => sum + Number(field(o) || 0), 0);
}

export function buyerDashboard(email) {
  const orders = ordersForBuyer(email);
  const tickets = listTickets({ email });
  const accountCur = db.prepare('SELECT currency FROM users WHERE lower(email) = lower(?)').get(email)?.currency || 'USD';
  const codes = [...new Set(orders.map((o) => o.currency).filter(Boolean))];
  return {
    buyer: { email, name: orders.find((o) => o.buyer_name)?.buyer_name || null },
    orders,
    invites: invitesForEmail(email),
    tickets,
    stats: {
      orders: orders.length,
      held: moneySum(orders, HELD, (o) => o.amount),
      released: moneySum(orders, RELEASED, (o) => o.captured_amount ?? o.amount),
      open_tickets: tickets.filter((t) => t.status !== 'resolved').length,
      currency: codes.length === 1 ? codes[0] : accountCur,
    },
  };
}

export function sellerDashboard(sellerId) {
  const seller = getSeller(sellerId);
  if (!seller) return null;
  const orders = ordersForSeller(sellerId);
  const listings = listListings().filter((l) => l.seller_id === sellerId);
  const tickets = listTickets({ email: seller.email, sellerId });
  const account = getUserBySellerId(sellerId);
  const currency = account?.currency || 'USD';
  const { photo_path, photo_mime, ...sellerRest } = seller;
  return {
    seller: {
      ...sellerRest,
      verified: !!seller.verified,
      ...sellerHistory(sellerId),
      country: account?.country || null,
      currency,
      currency_label: labelForCurrency(currency),
    },
    listings,
    orders,
    tickets,
    stats: {
      listings: listings.length,
      orders: orders.length,
      held: moneySum(orders, HELD, (o) => o.amount),
      released: moneySum(orders, RELEASED, (o) => o.captured_amount ?? o.amount),
      open_tickets: tickets.filter((t) => t.status !== 'resolved').length,
      currency,
    },
  };
}

export function listTickets({ email, sellerId, openOnly } = {}) {
  let rows = [];
  if (email) {
    rows.push(...db.prepare('SELECT * FROM support_tickets WHERE lower(author_email) = lower(?)').all(email));
  }
  if (sellerId) {
    rows.push(...db.prepare('SELECT * FROM support_tickets WHERE seller_id = ?').all(sellerId));
  }
  if (!email && !sellerId) {
    rows = db.prepare('SELECT * FROM support_tickets').all();
  }
  const seen = new Set();
  return rows
    .filter((t) => (seen.has(t.id) ? false : seen.add(t.id)))
    .filter((t) => (openOnly ? t.status !== 'resolved' : true))
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
}

export function getTicket(id) {
  const ticket = db.prepare('SELECT * FROM support_tickets WHERE id = ?').get(id);
  if (!ticket) return null;
  const messages = db.prepare('SELECT * FROM support_messages WHERE ticket_id = ? ORDER BY id').all(id);
  return { ...ticket, messages };
}

export function insertTicket(t) {
  const ts = now();
  const row = {
    id: newId('tkt'),
    author_name: null,
    seller_id: null,
    order_id: null,
    status: 'open',
    created_at: ts,
    updated_at: ts,
    ...t,
  };
  db.prepare(
    `INSERT INTO support_tickets
      (id, author_role, author_name, author_email, seller_id, order_id, topic, subject, body, status, created_at, updated_at)
     VALUES (@id, @author_role, @author_name, @author_email, @seller_id, @order_id, @topic, @subject, @body, @status, @created_at, @updated_at)`,
  ).run(row);
  return getTicket(row.id);
}

export function addTicketMessage(ticketId, { author_role, author_name, body }) {
  const ts = now();
  db.prepare(
    'INSERT INTO support_messages (ticket_id, author_role, author_name, body, created_at) VALUES (?, ?, ?, ?, ?)',
  ).run(ticketId, author_role, author_name ?? null, body, ts);
  const ticket = db.prepare('SELECT status FROM support_tickets WHERE id = ?').get(ticketId);
  let status = ticket.status;
  if (author_role === 'support' && status === 'open') status = 'in_review';
  if (author_role !== 'support' && status === 'resolved') status = 'open';
  db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, ts, ticketId);
  return getTicket(ticketId);
}

export function setTicketStatus(id, status) {
  db.prepare('UPDATE support_tickets SET status = ?, updated_at = ? WHERE id = ?').run(status, now(), id);
  return getTicket(id);
}

/** Every dispute with its order, for the admin decisions ledger (AG Grid). */
export function disputeLedger(limit = 500) {
  return db
    .prepare(
      `SELECT d.id, d.order_id, d.status, d.decision, d.refund_amount, d.confidence, d.engine,
              d.findings_json, d.created_at, d.decided_at, d.complaint,
              o.amount, o.currency, o.state AS order_state, o.buyer_kind, o.authorization_id, o.capture_id,
              COALESCE(NULLIF(o.description, ''), l.title) AS item, s.name AS seller
       FROM disputes d
       JOIN orders o ON o.id = d.order_id
       JOIN listings l ON l.id = o.listing_id
       LEFT JOIN sellers s ON s.id = l.seller_id
       ORDER BY d.created_at DESC LIMIT ?`,
    )
    .all(limit)
    .map(({ findings_json, created_at, decided_at, ...d }) => {
      const f = parse(findings_json) ?? {};
      const seconds = decided_at ? Math.round((Date.parse(decided_at) - Date.parse(created_at)) / 1000) : null;
      return {
        ...d,
        created_at,
        decided_at,
        seconds_to_decide: seconds,
        guardrail: f.guardrail ?? null,
        proposed_decision: f.proposed_decision ?? null,
        human_decision: f.human_decision ?? null,
      };
    });
}

export function auditCounts() {
  const n = (sql) => db.prepare(sql).get().n;
  return {
    orders: n('SELECT COUNT(*) AS n FROM orders'),
    events: n('SELECT COUNT(*) AS n FROM order_events'),
    paypal_calls: n('SELECT COUNT(*) AS n FROM paypal_calls'),
    disputes: n('SELECT COUNT(*) AS n FROM disputes'),
    tickets: n('SELECT COUNT(*) AS n FROM support_tickets'),
    tickets_open: n("SELECT COUNT(*) AS n FROM support_tickets WHERE status != 'resolved'"),
    webhooks: n('SELECT COUNT(*) AS n FROM webhook_events'),
  };
}

export function auditTrail(limit = 120) {
  const clip = (s, n = 220) => (s && s.length > n ? `${s.slice(0, n)}…` : s || '');
  const orders = db
    .prepare(
      `SELECT e.created_at AS at, e.actor, e.order_id, e.from_state, e.to_state, e.note,
              COALESCE(NULLIF(o.description, ''), l.title) AS title
       FROM order_events e
       JOIN orders o ON o.id = e.order_id
       JOIN listings l ON l.id = o.listing_id
       ORDER BY e.id DESC LIMIT ?`,
    )
    .all(limit)
    .map((e) => ({
      at: e.at,
      kind: 'order',
      actor: e.actor,
      summary: `${e.from_state ? `${e.from_state} → ` : ''}${e.to_state}${e.note ? ` · ${clip(e.note)}` : ''}`,
      title: e.title,
      ref: e.order_id,
      href: `/o/${e.order_id}`,
    }));
  const paypal = db
    .prepare('SELECT id, order_id, op, http_status, created_at FROM paypal_calls ORDER BY id DESC LIMIT ?')
    .all(limit)
    .map((c) => ({
      at: c.created_at,
      kind: 'paypal',
      actor: 'paypal',
      summary: `${c.op} · HTTP ${c.http_status ?? '—'}`,
      title: c.order_id || 'PayPal',
      ref: c.order_id,
      href: c.order_id ? `/o/${c.order_id}` : null,
    }));
  const disputes = db
    .prepare('SELECT id, order_id, status, decision, complaint, created_at, engine FROM disputes ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((d) => ({
      at: d.created_at,
      kind: 'dispute',
      actor: d.engine || 'agent',
      summary: `${d.status}${d.decision ? ` · ${d.decision}` : ''} · ${clip(d.complaint, 160)}`,
      title: d.order_id,
      ref: d.id,
      href: `/o/${d.order_id}`,
    }));
  const tickets = db
    .prepare('SELECT id, subject, status, topic, author_email, updated_at FROM support_tickets ORDER BY updated_at DESC LIMIT ?')
    .all(limit)
    .map((t) => ({
      at: t.updated_at,
      kind: 'support',
      actor: t.author_email,
      summary: `${t.status} · ${t.topic} · ${t.subject}`,
      title: t.subject,
      ref: t.id,
      href: `/support/${t.id}`,
    }));
  const hooks = db
    .prepare('SELECT id, event_type, verified, created_at FROM webhook_events ORDER BY created_at DESC LIMIT ?')
    .all(limit)
    .map((w) => ({
      at: w.created_at,
      kind: 'webhook',
      actor: w.verified ? 'verified' : 'unverified',
      summary: w.event_type || 'webhook',
      title: w.id,
      ref: w.id,
      href: null,
    }));
  return [...orders, ...paypal, ...disputes, ...tickets, ...hooks]
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0))
    .slice(0, limit);
}

export function insertSeller({ name, email }) {
  const row = { id: newId('sel'), name, email, verified: 0, prior_orders: 0, prior_disputes: 0, created_at: now() };
  db.prepare(
    `INSERT INTO sellers (id, name, email, verified, prior_orders, prior_disputes, created_at)
     VALUES (@id, @name, @email, @verified, @prior_orders, @prior_disputes, @created_at)`,
  ).run(row);
  return getSeller(row.id);
}

const publicUser = (u) =>
  u
    ? {
        id: u.id,
        email: u.email,
        name: u.name,
        role: u.role,
        seller_id: u.seller_id,
        country: u.country || 'US',
        currency: u.currency || 'USD',
        currency_label: labelForCurrency(u.currency || 'USD'),
      }
    : null;

export function getUserBySellerId(sellerId) {
  if (!sellerId) return null;
  return publicUser(db.prepare('SELECT * FROM users WHERE seller_id = ?').get(sellerId));
}

export function getUser(id) {
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase()) || null;
}

export function insertUser({ email, name, password_hash, role, seller_id, country = 'US', currency = 'USD' }) {
  const row = {
    id: newId('usr'),
    email: String(email).trim().toLowerCase(),
    name,
    password_hash,
    role,
    seller_id: seller_id || null,
    country,
    currency,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, seller_id, country, currency, created_at)
     VALUES (@id, @email, @name, @password_hash, @role, @seller_id, @country, @currency, @created_at)`,
  ).run(row);
  return getUser(row.id);
}

export function createSession(userId) {
  const token = crypto.randomBytes(32).toString('base64url');
  const created_at = now();
  const expires_at = new Date(Date.now() + 14 * 864e5).toISOString();
  db.prepare('INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)').run(token, userId, expires_at, created_at);
  return { token, expires_at };
}

export function userForToken(token) {
  if (!token) return null;
  const row = db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires_at > ?`,
  ).get(token, now());
  return publicUser(row);
}

export function deleteSession(token) {
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
}

export function insertInvite(i) {
  const row = {
    id: newId('inv'),
    seller_user_id: null,
    recipient_email: null,
    recipient_phone: null,
    created_at: now(),
    ...i,
    recipient_email: i.recipient_email ? String(i.recipient_email).trim().toLowerCase() : null,
  };
  db.prepare(
    `INSERT INTO invites (id, listing_id, seller_user_id, recipient_email, recipient_phone, channel, created_at)
     VALUES (@id, @listing_id, @seller_user_id, @recipient_email, @recipient_phone, @channel, @created_at)`,
  ).run(row);
  return getInvite(row.id);
}

const inviteJoin = `
  SELECT i.id, i.listing_id, i.recipient_email, i.recipient_phone, i.channel, i.created_at,
         l.title, l.description, l.price, l.currency, l.image_url, l.seller_id, s.name AS seller_name
  FROM invites i
  JOIN listings l ON l.id = i.listing_id
  JOIN sellers s ON s.id = l.seller_id
`;

export function getInvite(id) {
  return db.prepare(`${inviteJoin} WHERE i.id = ?`).get(id) || null;
}

export function invitesForEmail(email) {
  return db.prepare(`${inviteJoin} WHERE lower(i.recipient_email) = lower(?) ORDER BY i.created_at DESC`).all(email);
}

export function insertApp({ name, webhook_url = null }) {
  const row = {
    id: newId('app'),
    name: String(name).slice(0, 80),
    api_key: `fl_${crypto.randomBytes(24).toString('base64url')}`,
    webhook_url,
    created_at: now(),
  };
  db.prepare('INSERT INTO apps (id, name, api_key, webhook_url, created_at) VALUES (@id, @name, @api_key, @webhook_url, @created_at)').run(row);
  return row;
}

export const getApp = (id) => db.prepare('SELECT * FROM apps WHERE id = ?').get(id);
export const getAppByKey = (key) => (key ? db.prepare('SELECT * FROM apps WHERE api_key = ?').get(key) : null);
export const getAppByName = (name) => db.prepare('SELECT * FROM apps WHERE name = ? ORDER BY created_at LIMIT 1').get(name);

export function ensureDemoApp(webhookUrl) {
  let app = getAppByName('Abode');
  if (!app) return insertApp({ name: 'Abode', webhook_url: webhookUrl });
  if (app.webhook_url !== webhookUrl && String(app.webhook_url || '').includes('/api/shop/webhook')) {
    db.prepare('UPDATE apps SET webhook_url = ? WHERE id = ?').run(webhookUrl, app.id);
    app = getApp(app.id);
  }
  return app;
}

export function insertAppEvent({ appId, orderId, type, payload, delivered }) {
  const row = {
    id: newId('evt'),
    app_id: appId,
    order_id: orderId ?? null,
    type,
    payload_json: JSON.stringify(payload),
    delivered: delivered ? 1 : 0,
    created_at: now(),
  };
  db.prepare(
    'INSERT INTO app_events (id, app_id, order_id, type, payload_json, delivered, created_at) VALUES (@id, @app_id, @order_id, @type, @payload_json, @delivered, @created_at)',
  ).run(row);
  return row.id;
}

export function appEventsFor(appId, limit = 20) {
  return db
    .prepare('SELECT * FROM app_events WHERE app_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(appId, limit)
    .map((e) => ({ id: e.id, type: e.type, order_id: e.order_id, delivered: !!e.delivered, created_at: e.created_at, payload: parse(e.payload_json) }));
}

export function appEventsForOrder(orderId) {
  return db
    .prepare('SELECT * FROM app_events WHERE order_id = ? ORDER BY created_at')
    .all(orderId)
    .map((e) => ({ id: e.id, type: e.type, delivered: !!e.delivered, created_at: e.created_at }));
}

export function recordWebhook(evt, verified) {
  db.prepare('INSERT OR IGNORE INTO webhook_events (id, event_type, verified, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    evt.id ?? newId('whk'),
    evt.event_type ?? null,
    verified ? 1 : 0,
    JSON.stringify(evt),
    now(),
  );
}
