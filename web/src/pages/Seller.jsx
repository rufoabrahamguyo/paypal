import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { copy, greeting, money } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { DashHead, ErrorNote, Icon, Loading, OrderRow, Panel, PlatformFields, RiskBadge, Stat, TicketRow } from '../components/ui.jsx';

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
  const [image, setImage] = useState(null);
  const [preview, setPreview] = useState('');

  function pickImage(file) {
    if (!file) return;
    if (!file.type.startsWith('image/')) return toast('Choose a photo');
    if (file.size > 5 * 1024 * 1024) return toast('Photo must be under 5 MB');
    if (preview) URL.revokeObjectURL(preview);
    setImage(file);
    setPreview(URL.createObjectURL(file));
  }

  function clearImage() {
    if (preview) URL.revokeObjectURL(preview);
    setImage(null);
    setPreview('');
  }

  return (
    <form id="request" className="card card-pad stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const body = new FormData(e.target);
        body.set('seller_id', seller.id);
        if (image) body.set('image', image);
        const l = await api('/api/listings', { form: body });
        const invite = await api('/api/invites', { json: { listing_id: l.id, channel: 'link' } });
        e.target.reset();
        clearImage();
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
        <div className="lbl">Image <span className="opt">optional</span>
          <div className="image-choices">
            <label className="btn btn-line">Upload an image
              <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
            <label className="btn btn-line"><Icon name="camera" /> Take photo
              <input type="file" accept="image/*" capture="environment" onChange={(e) => { pickImage(e.target.files?.[0]); e.target.value = ''; }} />
            </label>
          </div>
          {preview ? (
            <div className="image-preview">
              <img src={preview} alt="" />
              <button type="button" className="btn btn-line" onClick={clearImage}>Remove</button>
            </div>
          ) : (
            <input name="image_url" className="field" placeholder="Or paste an image link" />
          )}
        </div>
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
  const [platform, setPlatform] = useState('instagram');
  const [socialForm, setSocialForm] = useState(0);
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
        <form key={socialForm} className="stack" onSubmit={(e) => {
          e.preventDefault();
          const body = formData(e.target);
          const custom = body.platform === 'other';
          run(async () => {
            await api('/api/seller/socials', { json: body });
            setPlatform('instagram');
            setSocialForm((n) => n + 1);
          }, custom
            ? 'Account saved. A code check only runs on TikTok, Instagram, Facebook, X, and YouTube.'
            : 'Account added. Put the code on that profile, then check it.');
        }}>
          <PlatformFields platform={platform} onPlatform={setPlatform} />
          <button className="btn btn-primary" type="submit">Add account</button>
        </form>
        <div className="stack">
          {(s.socials || []).length ? s.socials.map((a) => {
            const checked = a.status === 'verified';
            const custom = String(a.platform || '').startsWith('other:');
            return (
              <article className="social" key={a.id}>
                <div className="social-top"><b>{a.label}</b> <span className="meta">@{a.handle}</span> {checked ? <span className="ok">checked</span> : <span className="warn">not checked yet</span>}</div>
                {checked
                  ? <a className="social-link" href={a.profile_url} target="_blank" rel="noopener noreferrer">{a.profile_url}</a>
                  : custom
                    ? <p className="meta" style={{ margin: 0 }}>Saved as {a.label}. Buyers see an account after a code check, and that check runs on TikTok, Instagram, Facebook, X, and YouTube.</p>
                    : <p className="meta" style={{ margin: 0 }}>Put <b>{a.code}</b> in the bio or a public post, then check.</p>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {!checked && !custom && <button type="button" className="btn btn-line" onClick={() => run(() => api(`/api/seller/socials/${a.id}/check`, { json: {} }), 'That account is checked')}>Check {a.label}</button>}
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
  const disputes = s?.total_disputes || 0;
  return (
    <main id="main" className="page">
      <DashHead
        kicker="Seller"
        title={view === 'overview' ? greeting(user.name) : title}
        lead={view === 'overview' ? (s ? `${s.name} is ${s.verified ? 'verified' : 'not verified yet'}. Money on hold stays in PayPal until the buyer confirms.` : 'Money on hold stays in PayPal until the buyer confirms.') : lead}
        action={view === 'overview' ? <a className="btn btn-navy" href="#request">Request a payment</a> : null}
      />
      <ErrorNote error={error} />
      {!data ? (!error && <Loading>Loading shop…</Loading>) : (
        <>
          {view === 'overview' && (
            <>
              {share && <SharePanel share={share} />}
              <section className="stats" aria-label="Seller summary">
                <Stat icon="lock" label="On hold" value={money(n.held, n.currency)} note="Waiting for the buyer to confirm" />
                <Stat icon="wallet" label="Released" value={money(n.released, n.currency)} note="Paid to this shop" tone="good" />
                <Stat icon="orders" label="Orders" value={n.orders} note={disputes ? `${disputes} dispute${disputes === 1 ? '' : 's'} on record` : 'No disputes on record'} tone={disputes ? 'warn' : 'good'} />
                <Stat icon="tag" label="Listings" value={n.listings} note="Payment requests you can send again" />
              </section>
              <div className="dash-board">
                <Panel
                  title="Recent orders"
                  action={data.orders.length > 5 ? <Link className="see-all" to="/seller/orders">View all</Link> : null}
                >
                  {data.orders.length ? data.orders.slice(0, 5).map((o) => <OrderRow key={o.id} order={o} hint={hint(o)} />) : <p className="empty">No orders on this shop yet.</p>}
                </Panel>
                <div className="dash-side">
                  <RequestForm seller={s} onCreated={async (next) => { setShare(next); await reload(); }} />
                  <Panel title="Reports" action={<Link className="see-all" to="/support">File one</Link>}>
                    {data.tickets.length ? data.tickets.map((t) => <TicketRow key={t.id} ticket={t} />) : <p className="empty">No reports for this shop.</p>}
                  </Panel>
                </div>
              </div>
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
