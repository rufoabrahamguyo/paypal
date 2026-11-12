import fs from 'node:fs';
import path from 'node:path';
import { Router } from 'express';
import multer from 'multer';
import { config } from '../config.js';
import { db, getListing, listListings, getSeller, getUserBySellerId, insertListing, setListingImage, listSellers, reviewsForSeller, sellerHistory } from '../db.js';
import { verifyListing } from '../verification.js';

export const listings = Router();

const UPLOADS = path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `listing-tmp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Photo must be JPEG, PNG, WebP or GIF');
    err.status = 400;
    cb(err);
  },
});

function maybeImage(req, res, next) {
  const type = req.headers['content-type'] || '';
  if (!type.includes('multipart/form-data')) return next();
  upload.single('image')(req, res, (err) => {
    if (err?.code === 'LIMIT_FILE_SIZE') {
      err.status = 400;
      err.message = 'Photo must be under 5 MB';
    }
    next(err);
  });
}

function listingImageFile(id) {
  const safe = String(id || '').replace(/[^a-zA-Z0-9_-]/g, '');
  if (!safe || safe !== id) return null;
  return Object.values(IMAGE_TYPES)
    .map((ext) => path.join(UPLOADS, `listing-${safe}${ext}`))
    .find((file) => fs.existsSync(file)) || null;
}

function cleanImageUrl(value) {
  const url = String(value || '').trim();
  if (!url) return null;
  if ((url.startsWith('/') && !url.startsWith('//')) || /^https?:\/\//i.test(url)) return url.slice(0, 500);
  const err = new Error('Image link must start with http:// or https://');
  err.status = 400;
  throw err;
}

const withLinks = (l) => l && { ...l, checkout_url: `${config.baseUrl}/l/${l.id}`, seller: sellerHistory(l.seller_id) };

// Public seller directory. `q` matches the shop name or a checked social handle.
listings.get('/sellers', (req, res) => {
  const q = String(req.query.q || '').trim().toLowerCase().replace(/^@/, '');
  const rows = listSellers().map((s) => ({ id: s.id, created_at: s.created_at, ...sellerHistory(s.id) }));
  res.json(q
    ? rows.filter((s) => s.name.toLowerCase().includes(q) || s.socials.some((a) => a.handle.toLowerCase().includes(q)))
    : rows);
});

// What a buyer checks before deciding to trust a shop.
listings.get('/sellers/:id/profile', (req, res) => {
  const s = getSeller(req.params.id);
  if (!s || s.id === 'sel_apps') return res.status(404).json({ error: 'Seller not found' });
  res.json({
    seller: { id: s.id, ...sellerHistory(s.id) },
    reviews: reviewsForSeller(s.id),
    listings: listListings().filter((l) => l.seller_id === s.id).map(withLinks),
  });
});

listings.get('/listings', (req, res) => res.json(listListings().map(withLinks)));

listings.get('/listings/:id/image', (req, res) => {
  const file = listingImageFile(req.params.id);
  if (!file) return res.sendStatus(404);
  res.set('Cache-Control', 'public, max-age=86400');
  res.sendFile(path.resolve(file));
});

listings.get('/listings/:id', (req, res) => {
  const l = getListing(req.params.id);
  if (!l || l.id === 'lst_apps') return res.status(404).json({ error: 'Listing not found' });
  res.json(withLinks(l));
});

listings.post('/listings', maybeImage, async (req, res, next) => {
  const dropUpload = () => {
    if (req.file?.path) fs.rmSync(req.file.path, { force: true });
    req.file = undefined;
  };
  try {
    const { seller_id, title, description, price } = req.body ?? {};
    const seller = getSeller(seller_id);
    if (!seller) {
      dropUpload();
      return res.status(400).json({ error: 'Unknown seller_id' });
    }
    if (seller.kyc_status !== 'verified') {
      dropUpload();
      return res.status(403).json({ error: 'Verify your identity before requesting payments', onboarding_url: '/seller/onboarding' });
    }
    const p = Number(price);
    if (!title || !description || !(p > 0) || p > 10_000_000) {
      dropUpload();
      return res.status(400).json({ error: 'Enter a title, a description, and a price above 0' });
    }
    const currency = getUserBySellerId(seller_id)?.currency || 'USD';
    const image_url = req.file ? null : cleanImageUrl(req.body?.image_url);
    const fields = { seller_id, title: String(title).slice(0, 200), description: String(description).slice(0, 2000), price: Math.round(p * 100) / 100, currency, image_url };
    // Listing verification: market price (Channel3) + scam-pattern similarity (Elastic) + seller trust.
    const verification = await verifyListing(fields);
    let listing = insertListing({ ...fields, verification_json: JSON.stringify(verification) });
    if (req.file) {
      const dest = path.join(UPLOADS, `listing-${listing.id}${IMAGE_TYPES[req.file.mimetype]}`);
      fs.renameSync(req.file.path, dest);
      req.file.path = dest;
      listing = setListingImage(listing.id, `/api/listings/${listing.id}/image`);
    }
    res.status(201).json(withLinks(listing));
  } catch (err) {
    dropUpload();
    next(err);
  }
});

listings.post('/listings/:id/verify', async (req, res) => {
  const l = getListing(req.params.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const verification = await verifyListing(l);
  db.prepare('UPDATE listings SET verification_json = ? WHERE id = ?').run(JSON.stringify(verification), l.id);
  res.json(withLinks(getListing(l.id)));
});
