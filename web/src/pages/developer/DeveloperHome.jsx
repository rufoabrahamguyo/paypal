import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { copy } from '../../lib/format.js';
import { useLoad, useTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';

export default function DeveloperHome() {
  useTitle('Developer');
  const toast = useToast();
  const { data } = useLoad(async () => {
    const demo = await api('/api/apps/demo');
    return { key: demo.api_key };
  });
  const origin = window.location.origin;

  return (
    <main id="main">
      <section className="dev-hero">
        <div className="dev-hero-inner">
          <div>
            <p className="land-kicker">Pal-Lock API</p>
            <h1>Escrow on PayPal, in one API call.</h1>
            <p>Your cart stays yours. Create a payment with <code>option: "pal_lock"</code> and the buyer's money is held by PayPal until you capture it. Or use <code>option: "checkout"</code> for a normal PayPal Checkout capture. Funguo tells your server what happened through signed webhooks.</p>
            <div className="land-actions">
              <Link className="btn btn-gold" to="/developer/dashboard">Get API keys</Link>
              <Link className="btn btn-ghost" to="/developer/docs">Read the docs</Link>
            </div>
          </div>
          <pre className="code" aria-label="Example request">
            <span className="c"># Hold $200 until the buyer confirms</span>{'\n'}
            {`curl ${origin}/api/v1/payments \\\n  -H `}<span className="k">"Authorization: Bearer $FUNGUO_SECRET_KEY"</span>{` \\
  -H "Content-Type: application/json" \\
  -d '{
    "option": "pal_lock",
    "amount": 200,
    "currency": "USD",
    "description": "Oak cushion chair",
    "return_url": "https://yourshop.com/thanks"
  }'\n\n`}
            <span className="c">{`# → 201 { "payment": { "id": "ord_…", "state": "INITIATED",
#          "approval_url": "https://www.sandbox.paypal.com/…" } }`}</span>
          </pre>
        </div>
      </section>

      <div className="dev-page stack-lg">
        <section className="dev-cards">
          <Link className="card dev-card" to="/developer/docs#quickstart">
            <p className="eyebrow">1 · Quickstart</p>
            <h3>Make your first hold</h3>
            <p>Create an app, copy its secret key, and place a sandbox hold with curl in under five minutes.</p>
          </Link>
          <Link className="card dev-card" to="/developer/docs#payments">
            <p className="eyebrow">2 · API reference</p>
            <h3>Payments</h3>
            <p>Create, retrieve, capture and void. Every endpoint, parameter and response field.</p>
          </Link>
          <Link className="card dev-card" to="/developer/docs#webhooks">
            <p className="eyebrow">3 · Webhooks</p>
            <h3>Signed events</h3>
            <p><code>payment.held</code>, <code>payment.released</code>, <code>payment.voided</code> and more, each signed with HMAC-SHA256.</p>
          </Link>
        </section>

        <section className="card card-pad stack">
          <p className="eyebrow">Sandbox</p>
          <h2 style={{ margin: 0 }}>Try it without an account</h2>
          <p className="meta" style={{ margin: 0 }}>The sample shop <b>Abode</b> has a public sandbox key so you can see a call work end to end. Use your own app's key for anything else: keys from <Link to="/developer/dashboard">Apps &amp; Credentials</Link> are private to you.</p>
          <label className="lbl">Public sandbox key
            <div className="cred">
              <input className="field" readOnly value={data?.key || 'Loading…'} />
              <button type="button" className="btn btn-line" onClick={async () => { await copy(data?.key || ''); toast('Copied', 'info'); }}>Copy</button>
            </div>
          </label>
          <Link className="btn btn-navy" to="/shop">Open the sample cart</Link>
        </section>

        <section className="card card-pad stack">
          <p className="eyebrow">For AI agents</p>
          <h2 style={{ margin: 0 }}>Let an agent shop through escrow</h2>
          <p className="meta" style={{ margin: 0 }}>Agents can use the same REST API, or run Funguo as an MCP server so Claude Desktop or Claude Code gets tools to check risk, pay into a hold, inspect the delivery and confirm or dispute. Run <code>npm run mcp</code> from the repository. See <Link to="/developer/docs#agents">Agents and MCP</Link>.</p>
        </section>
      </div>
    </main>
  );
}
