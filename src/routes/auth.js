import { Router } from 'express';
import { config } from '../config.js';
import {
  dashboardPath,
  endSession,
  hashPassword,
  startSession,
  userFromRequest,
  verifyPassword,
} from '../auth.js';
import { getInvite, getListing, getUserByEmail, insertInvite, insertSeller, insertUser } from '../db.js';

export const account = Router();

const emailOk = (value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value || '').trim());

function safeNext(value, fallback) {
  const v = String(value || '');
  if (!v.startsWith('/') || v.startsWith('//') || v.includes('\\')) return fallback;
  return v;
}

account.get('/auth/me', (req, res) => {
  res.json({ user: userFromRequest(req) });
});

account.post('/auth/signup', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'seller' ? 'seller' : 'buyer';
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your name' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the password' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });

  let seller_id = null;
  if (role === 'seller') seller_id = insertSeller({ name, email }).id;
  const user = insertUser({ email, name, password_hash: hashPassword(password), role, seller_id });
  startSession(res, user.id, config.baseUrl.startsWith('https'));
  res.status(201).json({ user, next: safeNext(req.body?.next, dashboardPath(user.role)) });
});

account.post('/auth/login', (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const row = getUserByEmail(email);
  if (!row || !verifyPassword(password, row.password_hash)) {
    return res.status(401).json({ error: 'Email or password is wrong' });
  }
  startSession(res, row.id, config.baseUrl.startsWith('https'));
  const user = { id: row.id, email: row.email, name: row.name, role: row.role, seller_id: row.seller_id };
  res.json({ user, next: safeNext(req.body?.next, dashboardPath(user.role)) });
});

account.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

account.post('/invites', (req, res) => {
  const user = userFromRequest(req);
  if (!user || user.role !== 'seller') return res.status(401).json({ error: 'Sign in as a seller to send a payment invite' });
  const listing = getListing(req.body?.listing_id);
  if (!listing || listing.seller_id !== user.seller_id) return res.status(403).json({ error: 'That payment request is not yours' });
  const channel = ['email', 'whatsapp', 'link'].includes(req.body?.channel) ? req.body.channel : 'link';
  const recipient_email = req.body?.recipient_email ? String(req.body.recipient_email).trim() : '';
  if (recipient_email && !emailOk(recipient_email)) return res.status(400).json({ error: 'That buyer email is not valid' });
  const recipient_phone = req.body?.recipient_phone ? String(req.body.recipient_phone).replace(/[^\d+]/g, '').slice(0, 20) : '';
  const invite = insertInvite({
    listing_id: listing.id,
    seller_user_id: user.id,
    recipient_email: recipient_email || null,
    recipient_phone: recipient_phone || null,
    channel,
  });
  res.status(201).json({ ...publicInvite(invite), invite_url: `${config.baseUrl}/i/${invite.id}` });
});

account.get('/invites/:id', (req, res) => {
  const invite = getInvite(req.params.id);
  if (!invite) return res.status(404).json({ error: 'This payment invite was not found' });
  res.json({ ...publicInvite(invite), invite_url: `${config.baseUrl}/i/${invite.id}` });
});

function publicInvite(invite) {
  const { recipient_email, recipient_phone, ...rest } = invite;
  return rest;
}
