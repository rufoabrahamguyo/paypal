// Seeds a demo seller roster + listings. `--if-empty` makes it a no-op when
// data already exists (used by `npm start` so Render boots with demo data).
import { db, now, insertListing, listListings } from '../src/db.js';
import { verifyListing } from '../src/verification.js';
import { indexCorpus } from '../src/scamSearch.js';

const ifEmpty = process.argv.includes('--if-empty');
const hasData = db.prepare('SELECT COUNT(*) AS n FROM sellers').get().n > 0;

if (ifEmpty && hasData) {
  console.log('[seed] data present, skipping');
  process.exit(0);
}

if (hasData) {
  console.log('[seed] resetting existing demo data');
  db.exec(`DELETE FROM disputes; DELETE FROM paypal_calls; DELETE FROM order_events; DELETE FROM orders;
           DELETE FROM listings; DELETE FROM sellers; DELETE FROM webhook_events;`);
}

const daysAgo = (n) => new Date(Date.now() - n * 864e5).toISOString();
const sellers = [
  // Established, verified seller: long history, low dispute rate.
  { id: 'sel_nairobi_cam', name: 'Nairobi Camera Co.', email: 'shop@nairobicamera.example', verified: 1, prior_orders: 212, prior_disputes: 3, created_at: daysAgo(900) },
  // Brand-new, unverified seller with an existing dispute already.
  { id: 'sel_quickdeals', name: 'QuickDeals254', email: 'quickdeals254@example.com', verified: 0, prior_orders: 2, prior_disputes: 1, created_at: daysAgo(6) },
  // Small, verified hobby seller.
  { id: 'sel_mtumba', name: 'Mtumba Vintage', email: 'hello@mtumba.example', verified: 1, prior_orders: 41, prior_disputes: 2, created_at: daysAgo(400) },
];
const ins = db.prepare(
  'INSERT INTO sellers (id, name, email, verified, prior_orders, prior_disputes, created_at) VALUES (@id, @name, @email, @verified, @prior_orders, @prior_disputes, @created_at)',
);
for (const s of sellers) ins.run(s);

const listings = [
  {
    seller_id: 'sel_nairobi_cam',
    title: 'Sony WH-1000XM5 Wireless Noise-Cancelling Headphones (Black)',
    description: 'Like new, used twice. Over-ear, 30h battery, original case and USB-C cable included. Ships in original box within 1 business day.',
    price: 279,
    image_url: '/img/headphones.svg',
  },
  {
    seller_id: 'sel_nairobi_cam',
    title: 'Canon EOS R50 Mirrorless Camera Kit with RF-S 18-45mm lens',
    description: 'Excellent condition, ~1,800 shutter count. Kit includes body, 18-45mm lens, battery, charger and strap.',
    price: 599,
    image_url: '/img/camera.svg',
  },
  {
    seller_id: 'sel_quickdeals',
    title: 'iPhone 15 Pro 256GB brand new sealed - unlocked',
    description: 'Brand new sealed, unlocked. Half price because I am moving abroad, must sell today. Ships from overseas warehouse after payment.',
    price: 450,
    image_url: '/img/iphone.svg',
  },
  {
    seller_id: 'sel_mtumba',
    title: 'Vintage brown leather jacket, size M',
    description: 'Genuine 1980s leather jacket, slight wear on the cuffs (pictured). Chest 52cm pit-to-pit, length 68cm.',
    price: 85,
    image_url: '/img/jacket.svg',
  },
];
// Scam-pattern corpus: local embeddings file, plus the Elastic index if configured.
try {
  const idx = await indexCorpus();
  console.log(`[seed] scam corpus: ${idx.count} patterns -> ${idx.backend}${idx.index ? ` index ${idx.index}` : ''}`);
} catch (e) {
  console.warn(`[seed] Elastic indexing failed (${e.message}); local cosine search will be used`);
}

for (const l of listings) {
  const verification = await verifyListing(l);
  insertListing({ ...l, verification_json: JSON.stringify(verification), created_at: now() });
  console.log(`[seed] ${verification.risk.padEnd(6)} ${l.title}`);
}

console.log(`[seed] ${sellers.length} sellers, ${listListings().length} listings`);
