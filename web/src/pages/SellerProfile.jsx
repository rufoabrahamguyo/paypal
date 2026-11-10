import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money, when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { CommunityFlags, ErrorNote, Loading, RiskBadge, SocialLinks, StarText, Stars } from '../components/ui.jsx';

// What a buyer checks before deciding to trust a shop.
export default function SellerProfile() {
  const { id } = useParams();
  const { data, error } = useLoad(() => api(`/api/sellers/${encodeURIComponent(id)}/profile`), [id]);
  useTitle(data?.seller.name);
  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!data) return <main className="page" id="main"><Loading /></main>;
  const { seller: s, reviews, listings } = data;
  const rate = s.dispute_rate == null ? '—' : `${(s.dispute_rate * 100).toFixed(1)}%`;
  return (
    <main id="main" className="page">
      <div className="who" style={{ alignItems: 'center' }}>
        {s.photo_url && <img className="avatar" alt="" src={s.photo_url} />}
        <div>
          <p className="eyebrow">Seller profile</p>
          <h1 className="page-title" style={{ margin: 0 }}>{s.name}</h1>
          <p style={{ margin: '6px 0 0' }}>
            {s.verified ? <span className="ok">National ID verified</span> : <span className="warn">Identity not verified</span>} · <Stars rating={s.rating} count={s.review_count} />
          </p>
        </div>
      </div>
      <CommunityFlags seller={s} />
      <section className="stats" aria-label="Seller record">
        <article className="card stat"><span>Orders</span><strong>{s.total_orders}</strong></article>
        <article className="card stat"><span>Disputes</span><strong>{s.total_disputes}</strong></article>
        <article className="card stat"><span>Dispute rate</span><strong>{rate}</strong></article>
        <article className="card stat"><span>Member since</span><strong style={{ fontSize: 17 }}>{new Date(s.member_since).toLocaleDateString()}</strong></article>
      </section>
      <SocialLinks seller={s} />
      <div className="split section-gap">
        <section className="stack">
          <h2 className="section-title">Reviews</h2>
          <div className="card card-pad">
            {reviews.length ? reviews.map((r) => (
              <article className="review" key={r.id}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                  <span><StarText n={r.seller_rating} /> <b>{r.buyer_name || 'Buyer'}</b></span>
                  <span className="meta">{when(r.created_at)}</span>
                </div>
                <p className="meta" style={{ margin: '4px 0 0' }}>Bought {r.listing_title}</p>
                {r.comment && <p style={{ margin: '6px 0 0' }}>{r.comment}</p>}
              </article>
            )) : <p className="meta" style={{ margin: 0 }}>No reviews yet. Pal-Lock still protects you: the money stays on hold until you confirm the item.</p>}
          </div>
        </section>
        <section className="stack">
          <h2 className="section-title">Items for sale</h2>
          <div className="card">
            {listings.length ? listings.map((l) => (
              <Link key={l.id} className="row-link cols-3" to={`/l/${l.id}`}>
                <span><b>{l.title}</b><span className="meta"><RiskBadge verification={l.verification} /></span></span>
                <span className="price">{money(l.price, l.currency)}</span><span className="meta">View</span>
              </Link>
            )) : <p className="empty">No open payment requests.</p>}
          </div>
        </section>
      </div>
    </main>
  );
}
