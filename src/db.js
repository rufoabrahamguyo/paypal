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
  created_at TEXT NOT NULL
);

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

CREATE TABLE IF NOT EXISTS support_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ticket_id TEXT NOT NULL REFERENCES support_tickets(id),
  author_role TEXT NOT NULL,
  author_name TEXT,
  body TEXT NOT NULL,
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

const HELD = ['HELD', 'SHIPPED', 'INSPECTED', 'DISPUTED'];
const RELEASED = ['RELEASED', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL'];

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
  SELECT o.*, l.title AS listing_title, l.image_url, l.seller_id, s.name AS seller_name, s.email AS seller_email
  FROM orders o
  JOIN listings l ON l.id = o.listing_id
  JOIN sellers s ON s.id = l.seller_id
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
    },
  };
}

export function sellerDashboard(sellerId) {
  const seller = getSeller(sellerId);
  if (!seller) return null;
  const orders = ordersForSeller(sellerId);
  const listings = listListings().filter((l) => l.seller_id === sellerId);
  const tickets = listTickets({ email: seller.email, sellerId });
  return {
    seller: { ...seller, verified: !!seller.verified, ...sellerHistory(sellerId) },
    listings,
    orders,
    tickets,
    stats: {
      listings: listings.length,
      orders: orders.length,
      held: moneySum(orders, HELD, (o) => o.amount),
      released: moneySum(orders, RELEASED, (o) => o.captured_amount ?? o.amount),
      open_tickets: tickets.filter((t) => t.status !== 'resolved').length,
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
      `SELECT e.created_at AS at, e.actor, e.order_id, e.from_state, e.to_state, e.note, l.title
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

const publicUser = (u) => (u ? { id: u.id, email: u.email, name: u.name, role: u.role, seller_id: u.seller_id } : null);

export function getUser(id) {
  return publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id));
}

export function getUserByEmail(email) {
  return db.prepare('SELECT * FROM users WHERE email = ?').get(String(email || '').trim().toLowerCase()) || null;
}

export function insertUser({ email, name, password_hash, role, seller_id }) {
  const row = {
    id: newId('usr'),
    email: String(email).trim().toLowerCase(),
    name,
    password_hash,
    role,
    seller_id: seller_id || null,
    created_at: now(),
  };
  db.prepare(
    `INSERT INTO users (id, email, name, password_hash, role, seller_id, created_at)
     VALUES (@id, @email, @name, @password_hash, @role, @seller_id, @created_at)`,
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

export function recordWebhook(evt, verified) {
  db.prepare('INSERT OR IGNORE INTO webhook_events (id, event_type, verified, payload_json, created_at) VALUES (?, ?, ?, ?, ?)').run(
    evt.id ?? newId('whk'),
    evt.event_type ?? null,
    verified ? 1 : 0,
    JSON.stringify(evt),
    now(),
  );
}
