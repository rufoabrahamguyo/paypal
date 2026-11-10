// Gmail sign-up uses Google's OAuth code flow. The browser never sees the
// client secret; we trade the one-time code for the account email here.
import { config } from './config.js';

export const googleRedirectUri = () => `${config.baseUrl}/api/auth/google/callback`;

export function googleConfigured() {
  return Boolean(config.google.clientId && config.google.clientSecret);
}

export function isGmail(email) {
  const host = String(email || '').split('@')[1];
  return host === 'gmail.com' || host === 'googlemail.com';
}

export async function googleProfile(code) {
  const body = new URLSearchParams({
    code,
    client_id: config.google.clientId,
    client_secret: config.google.clientSecret,
    redirect_uri: googleRedirectUri(),
    grant_type: 'authorization_code',
  });
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const token = await tokenRes.json().catch(() => ({}));
  if (!tokenRes.ok || !token.access_token) {
    throw new Error('Google did not accept that sign-in. Try again.');
  }
  const infoRes = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` },
  });
  const info = await infoRes.json().catch(() => ({}));
  if (!infoRes.ok || !info.email) throw new Error('Google did not return an email address.');
  return info;
}
