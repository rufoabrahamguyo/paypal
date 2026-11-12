import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SETTLED, greeting, money, when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { DashHead, ErrorNote, Loading, OrderRow, Panel, Stat, TicketRow } from '../components/ui.jsx';

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
    <section className="card card-pad stack">
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

  const open = data?.stats.open_tickets || 0;
  return (
    <main id="main" className="page">
      <DashHead
        kicker="Buyer"
        title={view === 'orders' ? 'Orders' : greeting(first)}
        lead={view === 'orders' ? 'Every payment you have made, newest first.' : 'Track money still on hold, what has been released, and anything you need to report.'}
        action={view === 'orders' ? null : <Link className="btn btn-navy" to="/support">Report a problem</Link>}
      />
      <ErrorNote error={error} />
      {!data ? <Loading>Loading your payments…</Loading> : view === 'orders' ? (
        <OrdersCard orders={data.orders} />
      ) : (
        <>
          <section className="stats" aria-label="Buyer summary">
            <Stat icon="lock" label="On hold" value={money(data.stats.held, data.stats.currency)} note="Still in PayPal until you confirm" />
            <Stat icon="wallet" label="Released" value={money(data.stats.released, data.stats.currency)} note="Paid out after you confirmed" tone="good" />
            <Stat icon="orders" label="Orders" value={data.stats.orders} note={data.invites?.length ? `${data.invites.length} waiting for you` : 'Nothing waiting to pay'} />
            <Stat icon="flag" label="Open reports" value={open} note={open ? 'A complaint is still open' : 'No open complaints'} tone={open ? 'warn' : 'good'} />
          </section>
          <div className="dash-board">
            <Panel
              title="Recent orders"
              action={data.orders.length > 5 ? <Link className="see-all" to="/buyer/orders">View all</Link> : null}
            >
              {data.orders.length ? data.orders.slice(0, 5).map((o) => <OrderRow key={o.id} order={o} hint={hint(o)} />)
                : <p className="empty">No orders yet. Open a payment link a seller sent you, or buy from the demo market.</p>}
            </Panel>
            <div className="dash-side">
              {data.invites?.length > 0 && (
                <Panel title="Waiting for you">
                  {data.invites.map((inv) => (
                    <Link key={inv.id} className="row-link" to={`/i/${inv.id}`}>
                      <span><b>{inv.title}</b><span className="meta">{inv.seller_name} asked you to pay</span></span>
                      <span className="price">{money(inv.price, inv.currency)}</span>
                      <span className="badge b-amber">to pay</span>
                      <span className="meta">{when(inv.created_at)}</span>
                    </Link>
                  ))}
                </Panel>
              )}
              <FindSeller />
              <Panel title="Reports" action={<Link className="see-all" to="/support">File one</Link>}>
                {data.tickets.length ? data.tickets.map((t) => <TicketRow key={t.id} ticket={t} />) : <p className="empty">No reports from this email.</p>}
              </Panel>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
