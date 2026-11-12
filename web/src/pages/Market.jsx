import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { copy, money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useToast } from '../lib/toast.jsx';
import { RiskBadge } from '../components/ui.jsx';

function ListingCard({ listing: l }) {
  const toast = useToast();
  const v = l.verification;
  return (
    <article className="card listing">
      <div className="listing-visual">{l.image_url && <img src={l.image_url} alt="" />}</div>
      <div className="listing-body">
        <div className="listing-top">
          <h3>{l.title}</h3>
          <span className="price">{money(l.price, l.currency)}</span>
        </div>
        <div className="meta">{l.seller?.name} {l.seller?.verified ? '· verified' : '· unverified'} · {l.seller?.total_orders} orders</div>
        <div className="flags"><RiskBadge verification={v} /> {v?.flags?.length ? <span className="flag-note">{v.flags[0]}</span> : null}</div>
        <div className="listing-actions">
          <Link to={`/l/${l.id}`} className="btn btn-navy">View item</Link>
          <button type="button" className="btn btn-line" onClick={async () => { await copy(l.checkout_url); toast('Checkout link copied', 'info'); }}>Copy link</button>
        </div>
      </div>
    </article>
  );
}

export default function Market() {
  useTitle('Market');
  const { data: listings, error } = useLoad(() => api('/api/listings'));
  return (
    <main id="main" className="page">
      <section className="hero">
        <div>
          <p className="eyebrow">Held payment</p>
          <h1>The buyer pays. The seller waits.</h1>
          <p className="lede">
            Funds sit in a PayPal authorization hold. They move to the seller when the buyer confirms the item.
            If there is a dispute, Funguo’s agent reads the evidence and runs the matching PayPal action — capture, partial capture, or void — with a written rationale.
          </p>
        </div>
        <ol className="facts">
          <li><em>01</em><div><strong>Who</strong><span>Buyers, sellers, and the dispute agent on one order.</span></div></li>
          <li><em>02</em><div><strong>What</strong><span>An authorization hold, not an instant payout to the seller.</span></div></li>
          <li><em>03</em><div><strong>Where</strong><span>Capture, partial capture, or void, recorded on the order.</span></div></li>
        </ol>
      </section>
      <section className="stack" data-tour="listings">
        <h2 className="section-title">Listings</h2>
        {error && <p className="callout callout-bad">{error.message}</p>}
        <div className="listings">
          {listings?.map((l) => <ListingCard key={l.id} listing={l} />)}
          {listings && !listings.length && <p className="empty">No listings yet. Open the seller dashboard, or run <code>npm run seed</code>.</p>}
        </div>
      </section>
    </main>
  );
}
