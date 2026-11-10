import { Router } from 'express';
import { config } from '../config.js';
import { db, getListing, listListings, getSeller, getUserBySellerId, insertListing, listSellers, reviewsForSeller, sellerHistory } from '../db.js';
import { verifyListing } from '../verification.js';

export const listings = Router();

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

listings.get('/listings/:id', (req, res) => {
  const l = getListing(req.params.id);
  if (!l || l.id === 'lst_apps') return res.status(404).json({ error: 'Listing not found' });
  res.json(withLinks(l));
});

listings.post('/listings', async (req, res) => {
  const { seller_id, title, description, price, image_url } = req.body ?? {};
  const seller = getSeller(seller_id);
  if (!seller) return res.status(400).json({ error: 'Unknown seller_id' });
  if (seller.kyc_status !== 'verified') return res.status(403).json({ error: 'Verify your identity before requesting payments', onboarding_url: '/seller/onboarding' });
  const p = Number(price);
  if (!title || !description || !(p > 0) || p > 10_000_000) {
    return res.status(400).json({ error: 'Enter a title, a description, and a price above 0' });
  }
  const currency = getUserBySellerId(seller_id)?.currency || 'USD';
  const fields = { seller_id, title: String(title).slice(0, 200), description: String(description).slice(0, 2000), price: Math.round(p * 100) / 100, currency, image_url: image_url || null };
  // Listing verification: market price (Channel3) + scam-pattern similarity (Elastic) + seller trust.
  const verification = await verifyListing(fields);
  const listing = insertListing({ ...fields, verification_json: JSON.stringify(verification) });
  res.status(201).json(withLinks(listing));
});

listings.post('/listings/:id/verify', async (req, res) => {
  const l = getListing(req.params.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  const verification = await verifyListing(l);
  db.prepare('UPDATE listings SET verification_json = ? WHERE id = ?').run(JSON.stringify(verification), l.id);
  res.json(withLinks(getListing(l.id)));
});
