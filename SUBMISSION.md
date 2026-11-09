# Devpost submission pack

Copy each section into the matching Devpost field. Replace the `<…>` placeholders.

---

## Tagline (one line)

Escrow on PayPal for AI shopping agents and cross-border social commerce: the money waits in a PayPal hold, and a Claude agent rules on disputes and moves the money itself.

## Project description

### Inspiration

AI agents are starting to buy things for people. An agent can't tell when it's been scammed, and it can't chase a refund. People already have this problem: a lot of shopping happens in Instagram DMs, TikTok comments and WhatsApp chats, often across borders. A buyer in London pays a seller in Nairobi up front and hopes. When the parcel holds cheap earbuds instead of the headphones in the photo, there's no one to call. These payments often go out as "friends and family", where Buyer Protection doesn't apply, and when a dispute is possible it takes weeks.

### What it does

Funguo (Swahili for "key") puts the money in the middle.

- **The seller asks for the money.** They describe the item, set a price and send one link on WhatsApp or by email. Buyers who would never pay a stranger abroad up front will pay into a hold, so more sales close.
- **The buyer pays into a hold.** Funguo creates a PayPal order with `intent: AUTHORIZE`. The funds are held on the buyer's PayPal authorization, not paid to the seller.
- **Delivery, then the money moves.** If the buyer confirms, Funguo captures the authorization. If something is wrong, they open a dispute with a photo.
- **Claude rules on the dispute and executes the decision.** The adjudicator reads the listing, looks at the buyer's photo, checks tracking and the seller's record, checks market prices (Channel3) and searches known scam patterns (Elastic). It then calls one decision tool, which runs the PayPal call: **capture** (seller paid), **partial capture with `final_capture`** (partial refund), or **void** (buyer never charged). It usually takes under a minute.
- **Both sides get heard.** A seller can attach a packing photo when shipping. The adjudicator compares what was listed, what the seller packed and what the buyer received, and escalates when it can't tell who is right.
- **Guardrails live in code, not the prompt.** Low confidence, conflicting evidence, releasing an unshipped item, or two decisions at once all become "escalate to a human", and no money moves. Every decision is stored with its rationale, evidence, confidence and full tool transcript, and shown in an AG Grid audit ledger.
- **Built for AI buyers too.** A Claude buyer agent gets a goal and a budget, skips high-risk listings, pays into the hold, **looks at a photo of what arrived** and decides itself whether to confirm or dispute. The same tools ship as an **MCP server**, so Claude Desktop, Claude Code or any MCP agent can shop with the money protected.
- **For shops with their own cart**, the Pal-Lock API adds "pay into a hold" beside normal PayPal Checkout, with an API key and webhooks.

### How we built it

- **Node.js + Express + SQLite**, plain HTML front end.
- **PayPal REST APIs**, called directly: OAuth client credentials, Orders v2 (`AUTHORIZE` and `CAPTURE` intents, approval redirect or inline sandbox card), Payments v2 authorization capture (full and partial with `final_capture`), void and reauthorize, webhook signature verification. Every mutating call carries a deterministic `PayPal-Request-Id`, so retries never double-charge.
- **Claude (`claude-opus-5-5`)** for both agents: vision for the photos, adaptive thinking, strict tool schemas, and server-side refusal fallback. The adjudicator's transcript is saved after every turn, so the order page shows its reasoning and tool calls live.
- **Channel3** for market reference prices, **Elastic** kNN for scam-pattern search, **AG Grid** for the decisions ledger, **Render** for hosting, and the **Model Context Protocol** for agent access.

### Challenges we ran into

- **Letting an AI move money safely.** We put every hard rule between the model and PayPal in code. The model proposes and the code decides whether that proposal may execute. The model's original proposal is kept when a guardrail overrides it, so a human can see what it wanted to do.
- **Holds outlasting the guarantee.** PayPal guarantees authorized funds for about three days, and cross-border shipping is slower. Funguo reauthorizes wallet-funded holds when the honor period ends, so captures still land on guaranteed funds.
- **Partial refunds on a hold.** A partial refund before capture is a partial capture with `final_capture: true`. PayPal then releases the rest of the hold, so the buyer is never charged the refunded amount at all.
- **Prompt injection through evidence.** Complaints, listing text and words in photos all come from interested parties. The adjudicator treats them as evidence and logs any attempt to instruct it as conflicting evidence against the party who wrote it.

### Accomplishments that we're proud of

- An agent that doesn't just recommend but **executes** capture, partial capture and void, with an audit trail a person can check.
- Two agents meeting over PayPal: a Claude buyer that spots the wrong item from a photo, and a Claude adjudicator that voids the hold.
- Everything that's mocked is labelled as mocked, in the UI and in the README.

### What we learned

PayPal's authorize/capture model is a natural fit for escrow. Escrow is also a natural fit for AI agents: it turns an irreversible payment into a decision that can wait for evidence.

### What's next

- PayPal Commerce Platform onboarding so the platform fee is split at capture.
- Carrier tracking webhooks instead of simulated delivery.
- A real fraud corpus for the scam search, and per-party authorization on order actions.

## Built with

`paypal-orders-v2` `paypal-payments-v2` `paypal-webhooks` `claude` `anthropic-api` `mcp` `channel3` `elastic` `ag-grid` `render` `node.js` `express` `sqlite` `javascript`

## Tools: which AI was used and how

| Tool | How it's used |
|---|---|
| **Claude `claude-opus-5-5` (Anthropic API)** | **Dispute adjudicator:** vision over the buyer's photo, tool use to fetch market prices and scam matches, and four decision tools, three of which execute PayPal capture / partial capture / void. **Buyer agent:** shops to a goal, screens risk, pays into escrow, inspects the delivered item's photo and confirms or disputes |
| **Model Context Protocol** | Funguo's buyer tools served over MCP stdio for any MCP client |
| **Channel3** | Product search for market reference prices in listing verification and partial-refund sizing |
| **Elastic** | kNN vector search over known scam patterns |
| **AG Grid** | Admin ledger of every AI decision |
| **Render** | Hosting (`render.yaml` Blueprint) |

## Links

- Hosted demo: `https://<your-render-url>`
- Repository: https://github.com/rufoabrahamguyo/paypal
- Video: `https://youtu.be/<id>`
- Admin login for judges: `admin@funguo.test` / `funguo-demo`

---

## Video script (target 2:45)

Record against the **hosted demo with real sandbox keys and `ANTHROPIC_API_KEY` set**. Check `/api/health` first: it must show `paypal_mode: sandbox` and a Claude model, not `simulate` / `rules-fallback`. No copyrighted music.

| Time | Screen | Say |
|---|---|---|
| 0:00–0:15 | A WhatsApp-style chat: "Sony XM5, $279, send money first" | "Millions of people buy from strangers on Instagram and WhatsApp. They pay first and hope. Soon AI agents will be buying for us, and they can't tell when they've been scammed." |
| 0:15–0:30 | Landing page | "Funguo is escrow on PayPal. The buyer pays into a PayPal authorization hold. The seller gets paid only when the item is right, and when it isn't, a Claude agent decides and moves the money itself." |
| 0:30–1:05 | Terminal: `npm run agent-buyer -- --base <url>` | "Here's an AI shopping agent with a budget. It reads Funguo's risk scores and skips the too-cheap iPhone. It pays into escrow: there's the PayPal order and the authorization, and the money is held, not sent." |
| 1:05–1:30 | Terminal: the photo-inspection step | "The parcel arrives. The agent looks at the photo: 'SONNY' earbuds, not Sony over-ear headphones. It opens a dispute on its own." |
| 1:30–2:05 | Browser: the order page, live steps updating | "Now the adjudicator works, live. It compares the photo with the listing, checks market prices with Channel3, searches known scams with Elastic: lookalike brand substitution. Decision: void. The buyer is never charged." |
| 2:05–2:20 | PayPal sandbox dashboard showing the voided authorization | "That's a real PayPal sandbox void, with idempotency keys on every call." |
| 2:20–2:35 | Admin AG Grid ledger; point at a guardrail row | "Every ruling is audited: confidence, evidence, and guardrails in code. When the agent isn't sure, no money moves and a human decides." |
| 2:35–2:45 | MCP config / Claude Desktop shopping | "And any agent can use it. Funguo ships as an MCP server. Funguo: a key for paying strangers." |

Before the final take, run the `damaged` scenario once so the ledger shows a partial refund, and file a vague dispute from the UI (e.g. "not happy with it", no photo) so it shows an escalation.

---

## Pre-submission checklist

- [ ] `git add -A && git commit` (the restructure to `backend/` + `frontend/` is still uncommitted) and push
- [ ] GitHub repo is public, and **MIT** shows in the About sidebar (the `LICENSE` file is present)
- [ ] `.env` is **not** committed (`git ls-files | grep -x .env` prints nothing)
- [ ] Deployed on Render with `PAYPAL_CLIENT_ID`, `PAYPAL_SECRET`, `ANTHROPIC_API_KEY` (plus `CHANNEL3_API_KEY` and the Elastic keys if you have them)
- [ ] `https://<url>/api/health` shows `paypal_mode: "sandbox"` and `agent_engine: "claude-opus-5-5"`
- [ ] Ran `npm run agent-buyer -- --base https://<url>` for `dispute`, `damaged` and `happy` against the hosted demo
- [ ] Ran one human checkout through the real PayPal sandbox approval page
- [ ] Put the hosted URL and the video link at the top of `README.md`
- [ ] Video is under 3 minutes, public on YouTube, with no copyrighted music
- [ ] On Devpost, opt into the prize categories: Best Use of PayPal + AI, Best Use of Agentic Commerce, Channel3, AG Grid, Render
