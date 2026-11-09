// Product reference data (Channel3 interface).
//
// lookupProduct(query) -> {
//   source: 'channel3' | 'seeded-mock',
//   query, matches: [{ title, price, currency, merchant, url }],
//   price_stats: { min, median, max, count } | null, note?
// }
//
// With CHANNEL3_API_KEY set this calls Channel3's product search
// (POST https://api.trychannel3.com/v1/search, x-api-key header). Without it,
// or if the call fails, it answers from a small seeded catalog so the rest of
// the system never dead-ends. Swapping to live is setting the env var.
import fs from 'node:fs';
import { config } from './config.js';

const CATALOG = JSON.parse(fs.readFileSync(new URL('./data/reference-products.json', import.meta.url)));

const median = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

function stats(prices) {
  const p = prices.filter((x) => Number.isFinite(x) && x > 0);
  if (!p.length) return null;
  return { min: Math.min(...p), median: +median(p).toFixed(2), max: Math.max(...p), count: p.length };
}

async function channel3(query) {
  const res = await fetch('https://api.trychannel3.com/v1/search', {
    method: 'POST',
    headers: { 'x-api-key': config.channel3.apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) throw new Error(`Channel3 ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  const products = (body.products ?? body.results ?? []).slice(0, 5);
  const matches = products.flatMap((p) =>
    (p.offers ?? []).slice(0, 3).map((o) => ({
      title: p.title,
      price: Number(o.price?.amount ?? o.price),
      currency: o.price?.currency ?? 'USD',
      merchant: o.domain ?? o.merchant,
      url: o.url,
    })),
  );
  const usd = matches.filter((m) => m.currency === 'USD').map((m) => m.price);
  return { source: 'channel3', query, matches: matches.slice(0, 8), price_stats: stats(usd) };
}

function seeded(query) {
  const q = new Set(String(query).toLowerCase().split(/[^a-z0-9-]+/).filter(Boolean));
  const scored = CATALOG.map((p) => ({ p, hits: p.keywords.filter((k) => q.has(k)).length }))
    .filter((x) => x.hits >= 2)
    .sort((a, b) => b.hits - a.hits);
  if (!scored.length) return { source: 'seeded-mock', query, matches: [], price_stats: null, note: 'No reference product found' };
  const best = scored[0].p;
  const matches = best.offers.map((o) => ({ title: best.title, price: o.price, currency: 'USD', merchant: o.merchant, url: `https://${o.merchant}` }));
  return { source: 'seeded-mock', query, matches, price_stats: stats(matches.map((m) => m.price)) };
}

export async function lookupProduct(query) {
  if (!config.channel3.apiKey) return seeded(query);
  try {
    const live = await channel3(query);
    if (live.matches.length) return live;
    return { ...seeded(query), note: 'Channel3 returned no offers; seeded reference used' };
  } catch (e) {
    console.warn('[productData] Channel3 failed, using seeded data:', e.message);
    return { ...seeded(query), note: `Channel3 unavailable (${e.message}); seeded reference used` };
  }
}

/** Compare a listing price to the market reference. */
export function assessPrice(price, priceStats) {
  if (!priceStats) return { ratio: null, flag: null };
  const ratio = +(price / priceStats.median).toFixed(2);
  let flag = null;
  if (ratio < 0.5) flag = `Price is ${Math.round((1 - ratio) * 100)}% below the market median (${priceStats.median}) — classic too-good-to-be-true signal`;
  else if (ratio > 1.6) flag = `Price is ${Math.round((ratio - 1) * 100)}% above the market median (${priceStats.median})`;
  return { ratio, flag };
}
