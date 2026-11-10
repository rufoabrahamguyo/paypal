import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { copy, money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote, Loading, OrderRow, RiskBadge, TicketRow } from '../components/ui.jsx';

const VIEWS = {
  overview: ['Overview', 'Describe what the buyer is paying for, then send the link on WhatsApp or email. They create an account from that link and choose PayPal Checkout or Pal-Lock.'],
  orders: ['Orders', 'Every order on your shop. Ship held orders, and follow any dispute from the order page.'],
  listings: ['Listings', 'Your payment requests. Send any of them again as a new invite.'],
  verification: ['Verification', 'Buyers are more willing to pay a seller with a face, a checked Instagram or TikTok account, and ID held by the audit desk.'],
};

function hint(o) {
  if (o.state === 'HELD') return 'Ready to ship';
  if (o.state === 'SHIPPED') return 'In transit';
  if (o.state === 'DISPUTED') return 'Buyer opened a dispute';
  return '';
}

const inviteText = (url, title, price) =>
  `Please pay for ${title} (${price}) on Funguo. You can pay with PayPal Checkout, or use Pal-Lock so the money stays locked until you confirm the item.\n${url}`;

function waDigits(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = `254${d.slice(1)}`;
  return d;
}

function SharePanel({ share }) {
  const toast = useToast();
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  async function sendEmail() {
    if (!email.trim()) return toast('Enter the buyer email');
    try {
      const invite = await api('/api/invites', { json: { listing_id: share.listing_id, channel: 'email', recipient_email: email.trim() } });
      const text = inviteText(invite.invite_url, share.title, share.price);
      window.location.href = `mailto:${encodeURIComponent(email.trim())}?subject=${encodeURIComponent('Payment request on Funguo')}&body=${encodeURIComponent(text)}`;
      toast('Email draft opened. The request will show on their dashboard after they sign up with this email.', 'info');
    } catch (err) { toast(err.message); }
  }
  async function sendWhatsApp() {
    const digits = waDigits(phone);
    if (digits.length < 8) return toast('Enter the buyer WhatsApp number with country code');
    try {
      const invite = await api('/api/invites', { json: { listing_id: share.listing_id, channel: 'whatsapp', recipient_phone: digits } });
      window.open(`https://wa.me/${digits}?text=${encodeURIComponent(inviteText(invite.invite_url, share.title, share.price))}`, '_blank', 'noopener');
    } catch (err) { toast(err.message); }
  }
  return (
    <section id="share" className="card card-pad stack section-gap">
      <h2>Send the payment invite</h2>
      <p className="meta" style={{ margin: 0 }}>{share.title} · {share.price}</p>
      <label className="lbl">Invite link<input className="field" readOnly value={share.invite_url} /></label>
      <div className="pair">
        <label className="lbl">Buyer email<input type="email" className="field" placeholder="buyer@email.com" value={email} onChange={(e) => setEmail(e.target.value)} /></label>
        <label className="lbl">Buyer WhatsApp<input className="field" inputMode="tel" placeholder="2547…" value={phone} onChange={(e) => setPhone(e.target.value)} /></label>
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
        <button type="button" className="btn btn-line" onClick={async () => { await copy(share.invite_url); toast('Invite link copied', 'info'); }}>Copy link</button>
        <button type="button" className="btn btn-primary" onClick={sendEmail}>Open email</button>
        <button type="button" className="btn btn-navy" onClick={sendWhatsApp}>Open WhatsApp</button>
      </div>
      <p className="fine">WhatsApp and email open on your own phone or mail app with the message ready. You tap send. Funguo does not message the buyer by itself.</p>
    </section>
  );
}

function RequestForm({ seller, onCreated }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  return (
    <form className="card card-pad stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const l = await api('/api/listings', { json: { ...formData(e.target), seller_id: seller.id } });
        const invite = await api('/api/invites', { json: { listing_id: l.id, channel: 'link' } });
        e.target.reset();
        toast('Payment request is ready to send', 'info');
        onCreated({ ...invite, title: l.title, price: money(l.price, l.currency), listing_id: l.id });
      } catch (err) { toast(err.message); }
      setBusy(false);
    }}>
      <h2>Request a payment</h2>
      <label className="lbl">Title<input name="title" required className="field" placeholder="What are you selling?" /></label>
      <label className="lbl">Description<textarea name="description" required rows={3} className="field" placeholder="Condition and what is included" /></label>
      <div className="pair">
        <label className="lbl">Price ({seller.currency_label || 'USD'})<input name="price" type="number" step="0.01" min="1" required className="field" /></label>
        <label className="lbl">Image URL <span className="opt">optional</span><input name="image_url" className="field" placeholder="https://…" /></label>
      </div>
      <button type="submit" className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Verifying listing…' : 'Create payment request'}</button>
    </form>
  );
}

function ListingCard({ listing: l, onInvite }) {
  const [busy, setBusy] = useState(false);
  return (
    <article className="card listing">
      <div className="listing-visual">{l.image_url && <img src={l.image_url} alt="" />}</div>
      <div className="listing-body">
        <div className="listing-top"><h3>{l.title}</h3><span className="price">{money(l.price, l.currency)}</span></div>
        <div className="flags"><RiskBadge verification={l.verification} /></div>
        <div className="listing-actions">
          <button type="button" className="btn btn-navy" disabled={busy} onClick={async () => { setBusy(true); await onInvite(l); setBusy(false); }}>Send invite</button>
          <Link className="btn btn-line" to={`/l/${l.id}`}>View</Link>
        </div>
      </div>
    </article>
  );
}

function Trust({ seller: s, reload }) {
  const toast = useToast();
  const verifiedSocial = (s.socials || []).some((x) => x.status === 'verified');
  const done = [!!s.photo_url, verifiedSocial, s.kyc_status === 'verified'].filter(Boolean).length;

  const run = async (fn, okMsg) => {
    try { await fn(); if (okMsg) toast(okMsg, 'info'); await reload(); } catch (err) { toast(err.message); }
  };

  return (
    <section className="card card-pad trust stack" style={{ marginTop: 18 }}>
      <p style={{ margin: 0 }}><b>Build buyer trust</b> <span className="meta">· {done} of 3 done</span>{' '}
        <span className="trust-checks">
          <span className={s.photo_url ? 'ok' : 'todo'}>Photo</span>
          <span className={verifiedSocial ? 'ok' : 'todo'}>Verified social</span>
          <span className={s.kyc_status === 'verified' ? 'ok' : 'todo'}>ID verified</span>
        </span>
      </p>
      <section className="stack trust-part">
        <h3>Your photo and social accounts</h3>
        <p className="meta" style={{ margin: 0 }}>Buyers see your photo, and a social account only after its code is on that public profile.</p>
        <div className="who">
          {s.photo_url ? <img className="avatar" alt="" src={s.photo_url} /> : <div className="avatar" aria-hidden="true" />}
          <form className="stack" onSubmit={(e) => {
            e.preventDefault();
            const file = e.target.photo.files?.[0];
            if (!file) return toast('Choose a photo');
            const body = new FormData();
            body.set('photo', file);
            run(() => api('/api/seller/photo', { form: body }), 'Photo saved');
          }}>
            <label className="lbl">Photo<input name="photo" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required className="field" /></label>
            <button className="btn btn-navy" type="submit">Save photo</button>
          </form>
        </div>
        <form className="stack" onSubmit={(e) => {
          e.preventDefault();
          const body = formData(e.target);
          run(async () => { await api('/api/seller/socials', { json: body }); e.target.reset(); }, 'Account added. Put the code on that profile, then check it.');
        }}>
          <div className="pair">
            <label className="lbl">Account
              <select name="platform" className="field">
                <option value="instagram">Instagram</option>
                <option value="tiktok">TikTok</option>
                <option value="facebook">Facebook</option>
                <option value="x">X</option>
                <option value="youtube">YouTube</option>
              </select>
            </label>
            <label className="lbl">Username<input name="handle" required className="field" placeholder="@yourname or profile link" /></label>
          </div>
          <button className="btn btn-primary" type="submit">Add account</button>
        </form>
        <div className="stack">
          {(s.socials || []).length ? s.socials.map((a) => {
            const checked = a.status === 'verified';
            return (
              <article className="social" key={a.id}>
                <div className="social-top"><b>{a.label}</b> <span className="meta">@{a.handle}</span> {checked ? <span className="ok">checked</span> : <span className="warn">not checked yet</span>}</div>
                {checked
                  ? <a className="social-link" href={a.profile_url} target="_blank" rel="noopener noreferrer">{a.profile_url}</a>
                  : <p className="meta" style={{ margin: 0 }}>Put <b>{a.code}</b> in the bio or a public post, then check.</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {!checked && <button type="button" className="btn btn-line" onClick={() => run(() => api(`/api/seller/socials/${a.id}/check`, { json: {} }), 'That account is checked')}>Check {a.label}</button>}
                  <button type="button" className="btn btn-line" onClick={() => run(() => api(`/api/seller/socials/${a.id}`, { method: 'DELETE' }))}>Remove</button>
                </div>
              </article>
            );
          }) : <p className="meta" style={{ margin: 0 }}>No accounts yet.</p>}
        </div>
      </section>
      <section className="stack trust-part">
        <h3>Identity</h3>
        <p style={{ margin: 0 }}>
          {s.kyc_status === 'verified'
            ? <><span className="ok">National ID verified</span>{s.national_id_last4 && <span className="meta"> · ID ending {s.national_id_last4}</span>}</>
            : <><span className="warn">Not verified</span> <Link to="/seller/onboarding">Verify now</Link></>}
        </p>
        <p className="meta" style={{ margin: 0 }}>Your ID card and face photo stay with the audit desk. Buyers only see the verified badge.</p>
      </section>
    </section>
  );
}

export default function Seller({ view }) {
  const { user } = useSession();
  const toast = useToast();
  const [share, setShare] = useState(null);
  const [title, lead] = VIEWS[view];
  useTitle(title);
  const { data, error, reload } = useLoad(
    () => (user.seller_id ? api(`/api/dashboard/seller?seller_id=${encodeURIComponent(user.seller_id)}`) : Promise.reject(new Error('This account is not a seller shop.'))),
    [user.seller_id],
  );

  // A seller works only after their National ID is verified.
  if (data && data.seller.kyc_status !== 'verified') return <Navigate to="/seller/onboarding" replace />;

  async function invite(l) {
    try {
      const inv = await api('/api/invites', { json: { listing_id: l.id, channel: 'link' } });
      setShare({ ...inv, title: l.title, price: money(l.price, l.currency), listing_id: l.id });
      setTimeout(() => document.getElementById('share')?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 50);
    } catch (err) { toast(err.message); }
  }

  const s = data?.seller;
  const n = data?.stats;
  return (
    <main id="main" className="page">
      <h1 className="page-title">{title}</h1>
      <p className="page-lead">{lead}</p>
      <ErrorNote error={error} />
      {!data ? (!error && <Loading>Loading shop…</Loading>) : (
        <>
          {view === 'overview' && (
            <>
              <p className="meta" style={{ marginTop: 10 }}>{s.name} · {s.verified ? 'verified' : 'unverified'} · {s.total_orders} orders · {s.total_disputes} disputes</p>
              {share && <SharePanel share={share} />}
              <section className="stats" aria-label="Seller summary">
                <article className="card stat"><span>Listings</span><strong>{n.listings}</strong></article>
                <article className="card stat"><span>Orders</span><strong>{n.orders}</strong></article>
                <article className="card stat"><span>On hold</span><strong>{money(n.held, n.currency)}</strong></article>
                <article className="card stat"><span>Released</span><strong>{money(n.released, n.currency)}</strong></article>
              </section>
              <div className="dash-grid">
                <RequestForm seller={s} onCreated={async (next) => { setShare(next); await reload(); }} />
                <section className="stack">
                  <div className="page-head">
                    <h2 className="section-title">Recent orders</h2>
                    {data.orders.length > 5 && <Link className="see-all" to="/seller/orders">View all orders</Link>}
                  </div>
                  <div className="card">{data.orders.length ? data.orders.slice(0, 5).map((o) => <OrderRow key={o.id} order={o} hint={hint(o)} />) : <p className="empty">No orders on this shop yet.</p>}</div>
                </section>
              </div>
              <section className="stack section-gap">
                <div className="page-head">
                  <h2 className="section-title">Complaints</h2>
                  <Link className="btn btn-line" to="/support">File a complaint</Link>
                </div>
                <div className="card">{data.tickets.length ? data.tickets.map((t) => <TicketRow key={t.id} ticket={t} />) : <p className="empty">No support tickets for this shop.</p>}</div>
              </section>
            </>
          )}
          {view === 'orders' && (
            <section className="stack" style={{ marginTop: 18 }}>
              <div className="card">{data.orders.length ? data.orders.map((o) => <OrderRow key={o.id} order={o} hint={hint(o)} />) : <p className="empty">No orders on this shop yet.</p>}</div>
            </section>
          )}
          {view === 'listings' && (
            <>
              {share && <SharePanel share={share} />}
              <section className="stack" style={{ marginTop: 18 }}>
                <div className="listings">
                  {data.listings.length ? data.listings.map((l) => <ListingCard key={l.id} listing={l} onInvite={invite} />)
                    : <p className="empty">No listings yet. <Link to="/seller">Create a payment request</Link> from the overview.</p>}
                </div>
              </section>
            </>
          )}
          {view === 'verification' && <Trust seller={s} reload={reload} />}
        </>
      )}
    </main>
  );
}
