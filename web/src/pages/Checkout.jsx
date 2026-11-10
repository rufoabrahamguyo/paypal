import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { CommunityFlags, ErrorNote, Loading, Stars } from '../components/ui.jsx';
import FlowSteps from '../components/FlowSteps.jsx';

function PayPanel({ listing: l, user }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(null);
  const s = l.seller;
  const risky = l.verification?.risk === 'high' || (s.socials || []).some((a) => a.reports > 0);

  async function pay(option, method) {
    setBusy(`${option}-${method}`);
    try {
      const v = await api('/api/orders', { json: { listing_id: l.id, buyer_name: user.name, buyer_email: user.email, payment_method: method, option } });
      // PayPal approval is an external page; everything else stays in the app.
      if (v.order.state === 'INITIATED' && v.order.approval_url) window.location.href = v.order.approval_url;
      else navigate(`/o/${v.order.id}`);
    } catch (err) {
      toast(err.message);
      setBusy(null);
    }
  }
  const label = (key, text) => (busy === key ? 'Contacting PayPal…' : text);

  return (
    <div className="card card-pad checkout stack">
      <div className="checkout-kicker">Paying as {user.name} · {user.email}</div>
      {risky && <p className="callout callout-warn" style={{ margin: 0 }}>This shop has warnings. Pal-Lock keeps your money on hold until you confirm the item.</p>}
      <div className="pay-stack">
        <button type="button" disabled={!!busy} className="btn btn-paypal" onClick={() => pay('pal_lock', 'paypal')}>
          {busy === 'pal_lock-paypal' ? 'Contacting PayPal…' : <>Pay with <span className="pay-word">PayPal</span> · Pal-Lock hold</>}
        </button>
        <button type="button" disabled={!!busy} className="btn btn-line" onClick={() => pay('checkout', 'paypal')}>{label('checkout-paypal', 'Pay the seller now with PayPal Checkout')}</button>
      </div>
      <p className="fine" style={{ margin: 0 }}>With Pal-Lock, PayPal authorizes {money(l.price, l.currency)} and holds it. {s.name} is paid only when you confirm the item, or when a dispute decides. PayPal Checkout pays {s.name} immediately and has no Funguo hold.</p>
      <button type="button" disabled={!!busy} className="btn btn-line btn-block" onClick={() => pay('pal_lock', 'card')}>{label('pal_lock-card', 'Place the Pal-Lock with a sandbox card')}</button>
    </div>
  );
}

export default function Checkout() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useSession();
  const { data: l, error } = useLoad(() => api(`/api/listings/${encodeURIComponent(id)}`), [id]);
  useTitle(l ? `Checkout · ${l.title}` : 'Checkout');
  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!l) return <main className="page" id="main"><Loading /></main>;
  const s = l.seller;
  const here = encodeURIComponent(`/checkout/${l.id}`);
  return (
    <main className="page" id="main">
      <FlowSteps label="Checkout progress" steps={['Review product', 'Checkout', 'Pay through PayPal', 'Money held']} current={1} />
      {params.has('cancelled') && <div className="callout callout-warn" style={{ marginBottom: 16 }}>PayPal approval was cancelled. No hold was placed.</div>}
      <h1 className="page-title">Checkout</h1>
      <div className="split" style={{ marginTop: 16 }}>
        <section className="card card-pad stack">
          <h2 style={{ margin: 0 }}>Order summary</h2>
          <div className="who">
            {l.image_url && <img className="avatar" style={{ borderRadius: 12 }} alt="" src={l.image_url} />}
            <div>
              <b>{l.title}</b>
              <p className="meta" style={{ margin: '4px 0 0' }}>{l.description}</p>
            </div>
          </div>
          <div>
            <div className="summary-line"><span>Seller</span><span><Link to={`/s/${s.seller_id}`}>{s.name}</Link> {s.verified ? <span className="ok">ID verified</span> : <span className="warn">unverified</span>}</span></div>
            <div className="summary-line"><span>Rating</span><span><Stars rating={s.rating} count={s.review_count} /></span></div>
            <div className="summary-line"><span>Item price</span><span>{money(l.price, l.currency)}</span></div>
            <div className="summary-line"><span>Buyer fee</span><span>{money(0, l.currency)}</span></div>
            <div className="summary-line summary-total"><span>You authorize</span><span>{money(l.price, l.currency)}</span></div>
          </div>
          <CommunityFlags seller={s} />
          <p className="fine" style={{ margin: 0 }}>Funguo's fee comes out of the seller's payment. <Link to={`/l/${l.id}`}>Back to product details</Link></p>
        </section>
        {user?.role === 'buyer' ? <PayPanel listing={l} user={user} /> : user ? (
          <section className="card card-pad"><p className="meta" style={{ margin: 0 }}>Sign in with a buyer account to pay.</p></section>
        ) : (
          <section className="card card-pad stack">
            <h2>Sign in to pay</h2>
            <p className="meta" style={{ margin: 0 }}>The hold is tied to your buyer account, so you can track the parcel and confirm the item later.</p>
            <Link className="btn btn-primary" to={`/signup?role=buyer&next=${here}`}>Create a buyer account</Link>
            <Link className="btn btn-line" to={`/login?next=${here}`}>I already have an account</Link>
          </section>
        )}
      </div>
    </main>
  );
}
