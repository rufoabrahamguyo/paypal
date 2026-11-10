import { Link } from 'react-router-dom';
import { CommunityFlags, SocialLinks, Stars } from './ui.jsx';

// The seller block on product, checkout and invite pages: who they are and how to check them.
export default function SellerCard({ seller: s, profileButton = true }) {
  return (
    <section className="card card-pad">
      <div className="who">
        {s.photo_url && <img className="avatar" alt="" src={s.photo_url} />}
        <div>
          <div className="seller-name">
            {s.seller_id ? <Link to={`/s/${s.seller_id}`}>{s.name}</Link> : s.name}{' '}
            {s.verified ? <span className="ok">ID verified</span> : <span className="warn">unverified</span>}
          </div>
          <p style={{ margin: '4px 0 0' }}><Stars rating={s.rating} count={s.review_count} /></p>
          <p className="meta" style={{ margin: '6px 0 0' }}>{s.total_orders} orders · {s.total_disputes} disputes · member since {new Date(s.member_since).toLocaleDateString()}</p>
          <SocialLinks seller={s} />
          <CommunityFlags seller={s} />
          {profileButton && s.seller_id && <Link className="btn btn-line" style={{ marginTop: 10 }} to={`/s/${s.seller_id}`}>Check profile, ratings and reviews</Link>}
        </div>
      </div>
    </section>
  );
}
