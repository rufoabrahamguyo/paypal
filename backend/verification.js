// Listing verification: market price check (Channel3) + scam-pattern
// similarity (Elastic) + seller trust. Runs when a listing is created; the
// result is shown to buyers and handed to the dispute agent as evidence.
import { toUsd } from './countries.js';
import { lookupProduct, assessPrice } from './productData.js';
import { searchScamPatterns } from './scamSearch.js';
import { sellerHistory, now } from './db.js';

// Hashed-feature cosine scores: >= 0.30 is a strong overlap with a known pattern.
const SCAM_THRESHOLD = 0.3;

export async function verifyListing(listing) {
  const [reference, scam] = await Promise.all([
    lookupProduct(listing.title),
    searchScamPatterns(`${listing.title}. ${listing.description}`, 5),
  ]);
  const seller = sellerHistory(listing.seller_id);
  const price = assessPrice(toUsd(listing.price, listing.currency || 'USD'), reference.price_stats);

  const flags = [];
  let score = 0;
  if (price.flag) {
    flags.push(price.flag);
    score += price.ratio < 0.5 ? 0.45 : 0.1;
  }
  // Fulfilment-stage patterns ("generic earbuds shipped instead") describe what
  // arrives, not what's listed; they're for the dispute agent, not this check.
  const hits = scam.matches.filter((m) => m.score >= SCAM_THRESHOLD && m.severity !== 'low' && m.stage !== 'fulfilment');
  for (const m of hits.slice(0, 2)) {
    flags.push(`Resembles known pattern "${m.label}" (similarity ${m.score})`);
    score += m.severity === 'high' ? 0.3 : 0.15;
  }
  if (seller && !seller.verified) {
    flags.push('Seller identity not verified');
    score += 0.15;
  }
  if (seller && seller.total_orders >= 5 && seller.dispute_rate > 0.1) {
    flags.push(`High seller dispute rate (${Math.round(seller.dispute_rate * 100)}%)`);
    score += 0.15;
  }
  if (!reference.price_stats) flags.push('No market reference found for this product');

  score = Math.min(1, +score.toFixed(2));
  return {
    risk: score >= 0.6 ? 'high' : score >= 0.25 ? 'medium' : 'low',
    score,
    flags,
    price_ratio: price.ratio,
    reference: { source: reference.source, note: reference.note, price_stats: reference.price_stats, matches: reference.matches.slice(0, 4) },
    scam_matches: { backend: scam.backend, matches: scam.matches },
    checked_at: now(),
  };
}
