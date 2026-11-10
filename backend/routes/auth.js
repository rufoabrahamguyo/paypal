import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import {
  dashboardPath,
  endSession,
  hashPassword,
  readCookie,
  startSession,
  userFromRequest,
  verifyPassword,
} from '../auth.js';
import { countryByCode, listCountries } from '../countries.js';
import { googleConfigured, googleProfile, googleRedirectUri, isGmail } from '../google.js';
import { getInvite, getListing, getUser, getUserByEmail, insertInvite, insertSeller, insertUser, sellerHistory } from '../db.js';

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

account.get('/countries', (req, res) => {
  res.json(listCountries());
});

account.post('/auth/signup', (req, res) => {
  const name = String(req.body?.name || '').trim();
  const email = String(req.body?.email || '').trim().toLowerCase();
  const password = String(req.body?.password || '');
  const role = req.body?.role === 'seller' ? 'seller' : 'buyer';
  const country = countryByCode(req.body?.country);
  if (!country) return res.status(400).json({ error: 'Choose your country' });
  if (name.length < 2 || name.length > 80) return res.status(400).json({ error: 'Enter your name' });
  if (!emailOk(email)) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8) return res.status(400).json({ error: 'Use at least 8 characters for the password' });
  if (getUserByEmail(email)) return res.status(409).json({ error: 'An account with that email already exists. Sign in instead.' });

  let seller_id = null;
  if (role === 'seller') seller_id = insertSeller({ name, email }).id;
  const user = insertUser({
    email,
    name,
    password_hash: hashPassword(password),
    role,
    seller_id,
    country: country.code,
    currency: country.currency,
  });
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
  const user = getUser(row.id);
  res.json({ user, next: safeNext(req.body?.next, dashboardPath(user.role)) });
});

account.post('/auth/logout', (req, res) => {
  endSession(req, res);
  res.json({ ok: true });
});

// Gmail sign-up. Role and country are chosen on the form, then Google confirms
// the address. An existing account with that Gmail is signed in instead.
const GOOGLE_COOKIE = 'funguo_google';

function signState(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.createHmac('sha256', config.kycSecret).update(body).digest('base64url');
  return `${body}.${sig}`;
}

function readState(state) {
  const [body, sig] = String(state || '').split('.');
  if (!body || !sig) return null;
  const expected = crypto.createHmac('sha256', config.kycSecret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    if (!payload || payload.exp < Date.now()) return null;
    return payload;
  } catch {
    return null;
  }
}

function setGoogleCookie(res, nonce) {
  const flags = [`${GOOGLE_COOKIE}=${nonce}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', 'Max-Age=600'];
  if (config.baseUrl.startsWith('https')) flags.push('Secure');
  res.append('Set-Cookie', flags.join('; '));
}

function clearGoogleCookie(res) {
  res.append('Set-Cookie', `${GOOGLE_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

function authReturn(intent, { error, next, role, country } = {}) {
  const params = new URLSearchParams();
  if (error) params.set('error', error);
  if (next) params.set('next', next);
  if (role === 'buyer' || role === 'seller') params.set('role', role);
  if (country) params.set('country', country);
  const path = intent === 'login' ? '/login' : '/signup';
  const q = params.toString();
  return q ? `${path}?${q}` : path;
}

function accountName(profile, email) {
  const name = String(profile.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length >= 2) return name;
  const local = email.split('@')[0].replace(/[^\p{L}\p{N} .'-]/gu, '').trim().slice(0, 80);
  return local.length >= 2 ? local : 'Gmail user';
}

account.get('/auth/google/start', (req, res) => {
  const intent = req.query.intent === 'login' ? 'login' : 'signup';
  const role = req.query.role === 'buyer' ? 'buyer' : 'seller';
  const country = countryByCode(req.query.country);
  const next = safeNext(req.query.next, '');
  const back = {
    next,
    role: intent === 'signup' ? role : '',
    country: intent === 'signup' ? (country?.code || '') : '',
  };
  if (intent === 'signup' && !country) {
    return res.redirect(authReturn('signup', { ...back, error: 'Choose your country' }));
  }
  if (!googleConfigured()) {
    return res.redirect(authReturn(intent, { ...back, error: 'Gmail sign-up needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env.' }));
  }
  const nonce = crypto.randomBytes(16).toString('base64url');
  const state = signState({
    nonce,
    intent,
    role,
    country: country?.code || '',
    next,
    exp: Date.now() + 10 * 60 * 1000,
  });
  setGoogleCookie(res, nonce);
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.google.clientId);
  url.searchParams.set('redirect_uri', googleRedirectUri());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');
  res.redirect(url.toString());
});

account.get('/auth/google/callback', async (req, res) => {
  const state = readState(req.query.state);
  const intent = state?.intent === 'login' ? 'login' : 'signup';
  const role = state?.role === 'buyer' ? 'buyer' : 'seller';
  const next = safeNext(state?.next, '');
  const back = { next, role, country: state?.country || '' };
  if (!state || state.nonce !== readCookie(req, GOOGLE_COOKIE)) {
    return res.redirect(authReturn(intent, { ...back, error: 'That Gmail sign-in expired. Try again.' }));
  }
  clearGoogleCookie(res);
  if (req.query.error || !req.query.code) {
    return res.redirect(authReturn(intent, { ...back, error: 'Gmail sign-in was cancelled.' }));
  }
  try {
    const profile = await googleProfile(String(req.query.code));
    const email = String(profile.email || '').trim().toLowerCase();
    if (profile.email_verified !== true && profile.email_verified !== 'true') {
      return res.redirect(authReturn(intent, { ...back, error: 'Google has not verified that email.' }));
    }
    if (!isGmail(email)) {
      return res.redirect(authReturn(intent, { ...back, error: 'Use a Gmail address (@gmail.com).' }));
    }
    let row = getUserByEmail(email);
    if (!row) {
      if (intent === 'login') {
        return res.redirect(authReturn('signup', { next, error: 'No account for that Gmail yet. Create one below.' }));
      }
      const country = countryByCode(state.country);
      if (!country) return res.redirect(authReturn('signup', { ...back, error: 'Choose your country' }));
      const name = accountName(profile, email);
      const seller_id = role === 'seller' ? insertSeller({ name, email }).id : null;
      try {
        insertUser({
          email,
          name,
          password_hash: 'oauth',
          role,
          seller_id,
          country: country.code,
          currency: country.currency,
        });
      } catch (err) {
        row = getUserByEmail(email);
        if (!row) throw err;
      }
      row = row || getUserByEmail(email);
    }
    startSession(res, row.id, config.baseUrl.startsWith('https'));
    const user = getUser(row.id);
    res.redirect(safeNext(next, dashboardPath(user.role)));
  } catch (err) {
    console.error('[google]', err.message);
    const known = /Google|Gmail|country|email/i.test(err.message || '');
    res.redirect(authReturn(intent, { ...back, error: known ? err.message : 'Gmail sign-in failed.' }));
  }
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
  res.status(201).json({ ...publicInvite(invite), seller: sellerHistory(listing.seller_id), invite_url: `${config.baseUrl}/i/${invite.id}` });
});

account.get('/invites/:id', (req, res) => {
  const invite = getInvite(req.params.id);
  if (!invite) return res.status(404).json({ error: 'This payment invite was not found' });
  res.json({ ...publicInvite(invite), seller: sellerHistory(invite.seller_id), invite_url: `${config.baseUrl}/i/${invite.id}` });
});

function publicInvite(invite) {
  const { recipient_email, recipient_phone, ...rest } = invite;
  return rest;
}
