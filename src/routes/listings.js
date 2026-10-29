import { Router } from 'express';
import { config } from '../config.js';
import { getListing, listListings, getSeller, insertListing, listSellers, sellerHistory } from '../db.js';

export const listings = Router();

const withLinks = (l) => l && { ...l, checkout_url: `${config.baseUrl}/l/${l.id}`, seller: sellerHistory(l.seller_id) };

listings.get('/sellers', (req, res) => res.json(listSellers().map((s) => ({ ...s, ...sellerHistory(s.id) }))));

listings.get('/listings', (req, res) => res.json(listListings().map(withLinks)));

listings.get('/listings/:id', (req, res) => {
  const l = getListing(req.params.id);
  if (!l) return res.status(404).json({ error: 'Listing not found' });
  res.json(withLinks(l));
});

listings.post('/listings', async (req, res) => {
  const { seller_id, title, description, price, image_url } = req.body ?? {};
  if (!getSeller(seller_id)) return res.status(400).json({ error: 'Unknown seller_id' });
  const p = Number(price);
  if (!title || !description || !(p > 0) || p > 10_000) {
    return res.status(400).json({ error: 'title, description and a price between 0 and 10000 are required' });
  }
  const listing = insertListing({ seller_id, title: String(title).slice(0, 200), description: String(description).slice(0, 2000), price: Math.round(p * 100) / 100, image_url: image_url || null });
  res.status(201).json(withLinks(listing));
});
