import crypto from 'node:crypto';
import { createSession, deleteSession, getUserByEmail, userForToken } from './db.js';

const COOKIE = 'funguo_session';

export function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(password, salt, 32).toString('base64url');
  return `${salt}:${hash}`;
}

export function verifyPassword(password, stored) {
  const [salt, hash] = String(stored || '').split(':');
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(password, salt, 32);
  const exp = Buffer.from(hash, 'base64url');
  if (got.length !== exp.length) return false;
  return crypto.timingSafeEqual(got, exp);
}

export function readCookie(req, name = COOKIE) {
  const raw = req.headers.cookie || '';
  for (const part of raw.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function userFromRequest(req) {
  return userForToken(readCookie(req));
}

export function startSession(res, userId, secure) {
  const { token } = createSession(userId);
  const flags = [`${COOKIE}=${encodeURIComponent(token)}`, 'HttpOnly', 'Path=/', 'SameSite=Lax', `Max-Age=${14 * 86400}`];
  if (secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

export function endSession(req, res) {
  deleteSession(readCookie(req));
  res.setHeader('Set-Cookie', `${COOKIE}=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0`);
}

export function dashboardPath(role) {
  if (role === 'seller') return '/seller';
  if (role === 'admin') return '/admin';
  return '/buyer';
}

export { getUserByEmail };
