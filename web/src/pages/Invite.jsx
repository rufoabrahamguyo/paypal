import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { CommunityFlags, ErrorNote, Loading, SocialLinks } from '../components/ui.jsx';

// The link a seller sends on WhatsApp or email.
export default function Invite() {
  const { id } = useParams();
  const { user } = useSession();
  const { data: invite, error } = useLoad(() => api(`/api/invites/${encodeURIComponent(id)}`), [id]);
  useTitle(invite?.title);
  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!invite) return <main className="page" id="main"><Loading>Loading the payment request…</Loading></main>;
  const next = encodeURIComponent(`/i/${id}`);
  return (
    <main id="main" className="page">
      <p className="eyebrow">Payment invite</p>
      <div className="product">
        <div>{invite.image_url ? <img className="shot" alt="" src={invite.image_url} /> : <div className="shot" />}</div>
        <div className="stack-lg">
          <div>
            <h1 className="page-title">{invite.title}</h1>
            <div className="amount">{money(invite.price, invite.currency)}</div>
            <p className="desc">{invite.description}</p>
          </div>
          <section className="card card-pad">
            <div className="who">
              {invite.seller?.photo_url && <img className="avatar" alt="" src={invite.seller.photo_url} />}
              <div>
                <div className="seller-name">{invite.seller_name}</div>
                <p className="meta" style={{ margin: '6px 0 0' }}>asked you to pay into escrow. The money stays on hold until you confirm the item.</p>
                <SocialLinks seller={invite.seller} />
                <CommunityFlags seller={invite.seller} />
              </div>
            </div>
          </section>
          <section className="card card-pad stack">
            {user?.role === 'buyer' ? (
              <Link className="btn btn-primary btn-block" to={`/l/${invite.listing_id}`}>Continue as {user.name} and review the order</Link>
            ) : user?.role === 'seller' ? (
              <>
                <p className="meta">You are signed in as a seller. The buyer should open this link and create a buyer account.</p>
                <Link className="btn btn-line" to="/seller">Seller dashboard</Link>
              </>
            ) : (
              <>
                <Link className="btn btn-primary btn-block" to={`/signup?role=buyer&next=${next}`}>Create a buyer account</Link>
                <Link className="btn btn-line btn-block" to={`/login?next=${next}`}>I already have an account</Link>
              </>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}
