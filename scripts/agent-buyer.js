#!/usr/bin/env node
// An autonomous buyer agent that uses Funguo purely over HTTP — no UI.
// It browses listings, refuses high-risk ones, pays into an escrow hold,
// tracks the order, and then either confirms receipt or files a dispute with
// a photo and waits for the AI adjudicator's decision.
//
//   node scripts/agent-buyer.js [--base http://localhost:3000] [--scenario dispute|happy]
//                               [--method card|paypal] [--photo path] [--complaint "..."]
//
// --method card (default) pays with a PayPal sandbox test card, so no human is
// needed. --method paypal prints an approval link and waits for a human to approve
// (how an agent would hand a wallet approval to its principal).
// The script also plays the seller and the carrier so the demo is self-contained.
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, d) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const BASE = arg('base', process.env.FUNGUO_URL ?? 'http://localhost:3000').replace(/\/$/, '');
const SCENARIO = arg('scenario', 'dispute');
const METHOD = arg('method', 'card');
const PHOTO = arg('photo', new URL('./fixtures/wrong-item.png', import.meta.url).pathname);
const COMPLAINT = arg(
  'complaint',
  'Wrong item. The listing was for Sony WH-1000XM5 over-ear headphones but the box contained cheap in-ear earbuds branded "SONNY". Photo attached.',
);

const c = { dim: '\x1b[2m', b: '\x1b[1m', g: '\x1b[32m', y: '\x1b[33m', r: '\x1b[31m', cy: '\x1b[36m', x: '\x1b[0m' };
let n = 0;
const step = (msg) => console.log(`\n${c.b}${c.cy}[${++n}]${c.x} ${c.b}${msg}${c.x}`);
const info = (msg) => console.log(`    ${msg}`);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function api(method, p, body) {
  const init = { method, headers: {} };
  if (body instanceof FormData) init.body = body;
  else if (body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE}${p}`, init);
  const json = await res.json().catch(() => ({}));
  console.log(`    ${c.dim}${method} ${p} -> ${res.status}${c.x}`);
  if (!res.ok) throw new Error(`${method} ${p} failed: ${json.error ?? res.status}`);
  return json;
}

async function main() {
  step(`Connecting to Funguo at ${BASE}`);
  const health = await api('GET', '/api/health');
  info(`paypal=${health.paypal_mode}  agent=${health.agent_engine}  products=${health.product_data}  scam_search=${health.scam_search}`);

  step('Browsing listings and screening them with Funguo\'s verification data');
  const listings = await api('GET', '/api/listings');
  for (const l of listings) {
    const v = l.verification;
    const verdict = v?.risk === 'high' ? `${c.r}skip${c.x}` : `${c.g}ok${c.x}`;
    info(`${verdict}  ${l.title.slice(0, 55).padEnd(55)} $${l.price}  risk=${v?.risk ?? '?'}${v?.flags?.length ? `  (${v.flags[0]})` : ''}`);
  }
  const target = listings.find((l) => /sony/i.test(l.title) && l.verification?.risk !== 'high') ?? listings.find((l) => l.verification?.risk !== 'high');
  if (!target) throw new Error('No acceptable listing found');
  info(`${c.b}Buying:${c.x} ${target.title} for $${target.price} from ${target.seller.name} (${target.seller.total_orders} orders, verified=${target.seller.verified})`);

  step(`Paying into escrow (PayPal Orders v2, intent=AUTHORIZE, method=${METHOD})`);
  let v = await api('POST', '/api/orders', {
    listing_id: target.id,
    buyer_name: 'Shopping Agent #7',
    buyer_email: 'agent7@example.com',
    buyer_kind: 'agent',
    payment_method: METHOD,
  });
  const id = v.order.id;
  if (v.order.state === 'INITIATED') {
    info(`${c.y}Approval needed:${c.x} ${v.order.approval_url}`);
    info('Waiting for the principal to approve in PayPal…');
    while (v.order.state === 'INITIATED') {
      await sleep(3000);
      v = await api('GET', `/api/orders/${id}`);
    }
  }
  info(`order ${c.b}${id}${c.x} state=${c.y}${v.order.state}${c.x}`);
  info(`PayPal order ${v.order.paypal_order_id}, authorization ${v.order.authorization_id} (hold expires ${v.order.authorization_expires_at})`);

  step('Seller ships, carrier delivers (simulated by this script)');
  v = await api('POST', `/api/orders/${id}/ship`, { carrier: 'DHL', tracking_number: `JD0146${Date.now() % 1e8}` });
  info(`state=${v.order.state} tracking=${v.order.carrier} ${v.order.tracking_number}`);
  v = await api('POST', `/api/orders/${id}/deliver`);
  info(`state=${v.order.state} delivery=${v.order.delivery_status}`);

  if (SCENARIO === 'happy') {
    step('Item matches the listing: confirming receipt -> capture');
    v = await api('POST', `/api/orders/${id}/confirm`, { actor: 'agent' });
    info(`state=${c.g}${v.order.state}${c.x} capture=${v.order.capture_id} amount=$${v.order.captured_amount}`);
  } else {
    step('Item does NOT match: filing a dispute with a photo');
    const form = new FormData();
    form.set('complaint', COMPLAINT);
    if (PHOTO && fs.existsSync(PHOTO)) {
      form.set('photo', new Blob([fs.readFileSync(PHOTO)], { type: 'image/png' }), path.basename(PHOTO));
      info(`photo: ${PHOTO}`);
    }
    let d = await api('POST', `/api/orders/${id}/disputes`, form);
    info(`dispute ${d.id} status=${d.status}; funds remain on hold while the adjudicator works`);

    step('Waiting for the AI adjudicator');
    const t0 = Date.now();
    while (d.status === 'OPEN' || d.status === 'RUNNING') {
      await sleep(2500);
      d = await fetch(`${BASE}/api/disputes/${d.id}`).then((r) => r.json());
      process.stdout.write(`\r    ${c.dim}${d.status} ${Math.round((Date.now() - t0) / 1000)}s${c.x}   `);
    }
    console.log();
    info(`${c.b}Decision:${c.x} ${d.decision}${d.refund_amount ? ` ($${d.refund_amount} to buyer)` : ''}  confidence=${d.confidence ?? '—'}  engine=${d.engine}`);
    info(`${c.b}Rationale:${c.x} ${d.rationale}`);
    if (d.findings?.guardrail) info(`${c.y}Guardrail:${c.x} ${d.findings.guardrail}`);
    if (d.paypal_response) info(`${c.b}PayPal:${c.x} ${JSON.stringify(d.paypal_response)}`);
    v = await api('GET', `/api/orders/${id}`);
    info(`order state=${c.g}${v.order.state}${c.x}`);
  }

  step('Done');
  info(`Audit trail: ${BASE}/o/${id}`);
}

main().catch((e) => {
  console.error(`\n${c.r}agent-buyer failed:${c.x} ${e.message}`);
  process.exit(1);
});
