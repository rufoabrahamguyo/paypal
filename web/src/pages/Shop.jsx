import { useEffect, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useToast } from '../lib/toast.jsx';

// Abode: a sample merchant with its own cart, calling the Pal-Lock API from its server.
function Cart({ cancelled }) {
  const toast = useToast();
  const [qty, setQty] = useState(1);
  const [busy, setBusy] = useState(null);
  const total = qty * 200;

  async function pay(option) {
    setBusy(option);
    try {
      const v = await api('/api/shop/checkout', { json: { option, quantity: qty } });
      if (v.payment.state === 'INITIATED' && v.payment.approval_url) window.location.href = v.payment.approval_url;
      else window.location.href = `/shop/done?payment=${v.payment.id}`;
    } catch (err) {
      toast(err.message);
      setBusy(null);
    }
  }

  return (
    <>
      {cancelled && <div className="callout callout-warn" style={{ gridColumn: '1/-1' }}>Payment cancelled. Nothing was charged.</div>}
      <section>
        <p className="eyebrow">Shopping cart</p>
        <h1 className="page-title">Your chair</h1>
        <article className="card card-pad shop-item">
          <div className="shop-thumb" role="img" aria-label="Oak chair" />
          <div>
            <h2 style={{ margin: 0 }}>Modern Oak Cushion Chair</h2>
            <p className="meta" style={{ margin: '4px 0 0' }}>{money(200)} each</p>
            <div className="qty">
              <button type="button" aria-label="Fewer" onClick={() => setQty((q) => Math.max(1, q - 1))}>−</button>
              <b>{qty}</b>
              <button type="button" aria-label="More" onClick={() => setQty((q) => Math.min(12, q + 1))}>+</button>
            </div>
          </div>
        </article>
      </section>
      <section className="card card-pad shop-sum">
        <h2>Order summary</h2>
        <div className="shop-line"><span>Subtotal</span><span>{money(total)}</span></div>
        <div className="shop-line"><span>Shipping</span><span>FREE</span></div>
        <div className="shop-line shop-total"><span>Est. total</span><span>{money(total)}</span></div>
        <div className="pay-stack" style={{ marginTop: 8 }}>
          <button type="button" className="btn btn-paypal" disabled={!!busy} onClick={() => pay('checkout')}>
            {busy === 'checkout' ? 'Contacting PayPal…' : <><span className="pay-word">PayPal</span> Checkout</>}
          </button>
          <button type="button" className="btn btn-paypal" disabled={!!busy} onClick={() => pay('pal_lock')}>
            {busy === 'pal_lock' ? 'Contacting PayPal…' : <span className="pay-word">Pal-Lock</span>}
          </button>
        </div>
        <p className="fine">Checkout pays Abode now. Pal-Lock locks the same amount until you confirm the chair.</p>
      </section>
    </>
  );
}

function Result({ paymentId, error }) {
  const toast = useToast();
  const [v, setV] = useState(null);
  const [loadError, setLoadError] = useState(null);
  useEffect(() => {
    api(`/api/shop/payments/${encodeURIComponent(paymentId)}`).then(setV).catch(setLoadError);
  }, [paymentId]);
  const act = async (name) => {
    try { setV(await api(`/api/shop/payments/${encodeURIComponent(paymentId)}/${name}`, { json: {} })); } catch (err) { toast(err.message); }
  };
  if (loadError) return <p className="callout callout-bad">{loadError.message}</p>;
  if (!v) return <p className="meta">Loading…</p>;
  const p = v.payment;
  const locked = p.option === 'pal_lock' && p.state === 'HELD';
  const paid = p.state === 'PAID' || p.state === 'RELEASED';
  const dropped = p.state === 'VOIDED';
  const headline = paid ? 'Abode has been paid' : dropped ? 'Pal-Lock was dropped' : locked ? 'Pal-Lock is holding the money' : p.state;
  const detail = p.option === 'checkout'
    ? 'PayPal Checkout captured the payment. The seller already has it.'
    : paid ? 'You confirmed the chair. Pal-Lock released the hold to Abode.'
      : dropped ? 'The hold was cancelled. You were not charged.'
        : 'Abode does not have the money yet. Confirm the chair to release it, or drop the lock.';
  return (
    <section className="card card-pad stack" style={{ gridColumn: '1/-1' }}>
      {error && <div className="callout callout-bad">{error}</div>}
      <p className="eyebrow">{v.app} · {p.id}</p>
      <h1 className="page-title">{headline}</h1>
      <p>{p.description} · {money(p.amount, p.currency)}</p>
      <p className="meta" style={{ margin: 0 }}>{detail}</p>
      {locked && (
        <div className="pay-stack">
          <button type="button" className="btn btn-success" onClick={() => act('capture')}>Confirm the chair and release {money(p.amount, p.currency)}</button>
          <button type="button" className="btn btn-line" onClick={() => act('void')}>Drop the Pal-Lock</button>
        </div>
      )}
      <div>
        <div className="eyebrow">What Abode was told</div>
        <ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>
          {(v.events || []).length ? v.events.map((e) => <li key={e.id}><b>{e.type}</b> <span className="meta">{e.delivered ? 'delivered to Abode' : 'not delivered'}</span></li>)
            : <li className="meta">No webhook yet.</li>}
        </ul>
      </div>
      <Link className="btn btn-line" to="/shop">Back to the cart</Link>
    </section>
  );
}

export default function Shop() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const done = pathname.startsWith('/shop/done') && params.get('payment');
  useEffect(() => { document.title = 'Abode — Shopping cart'; }, []);
  return (
    <>
      <header className="shop-bar">
        <strong>ABODE</strong>
        <Link to="/developer">Payments by Funguo</Link>
      </header>
      <main id="main" className="shop-grid">
        {done ? <Result paymentId={params.get('payment')} error={params.get('error')} /> : <Cart cancelled={params.has('cancelled')} />}
      </main>
      <p className="shop-foot">Abode is a sample shop with its own cart. Pal-Lock is a Funguo button next to PayPal Checkout. People selling from TikTok or WhatsApp still use <Link to="/">the Funguo link</Link>.</p>
    </>
  );
}
