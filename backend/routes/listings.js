import { Router } from 'express';
import { config } from '../config.js';
import { db, getListing, listListings, getSeller, getUserBySellerId, insertListing, listSellers, sellerHistory } from '../db.js';
import { verifyListing } from '../verification.js';

export const listings = Router();

const withLinks = (l) => l && { ...l, checkout_url: `${config.baseUrl}/l/${l.id}`, seller: sellerHistory(l.seller_id) };

listings.get('/sellers', (req, res) => res.json(listSellers().map((s) => {
  const { photo_path, photo_mime, ...rest } = s;
  return { ...rest, ...sellerHistory(s.id) };
})));

listings.get('/listings', (req, res) => res.json(listListings().map(withLinks)));

listings.get('/listings/:id', (req, res) => {
  const l = getListing(req.params.id);
  if (!l || l.id === 'lst_apps') return res.status(404).json({ error: 'Listing not found' });
  res.json(withLinks(l));
});

listings.post('/listings', async (req, res) => {
  const { seller_id, title, description, price, image_url } = req.body ?? {};
  if (!getSeller(seller_id)) return res.status(400).json({ error: 'Unknown seller_id' });
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
