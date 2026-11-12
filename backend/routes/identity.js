import { Router } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { config } from '../config.js';
import { userFromRequest } from '../auth.js';
import {
  deleteSocial,
  getSeller,
  getSellerDocument,
  getSocial,
  IDENTITY_KINDS,
  identityStatus,
  kycFor,
  setKyc,
  markSocialVerified,
  saveSellerDocument,
  rememberPlatformName,
  saveSocial,
  setSellerPhoto,
  socialsForSeller,
} from '../db.js';
import { verifyIdentity } from '../kyc.js';
import { cleanHandle, isCustomPlatform, listPlatforms, profileHasCode, resolvePlatform } from '../socials.js';

export const identity = Router();

const UPLOADS = path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `seller-${req.userId}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Photo must be JPEG, PNG, WebP or GIF');
    err.status = 400;
    cb(err);
  },
});

function sellerUser(req, res) {
  const user = userFromRequest(req);
  if (!user || user.role !== 'seller' || !user.seller_id) {
    res.status(401).json({ error: 'Sign in as a seller' });
    return null;
  }
  return user;
}

function insideUploads(file) {
  const root = path.resolve(UPLOADS);
  const abs = path.resolve(file);
  return abs === root || abs.startsWith(root + path.sep);
}

identity.get('/social-platforms', (req, res) => {
  res.json(listPlatforms());
});

identity.post('/seller/photo', (req, res, next) => {
  const user = sellerUser(req, res);
  if (!user) return;
  req.userId = user.seller_id.replace(/[^a-z0-9_-]/gi, '');
  next();
}, upload.single('photo'), (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  if (!req.file) return res.status(400).json({ error: 'Choose a photo' });
  const previous = setSellerPhoto(user.seller_id, req.file.path, req.file.mimetype);
  if (previous && previous !== req.file.path && insideUploads(previous)) fs.rmSync(previous, { force: true });
  res.json({ photo_url: `/api/sellers/${user.seller_id}/photo` });
});

identity.get('/sellers/:id/photo', (req, res) => {
  const seller = getSeller(req.params.id);
  if (!seller?.photo_path || !fs.existsSync(seller.photo_path)) return res.sendStatus(404);
  res.type(seller.photo_mime || 'application/octet-stream').sendFile(path.resolve(seller.photo_path));
});

identity.post('/seller/socials', (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  const picked = resolvePlatform(req.body?.platform, req.body?.platform_name);
  if (picked.error) return res.status(400).json({ error: picked.error });
  const handle = cleanHandle(req.body?.handle);
  if (!handle) return res.status(400).json({ error: 'Enter the username from that account' });
  rememberPlatformName(picked.id, picked.label);
  saveSocial({ seller_id: user.seller_id, platform: picked.id, handle });
  res.status(201).json({ socials: socialsForSeller(user.seller_id, { codes: true }) });
});

identity.post('/seller/socials/:id/check', async (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  const row = getSocial(req.params.id);
  if (!row || row.seller_id !== user.seller_id) return res.status(404).json({ error: 'That account was not found' });
  if (row.status === 'verified') return res.json({ socials: socialsForSeller(user.seller_id, { codes: true }) });
  if (isCustomPlatform(row.platform)) {
    return res.status(422).json({ error: 'A code check only runs on TikTok, Instagram, Facebook, X, and YouTube.' });
  }
  let result;
  try {
    result = await profileHasCode(row.platform, row.handle, row.code);
  } catch {
    return res.status(502).json({ error: 'Could not open that profile. Leave the code public and try again.' });
  }
  if (!result.found) {
    const error = result.blocked
      ? 'That site did not show a public page, so the code could not be checked.'
      : `Put ${row.code} in the bio or a public post, then check again.`;
    return res.status(422).json({ error });
  }
  markSocialVerified(row.id);
  res.json({ socials: socialsForSeller(user.seller_id, { codes: true }) });
});

identity.delete('/seller/socials/:id', (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  if (!deleteSocial(req.params.id, user.seller_id)) return res.status(404).json({ error: 'That account was not found' });
  res.json({ socials: socialsForSeller(user.seller_id, { codes: true }) });
});

const idUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `id-${req.userId}-${file.fieldname}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 3 },
  fileFilter: (req, file, cb) => {
    if (IDENTITY_KINDS.includes(file.fieldname) && IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Each photo must be JPEG, PNG, WebP or GIF');
    err.status = 400;
    cb(err);
  },
});

function sendPrivateImage(res, filePath, mime) {
  res.set('Cache-Control', 'private, no-store');
  res.type(mime || 'application/octet-stream').sendFile(path.resolve(filePath));
}

identity.post('/seller/identity', (req, res, next) => {
  const user = sellerUser(req, res);
  if (!user) return;
  req.userId = user.seller_id.replace(/[^a-z0-9_-]/gi, '');
  next();
}, idUpload.fields(IDENTITY_KINDS.map((name) => ({ name, maxCount: 1 }))), (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  const files = req.files || {};
  const saved = IDENTITY_KINDS.filter((kind) => files[kind]?.[0]);
  const number = String(req.body?.national_id_number || '').trim();
  if (!saved.length && !number) return res.status(400).json({ error: 'Add your National ID number, the front and back of the ID, and a photo of your face' });
  for (const kind of saved) {
    const file = files[kind][0];
    const previous = saveSellerDocument(user.seller_id, kind, file.path, file.mimetype);
    if (previous && previous !== file.path && insideUploads(previous)) fs.rmSync(previous, { force: true });
  }
  const kyc = verifyIdentity(user.seller_id, number);
  res.json({ identity: identityStatus(user.seller_id), kyc });
});

identity.get('/seller/kyc', (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  res.json({ kyc: kycFor(user.seller_id) });
});

// The audit desk confirms a seller or sends them back with what to fix.
identity.post('/admin/sellers/:id/kyc', (req, res) => {
  const user = userFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Sign in on the audit desk' });
  if (!getSeller(req.params.id)) return res.status(404).json({ error: 'Seller not found' });
  const status = req.body?.status === 'verified' ? 'verified' : 'rejected';
  const note = String(req.body?.note || '').trim().slice(0, 500);
  if (status === 'rejected' && !note) return res.status(400).json({ error: 'Tell the seller what to fix' });
  res.json({ kyc: setKyc(req.params.id, { status, note: note || null }) });
});

identity.get('/seller/identity/:kind', (req, res) => {
  const user = sellerUser(req, res);
  if (!user) return;
  const doc = getSellerDocument(user.seller_id, req.params.kind);
  if (!doc?.file_path || !fs.existsSync(doc.file_path)) return res.sendStatus(404);
  sendPrivateImage(res, doc.file_path, doc.mime);
});

identity.get('/admin/sellers/:id/identity/:kind', (req, res) => {
  const user = userFromRequest(req);
  if (!user || user.role !== 'admin') return res.status(401).json({ error: 'Sign in on the audit desk' });
  const doc = getSellerDocument(req.params.id, req.params.kind);
  if (!doc?.file_path || !fs.existsSync(doc.file_path)) return res.sendStatus(404);
  sendPrivateImage(res, doc.file_path, doc.mime);
});
