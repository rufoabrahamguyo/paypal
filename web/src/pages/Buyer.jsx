import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SETTLED, money, when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote, Loading, OrderRow, TicketRow } from '../components/ui.jsx';

function hint(o) {
  if (o.state === 'INITIATED') return 'Finish PayPal approval';
  if (o.state === 'SHIPPED') return 'Track the parcel';
  if (o.state === 'INSPECTED') return 'Confirm the item or open a dispute';
  if (o.state === 'DISPUTED') return 'A dispute is open';
  if (SETTLED.includes(o.state) && !o.reviewed) return 'Rate the seller to finish';
  return '';
}

function OrdersCard({ orders }) {
  return (
    <div className="card">
      {orders.length ? orders.map((o) => <OrderRow key={o.id} order={o} hint={hint(o)} />)
        : <p className="empty">No orders yet. Open a payment link a seller sent you, or <Link to="/market">buy from the demo market</Link>.</p>}
    </div>
  );
}

// "Find seller or open shared purchase link"
function FindSeller() {
  const navigate = useNavigate();
  const toast = useToast();
  return (
    <section className="card card-pad stack" style={{ marginTop: 18 }}>
      <h2 style={{ margin: 0 }}>Buy from a seller</h2>
      <div className="pair">
        <form className="stack" role="search" onSubmit={(e) => {
          e.preventDefault();
          navigate(`/sellers?q=${encodeURIComponent(e.target.q.value.trim())}`);
        }}>
          <label className="lbl">Find a seller
            <div className="cred"><input name="q" className="field" placeholder="Shop name or @handle" /><button className="btn btn-primary" type="submit">Search</button></div>
          </label>
        </form>
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          let target = null;
          try {
            const url = new URL(e.target.link.value.trim(), window.location.origin);
            if (/^\/(i|l|s|checkout)\/[\w-]+$/.test(url.pathname)) target = url.pathname;
          } catch { /* not a URL */ }
          if (!target) return toast('That is not a Funguo payment link. It should look like /i/… or /l/…');
          navigate(target);
        }}>
          <label className="lbl">Open a link a seller shared
            <div className="cred"><input name="link" className="field" placeholder="Paste the Funguo payment link" /><button className="btn btn-line" type="submit">Open</button></div>
          </label>
        </form>
      </div>
    </section>
  );
}

export default function Buyer({ view }) {
  const { user } = useSession();
  const { data, error } = useLoad(() => api(`/api/dashboard/buyer?email=${encodeURIComponent(user.email)}`), [user.email]);
  const first = String(user.name || '').split(/\s+/)[0];
  useTitle(view === 'orders' ? 'Orders' : 'Overview');

  return (
    <main id="main" className="page">
      <h1 className="page-title">{view === 'orders' ? 'Orders' : first ? `Welcome back, ${first}` : 'Overview'}</h1>
      <p className="page-lead">{view === 'orders' ? 'Every order you have paid into escrow, newest first.' : `Payment requests sent to ${user.email} show up here.`}</p>
      <ErrorNote error={error} />
      {!data ? <Loading>Loading your payments…</Loading> : view === 'orders' ? (
        <section className="stack" style={{ marginTop: 18 }}><OrdersCard orders={data.orders} /></section>
      ) : (
        <>
          <FindSeller />
          {data.invites?.length > 0 && (
            <section className="stack" style={{ marginTop: 18 }}>
              <h2 className="section-title">Waiting for you</h2>
              <div className="card">
                {data.invites.map((inv) => (
                  <Link key={inv.id} className="row-link" to={`/i/${inv.id}`}>
                    <span><b>{inv.title}</b><span className="meta">{inv.seller_name} asked you to pay</span></span>
                    <span className="price">{money(inv.price, inv.currency)}</span>
                    <span className="badge b-amber">to pay</span>
                    <span className="meta">{when(inv.created_at)}</span>
                  </Link>
                ))}
              </div>
            </section>
          )}
          <section className="stats" aria-label="Buyer summary">
            <article className="card stat"><span>Orders</span><strong>{data.stats.orders}</strong></article>
            <article className="card stat"><span>On hold</span><strong>{money(data.stats.held, data.stats.currency)}</strong></article>
            <article className="card stat"><span>Released</span><strong>{money(data.stats.released, data.stats.currency)}</strong></article>
            <article className="card stat"><span>Open complaints</span><strong>{data.stats.open_tickets}</strong></article>
          </section>
          <section className="stack">
            <div className="page-head">
              <h2 className="section-title">Recent orders</h2>
              {data.orders.length > 5 && <Link className="see-all" to="/buyer/orders">View all orders</Link>}
            </div>
            <OrdersCard orders={data.orders.slice(0, 5)} />
          </section>
          <section className="stack section-gap">
            <div className="page-head">
              <h2 className="section-title">Complaints</h2>
              <Link className="btn btn-line" to="/support">File a complaint</Link>
            </div>
            <div className="card">{data.tickets.length ? data.tickets.map((t) => <TicketRow key={t.id} ticket={t} />) : <p className="empty">No support tickets from this email.</p>}</div>
          </section>
        </>
      )}
    </main>
  );
}
