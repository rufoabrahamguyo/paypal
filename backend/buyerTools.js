// Tools an AI shopping agent uses to buy through Funguo escrow.
//
// Each tool is a thin wrapper over Funguo's public REST API, so one set of
// definitions serves both the Claude buyer agent (scripts/agent-buyer.js) and
// the MCP server (mcp.js) that lets Claude Desktop, Claude Code or any other
// MCP client shop with the buyer's money held by PayPal until the item checks out.
//
// Nothing here touches the database: an agent on another machine can point
// these tools at a hosted Funguo and get the same behaviour.
import fs from 'node:fs';
import path from 'node:path';

const obj = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const str = (description) => ({ type: 'string', description });

export const BUYER_TOOLS = [
  {
    name: 'search_listings',
    description:
      'Search the marketplace. Every listing comes with Funguo\'s verification: risk (low/medium/high), red flags, the market median price from Channel3, and the seller\'s record (verified, orders, dispute rate). Use an empty query to see everything.',
    input_schema: obj({ query: str('Words to match against title and description, or "" for all listings') }),
  },
  {
    name: 'pay_into_escrow',
    description:
      'Buy a listing. Funguo creates a PayPal Orders v2 order with intent AUTHORIZE: the money is held on the buyer\'s PayPal authorization and is NOT paid to the seller until the buyer confirms receipt or a dispute is decided. "card" places the hold immediately with a PayPal sandbox test card. "paypal" returns an approval_url the principal must open to approve in their PayPal wallet.',
    input_schema: obj({
      listing_id: str('The listing id from search_listings'),
      payment_method: { type: 'string', enum: ['card', 'paypal'], description: 'card = no human needed; paypal = principal approves in their wallet' },
    }),
  },
  {
    name: 'get_order',
    description: 'Current state of an escrow order: HELD / SHIPPED / INSPECTED / RELEASED / DISPUTED / RESOLVED_*, tracking, PayPal ids, what actions are allowed, and the latest dispute ruling if any.',
    input_schema: obj({ order_id: str('Order id returned by pay_into_escrow') }),
  },
  {
    name: 'confirm_receipt',
    description: 'The item arrived and matches the listing. Captures the held PayPal authorization in full and pays the seller. Irreversible: only call this after inspecting the item.',
    input_schema: obj({ order_id: str('Order id') }),
  },
  {
    name: 'open_dispute',
    description:
      'The item is wrong, damaged, counterfeit or missing. The funds stay held while Funguo\'s AI adjudicator reviews the evidence and decides: release to the seller, partial refund, or void the hold so the buyer is never charged. Write the complaint as specific, checkable facts about what arrived versus what was listed.',
    input_schema: obj({
      order_id: str('Order id'),
      complaint: str('What is wrong, in 2-4 factual sentences'),
      photo_path: str('Local path to a photo of what arrived, or "" to attach the inspection photo you were shown'),
    }),
  },
  {
    name: 'get_dispute',
    description: 'Status and ruling of a dispute: decision, refund amount, confidence, rationale, and any guardrail that sent it to a human.',
    input_schema: obj({ dispute_id: str('Dispute id returned by open_dispute') }),
  },
];

const IMAGE_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif' };

function listingSummary(l) {
  const v = l.verification ?? {};
  return {
    listing_id: l.id,
    title: l.title,
    description: l.description,
    price: l.price,
    currency: l.currency,
    risk: v.risk ?? 'unknown',
    risk_score: v.score ?? null,
    flags: v.flags ?? [],
    market_median: v.reference?.price_stats?.median ?? null,
    market_source: v.reference?.source ?? null,
    seller: {
      name: l.seller?.name,
      verified: !!l.seller?.verified,
      total_orders: l.seller?.total_orders ?? 0,
      dispute_rate: l.seller?.dispute_rate ?? null,
    },
  };
}

function disputeSummary(d) {
  if (!d) return null;
  return {
    dispute_id: d.id,
    status: d.status,
    decision: d.decision ?? null,
    refund_amount: d.refund_amount ?? null,
    confidence: d.confidence ?? null,
    rationale: d.rationale ?? null,
    guardrail: d.findings?.guardrail ?? null,
    engine: d.engine ?? null,
  };
}

function orderSummary(v) {
  const o = v.order;
  return {
    order_id: o.id,
    state: o.state,
    item: v.listing?.title,
    amount: o.amount,
    currency: o.currency,
    allowed_actions: o.allowed_actions,
    paypal_order_id: o.paypal_order_id,
    authorization_id: o.authorization_id,
    hold_expires_at: o.authorization_expires_at,
    approval_url: o.state === 'INITIATED' ? o.approval_url : undefined,
    carrier: o.carrier,
    tracking_number: o.tracking_number,
    delivery_status: o.delivery_status,
    captured_amount: o.captured_amount ?? null,
    latest_dispute: disputeSummary(v.disputes?.[0]),
  };
}

/**
 * A client bound to one Funguo base URL.
 *   buyerName     shown on orders the agent places
 *   defaultPhoto  attached to open_dispute when the model passes photo_path ""
 *   onRequest     called with (method, path, status) after every HTTP call
 */
export function createBuyerClient(base, { buyerName = 'AI shopping agent', defaultPhoto = null, onRequest } = {}) {
  const root = base.replace(/\/$/, '');

  async function api(method, p, body) {
    const init = { method, headers: {} };
    if (body instanceof FormData) init.body = body;
    else if (body !== undefined) {
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await fetch(`${root}${p}`, init);
    const json = await res.json().catch(() => ({}));
    onRequest?.(method, p, res.status);
    if (!res.ok) throw new Error(`${method} ${p} failed (${res.status}): ${json.error ?? 'no detail'}`);
    return json;
  }

  const handlers = {
    async search_listings({ query }) {
      const all = await api('GET', '/api/listings');
      const words = String(query ?? '').toLowerCase().split(/\s+/).filter(Boolean);
      const hits = all.filter((l) => {
        const text = `${l.title} ${l.description}`.toLowerCase();
        return words.every((w) => text.includes(w));
      });
      return { count: hits.length, listings: (hits.length ? hits : all).map(listingSummary), note: hits.length ? undefined : 'No exact match; showing all listings.' };
    },

    async pay_into_escrow({ listing_id, payment_method }) {
      const v = await api('POST', '/api/orders', {
        listing_id,
        buyer_name: buyerName,
        buyer_kind: 'agent',
        payment_method: payment_method === 'paypal' ? 'paypal' : 'card',
      });
      return orderSummary(v);
    },

    async get_order({ order_id }) {
      return orderSummary(await api('GET', `/api/orders/${encodeURIComponent(order_id)}`));
    },

    async confirm_receipt({ order_id }) {
      const v = await api('POST', `/api/orders/${encodeURIComponent(order_id)}/confirm`, { actor: 'agent' });
      return { ...orderSummary(v), paypal_capture: v.paypal_response ?? null };
    },

    async open_dispute({ order_id, complaint, photo_path }) {
      const form = new FormData();
      form.set('complaint', complaint);
      const photo = photo_path || defaultPhoto;
      if (photo) {
        const mime = IMAGE_MIME[path.extname(photo).toLowerCase()];
        if (!mime) throw new Error(`photo must be PNG, JPEG, WebP or GIF (got ${photo})`);
        form.set('photo', new Blob([fs.readFileSync(photo)], { type: mime }), path.basename(photo));
      }
      const d = await api('POST', `/api/orders/${encodeURIComponent(order_id)}/disputes`, form);
      return { ...disputeSummary(d), photo_attached: !!photo, note: 'Funds stay on hold while the adjudicator works (usually 20-60 s). Poll get_dispute.' };
    },

    async get_dispute({ dispute_id }) {
      return disputeSummary(await api('GET', `/api/disputes/${encodeURIComponent(dispute_id)}`));
    },
  };

  return {
    api,
    async run(name, input) {
      const fn = handlers[name];
      if (!fn) throw new Error(`Unknown tool ${name}`);
      return fn(input ?? {});
    },
  };
}
