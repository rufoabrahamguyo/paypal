import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote, Loading, TicketBadge } from '../components/ui.jsx';

function Bubble({ name, at, body, support }) {
  return (
    <article className={`bubble${support ? ' is-support' : ''}`}>
      <header><b>{name}</b><span>{when(at)}</span></header>
      <p style={{ margin: 0, whiteSpace: 'pre-line' }}>{body}</p>
    </article>
  );
}

function Ticket({ id }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { data: t, error, setData } = useLoad(() => api(`/api/support/${encodeURIComponent(id)}`), [id]);
  useTitle(t?.subject || 'Support');
  if (error) return <ErrorNote error={error} />;
  if (!t) return <Loading />;
  return (
    <>
      <h1 className="page-title">{t.subject}</h1>
      <p className="page-lead">{t.topic} · {t.author_email}{t.order_id ? ` · ${t.order_id}` : ''}</p>
      <p style={{ margin: '14px 0' }}><Link to="/support">All complaints</Link> · <TicketBadge status={t.status} /></p>
      <section className="card card-pad thread">
        <Bubble name={t.author_name || t.author_role} at={t.created_at} body={t.body} />
        {(t.messages || []).map((m) => <Bubble key={m.id} name={m.author_name || m.author_role} at={m.created_at} body={m.body} support={m.author_role === 'support'} />)}
      </section>
      <form className="card card-pad stack" style={{ marginTop: 16 }} onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          setData(await api(`/api/support/${t.id}/replies`, { json: { ...formData(e.target), author_email: t.author_email, author_role: t.author_role } }));
          e.target.reset();
          toast('Reply sent', 'info');
        } catch (err) { toast(err.message); }
        setBusy(false);
      }}>
        <h2>Add a reply</h2>
        <p className="meta" style={{ margin: 0 }}>Replies use {t.author_email}. Support answers are sent from the audit desk.</p>
        <label className="lbl">Message
          <textarea name="body" required rows={3} className="field" placeholder="Add what changed, or what you still need" />
        </label>
        <button className="btn btn-primary" type="submit" disabled={busy}>Send reply</button>
      </form>
    </>
  );
}

function Desk({ user }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [busy, setBusy] = useState(false);
  const role = user.role === 'seller' ? 'seller' : 'buyer';
  const { data: tickets } = useLoad(() => {
    const q = new URLSearchParams();
    if (user.role === 'buyer') q.set('email', user.email);
    if (user.role === 'seller' && user.seller_id) q.set('seller_id', user.seller_id);
    return api(`/api/support?${q}`);
  }, [user.id]);
  return (
    <>
      <h1 className="page-title">Complaints</h1>
      <p className="page-lead">Tell us what went wrong with an order, a payment, or a listing. This is separate from the dispute agent, which only runs when a buyer disputes a delivery.</p>
      <div className="dash-grid" style={{ marginTop: 18 }}>
        <form className="card card-pad stack" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const ticket = await api('/api/support', { json: { ...formData(e.target), author_role: role } });
            navigate(`/support/${ticket.id}`);
          } catch (err) { toast(err.message); setBusy(false); }
        }}>
          <h2>New complaint</h2>
          <label className="lbl">I am<input className="field" readOnly value={role === 'seller' ? 'A seller' : 'A buyer'} /></label>
          <label className="lbl">Name<input className="field" readOnly value={user.name} /></label>
          <label className="lbl">Email<input className="field" readOnly value={user.email} /></label>
          <label className="lbl">Order id <span className="opt">optional</span>
            <input name="order_id" className="field" defaultValue={params.get('order') || ''} placeholder="ord_…" />
          </label>
          <label className="lbl">Topic
            <select name="topic" className="field">
              <option value="order">An order</option>
              <option value="payment">A payment or hold</option>
              <option value="listing">A listing</option>
              <option value="account">My account</option>
              <option value="other">Something else</option>
            </select>
          </label>
          <label className="lbl">Subject
            <input name="subject" required minLength={3} maxLength={140} className="field" placeholder="Short summary" />
          </label>
          <label className="lbl">What happened
            <textarea name="body" required minLength={10} rows={4} className="field" placeholder="Include what you expected and what you got" />
          </label>
          <button className="btn btn-primary btn-block" type="submit" disabled={busy}>Submit complaint</button>
        </form>
        <section className="stack">
          <h2 className="section-title">Your complaints</h2>
          <div className="card">
            {!tickets ? <p className="empty">Loading…</p> : tickets.length ? tickets.map((t) => (
              <Link key={t.id} className="row-link cols-3" to={`/support/${t.id}`}>
                <span><b>{t.subject}</b><span className="meta">{t.topic}</span></span>
                <span><TicketBadge status={t.status} /></span>
                <span className="meta">{when(t.updated_at)}</span>
              </Link>
            )) : <p className="empty">None yet.</p>}
          </div>
        </section>
      </div>
    </>
  );
}

export default function Support() {
  const { id } = useParams();
  const { user } = useSession();
  useTitle('Support');
  return (
    <main id="main" className="page">
      <p className="eyebrow">Support</p>
      {id ? <Ticket id={id} />
        : user.role === 'buyer' || user.role === 'seller' ? <Desk user={user} />
          : <p className="callout">Sign in with a buyer or seller account to file a complaint. Answer complaints from the <Link to="/admin">audit desk</Link>.</p>}
    </main>
  );
}
