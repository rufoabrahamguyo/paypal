import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { ErrorNote, Loading, RiskBadge } from '../components/ui.jsx';
import SellerCard from '../components/SellerCard.jsx';

function VerificationPanel({ v }) {
  if (!v) return null;
  const ref = v.reference;
  return (
    <section className="card card-pad stack">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}><h2>Listing check</h2><RiskBadge verification={v} /></div>
      {ref?.price_stats && <p className="meta">Market reference ({ref.source}): {money(ref.price_stats.min)}–{money(ref.price_stats.max)}, median {money(ref.price_stats.median)}</p>}
      {v.flags?.length
        ? <ul className="meta" style={{ margin: 0, paddingLeft: 18, color: 'var(--ink)' }}>{v.flags.map((f) => <li key={f}>{f}</li>)}</ul>
        : <p className="meta">No red flags found.</p>}
    </section>
  );
}

// Step "Review product and order details" before the checkout page.
export default function Listing() {
  const { id } = useParams();
  const { user } = useSession();
  const { data: l, error } = useLoad(() => api(`/api/listings/${encodeURIComponent(id)}`), [id]);
  useTitle(l?.title);
  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!l) return <main className="page" id="main"><Loading /></main>;
  const next = encodeURIComponent(`/l/${l.id}`);
  return (
    <main className="page" id="main">
      <div className="product">
        <div className="stack-lg">
          {l.image_url ? <img src={l.image_url} className="shot" alt="" /> : <div className="shot" />}
          <VerificationPanel v={l.verification} />
        </div>
        <div className="stack-lg">
          <div>
            <p className="eyebrow">Product details</p>
            <h1>{l.title}</h1>
            <div className="amount">{money(l.price, l.currency)}</div>
            <p className="desc">{l.description}</p>
          </div>
          <SellerCard seller={l.seller} />
          {user?.role === 'seller' ? (
            <section className="card card-pad stack">
              <h2>This is your payment request</h2>
              <p className="meta" style={{ margin: 0 }}>Send it from your dashboard. The buyer creates an account from the link, then chooses PayPal Checkout or Pal-Lock.</p>
              <Link className="btn btn-primary" to="/seller/listings">Back to dashboard</Link>
            </section>
          ) : user?.role === 'buyer' ? (
            <section className="card card-pad stack">
              <h2>Ready to pay?</h2>
              <p className="meta" style={{ margin: 0 }}>Not sure about this shop yet? Read its profile and reviews first. When you trust it, review the order on the checkout page and pay through PayPal into a hold.</p>
              <Link className="btn btn-primary btn-block" to={`/checkout/${l.id}`}>Continue to checkout</Link>
            </section>
          ) : (
            <section className="card card-pad stack">
              <h2>Create a buyer account to pay</h2>
              <p className="meta" style={{ margin: 0 }}>The hold is tied to your account, so the seller can see who paid and you can confirm the item later.</p>
              <Link className="btn btn-primary" to={`/signup?role=buyer&next=${next}`}>Create account</Link>
              <Link className="btn btn-line" to={`/login?next=${next}`}>I already have an account</Link>
            </section>
          )}
        </div>
      </div>
    </main>
  );
}
