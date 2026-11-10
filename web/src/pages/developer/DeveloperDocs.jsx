import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useTitle } from '../../lib/hooks.js';

export default function DeveloperDocs() {
  useTitle('Developer docs');
  const origin = window.location.origin;
  const base = `${origin}/api/v1`;
  const SAMPLES = {
    create: `curl ${base}/payments \\
  -H "Authorization: Bearer $FUNGUO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "option": "pal_lock",
    "amount": 200,
    "currency": "USD",
    "description": "Modern Oak Cushion Chair",
    "reference": "cart_91",
    "return_url": "https://yourshop.com/checkout/done",
    "cancel_url": "https://yourshop.com/cart"
  }'`,
    get: `curl ${base}/payments/ord_8f2kq1 \\
  -H "Authorization: Bearer $FUNGUO_SECRET_KEY"`,
    capture: `curl -X POST ${base}/payments/ord_8f2kq1/capture \\
  -H "Authorization: Bearer $FUNGUO_SECRET_KEY"`,
    void: `curl -X POST ${base}/payments/ord_8f2kq1/void \\
  -H "Authorization: Bearer $FUNGUO_SECRET_KEY"`,
  };

  // Highlight the section in view, and honour a #section in the address.
  useEffect(() => {
    const links = [...document.querySelectorAll('.docs-nav a')];
    const spy = new IntersectionObserver((entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        links.forEach((a) => a.classList.toggle('on', a.getAttribute('href') === `#${e.target.id}`));
      }
    }, { rootMargin: '-90px 0px -70% 0px' });
    document.querySelectorAll('.docs-body section').forEach((s) => spy.observe(s));
    if (window.location.hash) document.querySelector(window.location.hash)?.scrollIntoView();
    return () => spy.disconnect();
  }, []);

  return (
    <div className="docs">
        <nav className="docs-nav" aria-label="Docs">
          <h4>Get started</h4>
          <a href="#overview">Overview</a>
          <a href="#quickstart">Quickstart</a>
          <a href="#auth">Authentication</a>
          <a href="#sandbox">Sandbox testing</a>
          <h4>API reference</h4>
          <a href="#payments">The payment object</a>
          <a href="#create">Create a payment</a>
          <a href="#retrieve">Retrieve a payment</a>
          <a href="#capture">Capture a payment</a>
          <a href="#void">Void a payment</a>
          <a href="#errors">Errors</a>
          <h4>Webhooks</h4>
          <a href="#webhooks">Events</a>
          <a href="#signatures">Verifying signatures</a>
          <h4>More</h4>
          <a href="#agents">Agents and MCP</a>
        </nav>

        <main className="docs-body" id="main">
          <section id="overview">
            <p className="eyebrow">Docs</p>
            <h1>Pal-Lock API</h1>
            <p>Pal-Lock adds an escrow option beside PayPal Checkout in a cart you already run. You create a payment, send the buyer to PayPal to approve it, and Funguo places a PayPal <b>authorization hold</b>. The money is captured to you only when you call <a href="#capture">capture</a>, after the buyer confirms the item. If the sale falls through, <a href="#void">void</a> drops the hold and the buyer is never charged.</p>
            <p>Base URL for every request:</p>
            <pre className="code">{origin}/api/v1</pre>
            <p>The API takes and returns JSON, uses standard HTTP status codes, and authenticates with a secret key per app.</p>
          </section>

          <section id="quickstart">
            <h2>Quickstart</h2>
            <ol>
              <li>Sign in and open <Link to="/developer/dashboard">Apps &amp; Credentials</Link>. Create an app.</li>
              <li>Copy the app's <b>secret key</b>. Keep it on your server only.</li>
              <li>Create a payment and redirect the buyer to the returned <code>approval_url</code>.</li>
              <li>When the buyer comes back to your <code>return_url</code>, the hold is placed and you get a <code>payment.held</code> webhook.</li>
              <li>Ship the item. When the buyer confirms, call <code>capture</code>.</li>
            </ol>
            <pre className="code">{SAMPLES.create}</pre>
          </section>

          <section id="auth">
            <h2>Authentication</h2>
            <p>Send your app's secret key as a bearer token on every request. Keys start with <code>fl_</code>. You can roll a key from the dashboard at any time, and the old key stops working immediately.</p>
            <pre className="code">{`Authorization: Bearer fl_your_secret_key`}</pre>
            <p>A missing or unknown key returns <code>401</code>. An app can only read and change payments it created, and a payment from another app returns <code>404</code>.</p>
          </section>

          <section id="sandbox">
            <h2>Sandbox testing</h2>
            <p>All payments run against <b>PayPal Sandbox</b>. No real money moves. Approve with a sandbox personal account from your PayPal developer dashboard. When the server runs in simulate mode, a Funguo approval page stands in for PayPal.</p>
            <p>The sample shop <Link to="/shop">Abode</Link> uses a public sandbox key, shown on the <Link to="/developer">developer overview</Link>, so you can watch a full flow and its webhooks before writing any code.</p>
          </section>

          <section id="payments">
            <h2>The payment object</h2>
            <table className="params">
              <thead><tr><th>Field</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>id</code></td><td>Funguo payment id, for example <code>ord_8f2kq1</code>.</td></tr>
                <tr><td><code>option</code></td><td><code>pal_lock</code> (authorization hold) or <code>checkout</code> (immediate capture).</td></tr>
                <tr><td><code>state</code></td><td>See the states below.</td></tr>
                <tr><td><code>amount</code>, <code>currency</code></td><td>What the buyer pays.</td></tr>
                <tr><td><code>description</code></td><td>The text shown to the buyer.</td></tr>
                <tr><td><code>reference</code></td><td>Your own id, for example a cart or order number.</td></tr>
                <tr><td><code>approval_url</code></td><td>Where to send the buyer. Only set while <code>state</code> is <code>INITIATED</code>.</td></tr>
                <tr><td><code>authorization_id</code></td><td>The PayPal authorization holding the money.</td></tr>
                <tr><td><code>capture_id</code>, <code>captured_amount</code></td><td>Set once money is captured. A partial capture means part of the hold went back to the buyer.</td></tr>
                <tr><td><code>buyer_email</code></td><td>If you passed one.</td></tr>
              </tbody>
            </table>
            <h3>States</h3>
            <table className="params">
              <tbody>
                <tr><td><code>INITIATED</code></td><td>Created. Waiting for the buyer to approve on PayPal.</td></tr>
                <tr><td><code>HELD</code></td><td>Pal-Lock only. PayPal is holding the money. Nothing is captured yet.</td></tr>
                <tr><td><code>RELEASED</code></td><td>Captured in full to you.</td></tr>
                <tr><td><code>VOIDED</code></td><td>The hold was dropped. The buyer was not charged.</td></tr>
                <tr><td><code>DISPUTED</code></td><td>The buyer disputed the item. The adjudication agent decides.</td></tr>
                <tr><td><code>RESOLVED_RELEASE</code>, <code>RESOLVED_PARTIAL</code>, <code>RESOLVED_REFUND</code></td><td>Outcome of a dispute: full capture, partial capture, or void.</td></tr>
                <tr><td><code>PAID</code></td><td>Checkout only. Captured immediately on approval.</td></tr>
              </tbody>
            </table>
          </section>

          <section id="create">
            <h2>Create a payment</h2>
            <p><span className="endpoint"><span className="verb verb-post">POST</span>/v1/payments</span></p>
            <table className="params">
              <thead><tr><th>Parameter</th><th>Description</th></tr></thead>
              <tbody>
                <tr><td><code>amount</code><span className="req">required</span></td><td>Number greater than 0.</td></tr>
                <tr><td><code>description</code><span className="req">required</span></td><td>What the buyer is paying for. Up to 200 characters.</td></tr>
                <tr><td><code>option</code></td><td><code>pal_lock</code> (default) or <code>checkout</code>.</td></tr>
                <tr><td><code>currency</code></td><td>3-letter ISO code. Defaults to <code>USD</code>.</td></tr>
                <tr><td><code>reference</code></td><td>Your own id. Up to 120 characters. Returned on every webhook.</td></tr>
                <tr><td><code>return_url</code></td><td>Where PayPal sends the buyer after approval. Funguo adds <code>payment</code>, <code>state</code> and <code>reference</code> query parameters.</td></tr>
                <tr><td><code>cancel_url</code></td><td>Where the buyer lands if they cancel on PayPal.</td></tr>
                <tr><td><code>buyer_name</code>, <code>buyer_email</code></td><td>Optional. Shown on the payment.</td></tr>
              </tbody>
            </table>
            <pre className="code">{SAMPLES.create}</pre>
            <p>Returns <code>201</code> with <code>{'{'} "payment": {'{'} … {'}'} {'}'}</code>. Redirect the buyer to <code>payment.approval_url</code>.</p>
          </section>

          <section id="retrieve">
            <h2>Retrieve a payment</h2>
            <p><span className="endpoint"><span className="verb verb-get">GET</span>/v1/payments/:id</span></p>
            <pre className="code">{SAMPLES.get}</pre>
          </section>

          <section id="capture">
            <h2>Capture a payment</h2>
            <p><span className="endpoint"><span className="verb verb-post">POST</span>/v1/payments/:id/capture</span></p>
            <p>Captures the full hold to you. Call it when the buyer confirms the item. Capturing an already released payment returns it unchanged, so a retry is safe. A <code>checkout</code> payment returns <code>409</code> because it was already captured.</p>
            <pre className="code">{SAMPLES.capture}</pre>
          </section>

          <section id="void">
            <h2>Void a payment</h2>
            <p><span className="endpoint"><span className="verb verb-post">POST</span>/v1/payments/:id/void</span></p>
            <p>Drops the hold. The buyer is not charged. Voiding an already voided payment returns it unchanged.</p>
            <pre className="code">{SAMPLES.void}</pre>
          </section>

          <section id="errors">
            <h2>Errors</h2>
            <p>Errors return a JSON body with an <code>error</code> message. When PayPal rejected the call, <code>paypal_debug_id</code> carries PayPal's debug id for their support.</p>
            <pre className="code">{`{ "error": "amount must be greater than 0" }`}</pre>
            <table className="params">
              <tbody>
                <tr><td><code>400</code></td><td>A parameter is missing or invalid.</td></tr>
                <tr><td><code>401</code></td><td>No API key, or the key is unknown or was rolled.</td></tr>
                <tr><td><code>404</code></td><td>The payment does not exist or belongs to another app.</td></tr>
                <tr><td><code>409</code></td><td>The payment is not in a state that allows this call.</td></tr>
                <tr><td><code>5xx</code></td><td>PayPal or Funguo failed. Retrying is safe: money-moving calls are idempotent.</td></tr>
              </tbody>
            </table>
          </section>

          <section id="webhooks">
            <h2>Webhook events</h2>
            <p>Set a webhook URL on your app in the dashboard. Funguo sends a <code>POST</code> with a JSON body for each event below, with a 4-second timeout. Answer with any <code>2xx</code>. Every attempt shows in the app's <b>Event log</b>, and you can send a <code>webhook.test</code> event from the dashboard.</p>
            <table className="params">
              <tbody>
                <tr><td><code>payment.paid</code></td><td>Checkout captured. You already have the money.</td></tr>
                <tr><td><code>payment.held</code></td><td>Pal-Lock placed the PayPal hold.</td></tr>
                <tr><td><code>payment.released</code></td><td>Captured in full, by your capture call or a dispute ruling.</td></tr>
                <tr><td><code>payment.partial</code></td><td>A dispute captured only part of the hold.</td></tr>
                <tr><td><code>payment.voided</code></td><td>The hold was dropped. The buyer was not charged.</td></tr>
                <tr><td><code>webhook.test</code></td><td>Sent from the dashboard. <code>payment</code> is <code>null</code>.</td></tr>
              </tbody>
            </table>
            <pre className="code">{`POST /your/webhook
X-Funguo-Event: payment.held
Funguo-Signature: t=1731230000,v1=5f8c…

{
  "type": "payment.held",
  "created_at": "2026-11-10T09:12:44.120Z",
  "payment": { "id": "ord_8f2kq1", "state": "HELD", "amount": 200, "currency": "USD", "reference": "cart_91", … }
}`}</pre>
          </section>

          <section id="signatures">
            <h2>Verifying signatures</h2>
            <p>Each app has a <b>webhook signing secret</b> (<code>whsec_…</code>) in the dashboard. The <code>Funguo-Signature</code> header holds a timestamp <code>t</code> and <code>v1</code>, the hex HMAC-SHA256 of <code>`${'{'}t{'}'}.${'{'}rawBody{'}'}`</code> with that secret. Compute it over the raw request body, compare in constant time, and reject old timestamps to stop replays.</p>
            <pre className="code">{`// Node.js / Express
import crypto from 'node:crypto';

app.post('/hooks/funguo', express.raw({ type: 'application/json' }), (req, res) => {
  const header = req.get('Funguo-Signature') || '';
  const { t, v1 } = Object.fromEntries(header.split(',').map((p) => p.split('=')));
  const expected = crypto.createHmac('sha256', process.env.FUNGUO_WEBHOOK_SECRET)
    .update(\`\${t}.\${req.body}\`).digest('hex');
  const fresh = Math.abs(Date.now() / 1000 - Number(t)) < 300;
  const ok = v1 && v1.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(v1), Buffer.from(expected));
  if (!ok || !fresh) return res.status(400).end();

  const event = JSON.parse(req.body);
  // handle event.type …
  res.status(204).end();
});`}</pre>
          </section>

          <section id="agents">
            <h2>Agents and MCP</h2>
            <p>AI shopping agents use the buyer-side REST API: check a listing's risk, pay into a hold, upload a photo of what arrived, then confirm or dispute. A dispute is ruled on by Funguo's adjudication agent, which executes the PayPal capture, partial capture or void itself.</p>
            <p>To give Claude Desktop or Claude Code these as tools, run the MCP server from the repository:</p>
            <pre className="code">{`npm run mcp`}</pre>
            <p>To watch an autonomous buyer agent run the whole flow: <code>npm run agent-buyer</code>.</p>
          </section>
        </main>
      </div>
  );
}
