import { Router } from 'express';
import { userFromRequest } from '../auth.js';
import {
  communityAccounts,
  communityReports,
  insertCommunityReport,
  REPORT_REASONS,
} from '../db.js';
import { cleanHandle, PLATFORMS, profileUrl } from '../socials.js';

export const community = Router();

function platformFromText(raw) {
  const text = String(raw || '');
  if (!/^https?:\/\//i.test(text) && !/[a-z0-9.-]+\.[a-z]{2,}\//i.test(text)) return null;
  try {
    const url = new URL(text.includes('://') ? text : `https://${text}`);
    const host = url.hostname.replace(/^www\./, '');
    if (host.endsWith('instagram.com')) return 'instagram';
    if (host.endsWith('tiktok.com')) return 'tiktok';
    if (host.endsWith('facebook.com') || host.endsWith('fb.com')) return 'facebook';
    if (host === 'x.com' || host.endsWith('twitter.com')) return 'x';
    if (host.endsWith('youtube.com') || host === 'youtu.be') return 'youtube';
  } catch {
    return null;
  }
  return null;
}

function accountView(platform, handle) {
  const reports = communityReports(platform, handle);
  return {
    platform,
    handle,
    label: PLATFORMS[platform].label,
    profile_url: profileUrl(platform, handle),
    count: reports.length,
    reports,
  };
}

community.get('/community', (req, res) => {
  const reasons = Object.entries(REPORT_REASONS).map(([id, label]) => ({ id, label }));
  const accounts = communityAccounts();
  const q = String(req.query.q || '').trim();
  let platform = String(req.query.platform || '');
  let handle = cleanHandle(req.query.handle || q);
  if (!platform && q) platform = platformFromText(q) || '';
  if (platform && !PLATFORMS[platform]) return res.status(400).json({ error: 'Choose TikTok, Instagram, Facebook, X, or YouTube' });
  if ((q || req.query.handle) && !handle) return res.status(400).json({ error: 'Enter a username or a profile link' });

  let checked = null;
  if (platform && handle) checked = accountView(platform, handle);
  else if (handle) {
    checked = {
      handle,
      matches: accounts.filter((row) => row.handle === handle),
    };
  }
  res.json({ reasons, accounts, checked });
});

community.post('/community', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to report an account' });
  const platform = String(req.body?.platform || '') || platformFromText(req.body?.handle) || '';
  if (!PLATFORMS[platform]) return res.status(400).json({ error: 'Choose TikTok, Instagram, Facebook, X, or YouTube' });
  const handle = cleanHandle(req.body?.handle);
  if (!handle) return res.status(400).json({ error: 'Enter the username from that account' });
  const reason = String(req.body?.reason || '');
  if (!REPORT_REASONS[reason]) return res.status(400).json({ error: 'Choose what happened' });
  const body = String(req.body?.body || '').trim().replace(/\s+/g, ' ');
  if (body.length < 20 || body.length > 800) return res.status(400).json({ error: 'Describe what happened in 20–800 characters' });
  if (/\d{8,}/.test(body)) return res.status(400).json({ error: 'Leave out phone numbers and ID numbers. Name the account and what the shop did.' });
  const report = insertCommunityReport({
    platform,
    handle,
    profile_url: profileUrl(platform, handle),
    reason,
    body,
    author_id: user.id,
  });
  res.status(201).json({ report, account: accountView(platform, handle.toLowerCase()) });
});
