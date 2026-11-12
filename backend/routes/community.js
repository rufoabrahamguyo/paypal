import { Router } from 'express';
import { userFromRequest } from '../auth.js';
import {
  communityAccounts,
  communityComments,
  communityCommentCount,
  communityReactions,
  communityReports,
  insertCommunityComment,
  insertCommunityReport,
  REACTION_KINDS,
  REPORT_REASONS,
  platformName,
  rememberPlatformName,
  toggleCommunityReaction,
} from '../db.js';
import { cleanHandle, isPlatformId, PLATFORMS, profileUrl, resolvePlatform } from '../socials.js';

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

function accountView(platform, handle, userId) {
  const reports = communityReports(platform, handle);
  return {
    platform,
    handle,
    label: platformName(platform),
    profile_url: profileUrl(platform, handle),
    count: reports.length,
    reports,
    comment_count: communityCommentCount(platform, handle),
    comments: communityComments(platform, handle),
    reactions: communityReactions(platform, handle, userId),
  };
}

function chosenPlatform(body) {
  const raw = String(body?.platform || '');
  if (raw) return resolvePlatform(raw, body?.platform_name);
  const fromLink = platformFromText(body?.handle);
  if (fromLink) return { id: fromLink, label: PLATFORMS[fromLink].label, custom: false };
  return { error: 'Choose an app, or pick Other and type its name' };
}

function cleanBody(value, min, max) {
  const body = String(value || '').trim().replace(/\s+/g, ' ');
  if (body.length < min || body.length > max) return { error: `Write ${min}–${max} characters` };
  if (/\d{8,}/.test(body)) return { error: 'Leave out phone numbers and ID numbers.' };
  return { body };
}

community.get('/community', (req, res) => {
  const user = userFromRequest(req);
  const reasons = Object.entries(REPORT_REASONS).map(([id, label]) => ({ id, label }));
  const reaction_kinds = Object.entries(REACTION_KINDS).map(([id, label]) => ({ id, label }));
  const accounts = communityAccounts(user?.id);
  const q = String(req.query.q || '').trim();
  let platform = String(req.query.platform || '');
  let handle = cleanHandle(req.query.handle || q);
  if (!platform && q) platform = platformFromText(q) || '';
  if (platform && !isPlatformId(platform)) return res.status(400).json({ error: 'Choose an app, or pick Other and type its name' });
  if ((q || req.query.handle) && !handle) return res.status(400).json({ error: 'Enter a username or a profile link' });

  let checked = null;
  if (platform && handle) checked = accountView(platform, handle, user?.id);
  else if (handle) {
    checked = {
      handle,
      matches: accounts.filter((row) => row.handle === handle),
    };
  }
  res.json({ reasons, reaction_kinds, accounts, checked });
});

community.post('/community', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to report an account' });
  const picked = chosenPlatform(req.body);
  if (picked.error) return res.status(400).json({ error: picked.error });
  const platform = picked.id;
  const handle = cleanHandle(req.body?.handle);
  if (!handle) return res.status(400).json({ error: 'Enter the username from that account' });
  const reason = String(req.body?.reason || '');
  if (!REPORT_REASONS[reason]) return res.status(400).json({ error: 'Choose what happened' });
  const cleaned = cleanBody(req.body?.body, 20, 800);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error === 'Write 20–800 characters' ? 'Describe what happened in 20–800 characters' : cleaned.error });
  rememberPlatformName(platform, picked.label);
  const report = insertCommunityReport({
    platform,
    handle,
    profile_url: profileUrl(platform, handle) || '',
    reason,
    body: cleaned.body,
    author_id: user.id,
  });
  res.status(201).json({ report, account: accountView(platform, handle.toLowerCase(), user.id) });
});

community.post('/community/comments', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to comment' });
  const platform = String(req.body?.platform || '');
  if (!isPlatformId(platform)) return res.status(400).json({ error: 'Choose an app, or pick Other and type its name' });
  const handle = cleanHandle(req.body?.handle);
  if (!handle) return res.status(400).json({ error: 'That account was not found' });
  const cleaned = cleanBody(req.body?.body, 2, 500);
  if (cleaned.error) return res.status(400).json({ error: cleaned.error === 'Write 2–500 characters' ? 'Write a comment' : cleaned.error });
  insertCommunityComment({ platform, handle, author_id: user.id, body: cleaned.body });
  res.status(201).json({ account: accountView(platform, handle, user.id) });
});

community.post('/community/reactions', (req, res) => {
  const user = userFromRequest(req);
  if (!user) return res.status(401).json({ error: 'Sign in to react' });
  const platform = String(req.body?.platform || '');
  if (!isPlatformId(platform)) return res.status(400).json({ error: 'Choose an app, or pick Other and type its name' });
  const handle = cleanHandle(req.body?.handle);
  if (!handle) return res.status(400).json({ error: 'That account was not found' });
  const kind = String(req.body?.kind || '');
  if (!REACTION_KINDS[kind]) return res.status(400).json({ error: 'Choose a reaction' });
  toggleCommunityReaction({ platform, handle, userId: user.id, kind });
  res.json({ account: accountView(platform, handle, user.id) });
});
