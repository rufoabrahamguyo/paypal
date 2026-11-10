import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { money, stateLabel, when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { Badge, ErrorNote, Json, Loading, StarText } from '../components/ui.jsx';

const HAPPY = ['INITIATED', 'HELD', 'SHIPPED', 'INSPECTED', 'RELEASED'];
const CHECKOUT = ['INITIATED', 'PAID'];
const DECISION_LABEL = {
  release_full: ['Released to seller', 'Full capture of the authorization', 'tone-release'],
  partial_refund: ['Partial refund', 'Captured a smaller amount with final_capture=true; the remainder of the hold returned to the buyer', 'tone-partial'],
  refund_full: ['Full refund', 'Authorization voided. The buyer is never charged', 'tone-refund'],
  escalate_to_human: ['Escalated to a human', 'No money moved. Funds stay on hold pending human review', 'tone-human'],
};
const STEP_LABEL = {
  lookup_product_reference: 'Checking market prices (Channel3)',
  search_scam_patterns: 'Searching known scam patterns (Elastic)',
  release_full: 'Decision: release to seller',
  partial_refund: 'Decision: partial refund',
  refund_full: 'Decision: void the hold',
  escalate_to_human: 'Decision: hand to a human',
};

// Who is looking decides which actions show: the buyer, the seller, or the audit desk.
function viewerRole(user, o, seller) {
  if (!user) return 'guest';
  if (user.role === 'admin') return 'admin';
  if (user.role === 'seller' && seller.seller_id && user.seller_id === seller.seller_id) return 'seller';
  if (user.role === 'buyer' && o.buyer_email && user.email.toLowerCase() === o.buyer_email.toLowerCase()) return 'buyer';
  return 'guest';
}

function Stepper({ order: o, events, completed }) {
  const visited = new Set(events.map((e) => e.to_state));
  const disputed = visited.has('DISPUTED');
  const base = o.payment_option === 'checkout' ? CHECKOUT : HAPPY;
  const path = o.state === 'VOIDED'
    ? ['INITIATED', 'HELD', 'VOIDED']
    : disputed
      ? [...base.filter((s) => visited.has(s)), 'DISPUTED', o.state.startsWith('RESOLVED') ? o.state : 'RESOLVED']
      : base;
  // Every transaction ends with a receipt and the buyer's rating.
  const full = [...path, 'RECEIPT', 'COMPLETED'];
  const LABEL = { RESOLVED: 'Ruling', RECEIPT: 'Receipt', COMPLETED: 'Completed' };
  if (o.settled) visited.add('RECEIPT');
  if (completed) visited.add('COMPLETED');
  const current = completed ? 'COMPLETED' : o.settled ? 'RECEIPT' : o.state;
  return (
    <div style={{ overflowX: 'auto' }}>
      <ol className="steps">
        {full.map((s, i) => (
          <FragmentStep key={s} last={i === full.length - 1}>
            <li className={`step ${s === current ? 'is-current' : visited.has(s) ? 'is-done' : ''}`} title={s}>{LABEL[s] || stateLabel(s)}</li>
          </FragmentStep>
        ))}
      </ol>
    </div>
  );
}
const FragmentStep = ({ children, last }) => <>{children}{!last && <li className="step-arrow" aria-hidden="true">→</li>}</>;

// <details> whose open state survives the 2.5s polling re-renders.
function Panel({ id, open, onToggle, summary, children, className = 'panel' }) {
  return (
    <details className={className} open={open.has(id)} onToggle={(e) => onToggle(id, e.currentTarget.open)}>
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

function Transcript({ disputeId }) {
  const [steps, setSteps] = useState(null);
  useEffect(() => {
    api(`/api/disputes/${disputeId}`).then((d) => setSteps(d.transcript || [])).catch((e) => setSteps([{ role: 'error', content: e.message }]));
  }, [disputeId]);
  if (!steps) return <div className="tx">Loading…</div>;
  if (!steps.length) return <div className="tx">No transcript.</div>;
  return (
    <div className="tx">
      {steps.map((t, i) => (
        <div className="tx-step" key={i}>
          <div className="tx-role">{t.role}{t.tool ? ` · ${t.tool}` : ''}</div>
          <div style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{typeof t.content === 'string' ? t.content : JSON.stringify(t.content, null, 2)}</div>
        </div>
      ))}
    </div>
  );
}

function DisputeCard({ dispute: d, order: o, role, open, onToggle, act }) {
  const [refund, setRefund] = useState('');
  const photos = (
    <>
      {d.photo_path && <figure className="evidence"><img src={`/api/disputes/${d.id}/photo`} alt="What the buyer received" /><figcaption>Buyer</figcaption></figure>}
      {o.has_packing_photo && <figure className="evidence"><img src={`/api/orders/${o.id}/packing-photo`} alt="What the seller packed" /><figcaption>Seller packed</figcaption></figure>}
    </>
  );
  const head = (
    <div className="evidence-row">
      {(d.photo_path || o.has_packing_photo) && <div className="evidence-set">{photos}</div>}
      <div><div className="meta">Buyer complaint · {when(d.created_at)}</div><p className="quote">“{d.complaint}”</p></div>
    </div>
  );
  if (d.status === 'OPEN' || d.status === 'RUNNING') {
    return (
      <section className="card card-pad stack">
        {head}
        <div className="agent-live" role="status">
          <svg className="spin" viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity=".25" /><path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" /></svg>
          <div><b>The dispute agent is reading the evidence.</b><p>Listing, photo, tracking, seller history, market prices, and scam patterns. This usually takes 20–60 seconds.</p></div>
        </div>
        {d.live_steps?.length > 0 && (
          <ol className="live-steps" aria-live="polite">
            {d.live_steps.map((s, i) => (
              <li key={i} className={`live-${s.kind}`}>
                <span className="live-tag">{s.kind === 'reasoning' ? 'Thinking' : s.kind === 'call' ? (STEP_LABEL[s.tool] || s.tool) : s.kind === 'result' ? 'Result' : 'Note'}</span>
                <span>{s.text || ''}</span>
              </li>
            ))}
          </ol>
        )}
      </section>
    );
  }
  const [title, sub, tone] = DECISION_LABEL[d.decision] || ['Agent failed', d.error || '', 'tone-fail'];
  const f = d.findings || {};
  const human = d.status === 'ESCALATED' && o.state === 'DISPUTED' && role === 'admin';
  const pct = d.confidence == null ? null : Math.round(d.confidence * 100);
  return (
    <section className={`card card-pad stack ${tone}`} style={{ borderWidth: 1 }}>
      {head}
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8, alignItems: 'baseline' }}>
        <h3 style={{ margin: 0, fontSize: 18 }}>{title}{d.decision === 'partial_refund' && ` — ${money(d.refund_amount, o.currency)} back to the buyer`}</h3>
        <span className="meta">engine <b>{d.engine}</b> · {when(d.decided_at)}</span>
      </div>
      <p className="meta">{sub}</p>
      {pct != null && (
        <div className="meter"><span className="meter-label">Confidence</span>
          <div className="meter-track"><span className={pct >= 70 ? '' : 'is-mid'} style={{ width: `${pct}%` }} /></div><b>{pct}%</b></div>
      )}
      <div><div className="eyebrow">Rationale</div><p style={{ margin: '6px 0 0', whiteSpace: 'pre-line' }}>{d.rationale}</p></div>
      {f.evidence?.length > 0 && (
        <div><div className="eyebrow">Evidence weighed</div><ul style={{ margin: '8px 0 0', paddingLeft: 18 }}>{f.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul></div>
      )}
      {f.guardrail && <div className="guard"><b>Guardrail.</b> {f.guardrail}</div>}
      {f.proposed_decision && <p className="meta">Proposed action before the guardrail: <b>{f.proposed_decision}</b>{f.proposed_refund_amount ? ` (${money(f.proposed_refund_amount, o.currency)})` : ''}</p>}
      {d.error && <p className="meta" style={{ color: 'var(--alert)' }}>Error: {d.error}</p>}
      {human && (
        <div className="card card-pad stack">
          <h2>Human reviewer</h2>
          <div className="review-row">
            <button type="button" className="btn btn-success" onClick={() => act(`/api/disputes/${d.id}/resolve`, { decision: 'release_full' })}>Release to seller</button>
            <div className="review-partial">
              <input type="number" step="0.01" min="0" placeholder="Amount" aria-label="Refund amount" className="field" style={{ marginTop: 0 }} value={refund} onChange={(e) => setRefund(e.target.value)} />
              <button type="button" className="btn btn-teal" onClick={() => act(`/api/disputes/${d.id}/resolve`, { decision: 'partial_refund', refund_amount: refund || undefined })}>Partial refund</button>
            </div>
            <button type="button" className="btn btn-violet" onClick={() => act(`/api/disputes/${d.id}/resolve`, { decision: 'refund_full' })}>Void hold</button>
          </div>
        </div>
      )}
      {d.paypal_response && <Panel id={`pp-${d.id}`} open={open} onToggle={onToggle} summary="PayPal response"><Json value={d.paypal_response} /></Panel>}
      <Panel id={`tx-${d.id}`} open={open} onToggle={onToggle} summary={`Agent transcript (${d.transcript_steps} steps)`}>
        {open.has(`tx-${d.id}`) && <Transcript disputeId={d.id} />}
      </Panel>
    </section>
  );
}

function DisputeForm({ order: o, open, onToggle, onSubmit }) {
  return (
    <Panel id="dispute" open={open} onToggle={onToggle} className="dispute-open" summary="No, something is wrong. Open a dispute">
      <form className="stack" style={{ padding: '0 12px 12px' }} onSubmit={onSubmit}>
        <label className="lbl">What arrived
          <textarea name="complaint" required rows={3} className="field" placeholder="Describe what arrived and how it differs from the listing" />
        </label>
        {o.has_inspection_photo && <p className="meta" style={{ margin: 0 }}>Your photo of the item is attached as evidence.</p>}
        <label className="lbl">{o.has_inspection_photo ? 'Another photo' : 'Photo of what arrived'} <span className="opt">optional, JPEG, PNG, or WebP, up to 5MB</span>
          <input type="file" name="photo" accept="image/png,image/jpeg,image/webp,image/gif" className="field" />
        </label>
        <button className="btn btn-alert btn-block" type="submit">Submit to the dispute agent</button>
      </form>
    </Panel>
  );
}

function Kv({ label, children, mono = true }) {
  return <div><dt>{label}</dt><dd className={mono ? 'mono' : ''}>{children ?? '—'}</dd></div>;
}

function ActionsPanel({ order: o, role, open, onToggle, act, upload, toast }) {
  const a = o.allowed_actions;
  const isBuyer = role === 'buyer' || role === 'admin';
  const isSeller = role === 'seller' || role === 'admin';
  const [tracking] = useState(() => `JD0146${Math.floor(Math.random() * 1e8)}`);
  const parts = [];
  const disputeSubmit = (e) => { e.preventDefault(); upload(`/api/orders/${o.id}/disputes`, new FormData(e.target), { closePanel: 'dispute' }); };

  if (a.includes('approve') && isBuyer) parts.push(<a key="approve" href={o.approval_url} className="btn btn-paypal">Continue to PayPal approval</a>);
  if (a.includes('ship') && isSeller) {
    parts.push(
      <form key="ship" className="stack" onSubmit={(e) => { e.preventDefault(); upload(`/api/orders/${o.id}/ship`, new FormData(e.target)); }}>
        <div className="eyebrow">Seller · ship the item</div>
        <div className="pair" style={{ gridTemplateColumns: '1fr 2fr' }}>
          <label className="lbl">Carrier<input name="carrier" defaultValue="DHL" className="field" /></label>
          <label className="lbl">Tracking<input name="tracking_number" required placeholder="Tracking number" defaultValue={tracking} className="field" /></label>
        </div>
        <label className="lbl">Packing photo <span className="opt">optional, protects you if the buyer disputes</span>
          <input type="file" name="packing_photo" accept="image/png,image/jpeg,image/webp,image/gif" className="field" />
        </label>
        <button className="btn btn-sky btn-block" type="submit">Mark shipped</button>
      </form>,
    );
  }
  if (a.includes('ship') && role === 'buyer') parts.push(<p key="wait" className="meta" style={{ margin: 0 }}>The money is held. Waiting for the seller to ship.</p>);
  if (['SHIPPED', 'INSPECTED'].includes(o.state)) {
    parts.push(
      <div key="track" className="stack"><div className="eyebrow">Shipment</div>
        <dl className="kv"><Kv label="Carrier" mono={false}>{o.carrier || '—'}</Kv><Kv label="Tracking number">{o.tracking_number || '—'}</Kv><Kv label="Status" mono={false}>{o.delivery_status || '—'}</Kv></dl>
      </div>,
    );
  }
  if (a.includes('deliver') && isBuyer) {
    parts.push(
      <div key="deliver" className="stack"><div className="eyebrow">Has the item been delivered?</div>
        <button type="button" className="btn btn-primary btn-block" onClick={() => act(`/api/orders/${o.id}/deliver`, {})}>Yes, my parcel arrived</button>
        <button type="button" className="btn btn-line btn-block" onClick={() => toast('No problem. Come back when the parcel arrives. The money stays on hold.', 'info')}>Not yet, keep tracking</button>
      </div>,
    );
  }
  if (a.includes('deliver') && role === 'seller') parts.push(<p key="transit" className="meta" style={{ margin: 0 }}>In transit. The buyer confirms when the parcel arrives.</p>);
  if (o.state === 'INSPECTED' && isBuyer) {
    parts.push(
      <div key="photo" className="stack"><div className="eyebrow">Step 1 · Take a photo of what arrived</div>
        {o.has_inspection_photo && <img className="inspect-shot" alt="Your photo of the item" src={`/api/orders/${o.id}/inspection-photo?v=${o.updated_at}`} />}
        <form className="cred" onSubmit={(e) => { e.preventDefault(); upload(`/api/orders/${o.id}/inspection-photo`, new FormData(e.target)); }}>
          <input type="file" name="photo" accept="image/png,image/jpeg,image/webp" capture="environment" required className="field" />
          <button className="btn btn-line" type="submit">{o.has_inspection_photo ? 'Replace photo' : 'Upload photo'}</button>
        </form>
      </div>,
      <div key="decide" className="stack"><div className="eyebrow">Step 2 · Is the item as described?</div>
        {o.has_inspection_photo || role === 'admin' ? (
          <>
            {a.includes('confirm') && <button type="button" className="btn btn-success btn-block" onClick={() => act(`/api/orders/${o.id}/confirm`, {}, 'Capturing on PayPal…')}>Yes, confirm delivery and release {money(o.amount, o.currency)}</button>}
            {a.includes('dispute') && <DisputeForm order={o} open={open} onToggle={onToggle} onSubmit={disputeSubmit} />}
          </>
        ) : <p className="meta" style={{ margin: 0 }}>Add the photo first. It is your evidence if anything is wrong.</p>}
      </div>,
    );
  } else if (a.includes('dispute') && role === 'buyer') {
    parts.push(<div key="dispute" className="stack"><DisputeForm order={o} open={open} onToggle={onToggle} onSubmit={disputeSubmit} /></div>);
  }
  if (o.state === 'INSPECTED' && role === 'seller') parts.push(<p key="inspecting" className="meta" style={{ margin: 0 }}>Delivered. The buyer is inspecting the item.</p>);

  if (!parts.length) {
    if (role === 'guest' && !o.settled) return <section className="card card-pad"><p className="meta" style={{ margin: 0 }}>Sign in as the buyer or the seller to act on this order.</p></section>;
    return null;
  }
  return <section className="card card-pad stack"><h2>Next steps</h2>{parts}</section>;
}

function RateRow({ name, label }) {
  const [value, setValue] = useState(0);
  return (
    <fieldset className="stack" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="lbl">{label}</legend>
      <div className="rate-row">
        {[1, 2, 3, 4, 5].map((n) => (
          <span key={n}>
            <input type="radio" id={`${name}${n}`} name={name} value={n} required onChange={() => setValue(n)} />
            <label htmlFor={`${name}${n}`} className={n <= value ? 'lit' : undefined} title={`${n} star${n > 1 ? 's' : ''}`}>★</label>
          </span>
        ))}
      </div>
    </fieldset>
  );
}

function SettledPanel({ view: v, role, act }) {
  const { order: o, review, completed } = v;
  if (!o.settled) return null;
  const receipt = <Link className="btn btn-line" to={`/o/${o.id}/receipt`}>View digital receipt</Link>;
  if (completed) {
    return (
      <section className="card card-pad stack">
        <div className="callout callout-ok"><b>Transaction completed.</b> The payment is settled and the buyer rated the seller.</div>
        <p style={{ margin: 0 }}><StarText n={review.seller_rating} /> seller · <StarText n={review.service_rating} /> service</p>
        {review.comment && <p className="quote" style={{ margin: 0 }}>“{review.comment}”</p>}
        <div>{receipt}</div>
      </section>
    );
  }
  if (role !== 'buyer') {
    return <section className="card card-pad stack"><h2>Settled</h2><p className="meta" style={{ margin: 0 }}>Waiting for the buyer to rate the order.</p><div>{receipt}</div></section>;
  }
  return (
    <section className="card card-pad stack">
      <h2>Your receipt is ready</h2>
      <p className="meta" style={{ margin: 0 }}>Keep it for your records. Then rate the seller and the service to complete the transaction.</p>
      <div>{receipt}</div>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); act(`/api/orders/${o.id}/review`, formData(e.target), 'Saving…', 'Thanks. Transaction completed.'); }}>
        <RateRow name="seller_rating" label={`How was ${v.seller.name}?`} />
        <RateRow name="service_rating" label="How was Funguo escrow?" />
        <label className="lbl">Review <span className="opt">optional, shown on the seller's profile</span>
          <textarea name="comment" rows={3} className="field" maxLength={1000} placeholder="What should other buyers know?" />
        </label>
        <button className="btn btn-primary" type="submit">Submit rating</button>
      </form>
    </section>
  );
}

function payNote(o, seller) {
  if (o.payment_option === 'checkout' && o.state === 'PAID') return ['ok', `Paid with PayPal Checkout. ${seller.name} already has this money.`];
  if ((o.payment_option || 'pal_lock') !== 'checkout' && o.state === 'HELD') return ['warn', `Pal-Lock is holding this money. ${seller.name} is paid when you confirm the item, or when a dispute is resolved.`];
  if (o.state === 'VOIDED') return ['ok', 'Pal-Lock was dropped. The buyer was not charged.'];
  return null;
}

export default function Order() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const { user } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(() => new Set());
  const [busy, setBusy] = useState(null);
  const { data: v, error, reload, setData } = useLoad(() => api(`/api/orders/${encodeURIComponent(id)}`), [id]);
  useTitle(v ? v.order.id : 'Order');

  // Poll while PayPal approval or the dispute agent is still working.
  const working = v && (v.order.state === 'INITIATED' || v.disputes.some((d) => d.status === 'OPEN' || d.status === 'RUNNING'));
  useEffect(() => {
    if (!working) return undefined;
    const t = setTimeout(reload, 2500);
    return () => clearTimeout(t);
  }, [working, v, reload]);

  const onToggle = (key, isOpen) => setOpen((s) => {
    if (s.has(key) === isOpen) return s;
    const next = new Set(s);
    if (isOpen) next.add(key); else next.delete(key);
    return next;
  });

  // JSON action; when the response is an order view it replaces the page data.
  async function act(path, body, label = 'Working…', okMsg) {
    setBusy(label);
    try {
      const res = await api(path, { json: body });
      if (res?.order) setData(res); else await reload();
      if (okMsg) toast(okMsg, 'info');
    } catch (err) { toast(err.message); await reload(); }
    setBusy(null);
  }
  async function upload(path, form, { closePanel } = {}) {
    setBusy('Uploading…');
    try {
      const res = await api(path, { form });
      if (closePanel) onToggle(closePanel, false);
      if (res?.order) setData(res); else await reload();
    } catch (err) { toast(err.message); await reload(); }
    setBusy(null);
  }

  if (error) return <main className="page" id="main"><ErrorNote error={error} /></main>;
  if (!v) return <main className="page" id="main"><Loading /></main>;
  const { order: o, listing: l, seller: s, events, paypal_calls: calls, disputes } = v;
  const role = viewerRole(user, o, s);
  const note = payNote(o, s);
  const err = params.get('error');

  return (
    <main className="page" id="main" aria-busy={!!busy}>
      {busy && <div className="toast" role="status">{busy}</div>}
      {err && <div className="callout callout-bad" style={{ marginBottom: 16 }}>{err}</div>}
      {note && <div className={`callout callout-${note[0]}`} style={{ marginBottom: 16 }}>{note[1]}</div>}
      <div className="order-head">
        <div>
          <div className="kicker mono">{o.id} {o.buyer_kind === 'agent' && <span className="badge b-indigo">bought by agent</span>} {o.payment_option === 'checkout' ? <span className="badge b-sky">PayPal Checkout</span> : <span className="badge b-amber">Pal-Lock</span>}</div>
          <h1>{o.app_id ? l.title : <Link to={`/l/${l.id}`}>{l.title}</Link>}</h1>
          <p className="meta" style={{ margin: 0 }}>{money(o.amount, o.currency)} · seller {s.seller_id ? <Link to={`/s/${s.seller_id}`}>{s.name}</Link> : s.name} · buyer {o.buyer_name || '—'}</p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}><Badge state={o.state} /><Link className="btn btn-line" to={`/support?order=${o.id}`}>Contact support</Link></div>
      </div>
      <Stepper order={o} events={events} completed={v.completed} />
      <div className="split">
        <div className="stack-lg">
          <SettledPanel view={v} role={role} act={act} />
          {disputes.map((d) => <DisputeCard key={d.id} dispute={d} order={o} role={role} open={open} onToggle={onToggle} act={act} />)}
          <ActionsPanel order={o} role={role} open={open} onToggle={onToggle} act={act} upload={upload} toast={toast} />
          <section className="card card-pad">
            <h2>State history</h2>
            <ol className="timeline">
              {events.map((e, i) => (
                <li key={e.id ?? i}><span className="when">{when(e.created_at)}</span>
                  <span>{e.from_state && `${stateLabel(e.from_state)} → `}<b title={e.to_state}>{stateLabel(e.to_state)}</b> <span className="meta">· {e.actor} · {e.note || ''}</span></span>
                </li>
              ))}
            </ol>
          </section>
        </div>
        <div className="stack-lg">
          <section className="card card-pad">
            <h2>PayPal</h2>
            <dl className="kv">
              <Kv label="PayPal order">{o.paypal_order_id}</Kv>
              <Kv label="Authorization">{o.authorization_id}</Kv>
              <Kv label="Hold expires" mono={false}>{when(o.authorization_expires_at)}</Kv>
              {o.guaranteed_until && <Kv label="Funds guaranteed until" mono={false}>{when(o.guaranteed_until)}{o.payment_method === 'paypal' ? ' · then reauthorized' : ''}</Kv>}
              {o.reauthorized_at && <Kv label="Reauthorized" mono={false}>{when(o.reauthorized_at)}</Kv>}
              <Kv label="Capture">{o.capture_id}</Kv>
              <Kv label="Captured" mono={false}>{o.captured_amount != null ? money(o.captured_amount, o.currency) : '—'}</Kv>
              <Kv label="Platform fee" mono={false}>{o.platform_fee ? money(o.platform_fee, o.currency) : '—'}</Kv>
              <Kv label="Option" mono={false}>{o.payment_option === 'checkout' ? 'PayPal Checkout' : 'Pal-Lock'}</Kv>
              <Kv label="Method" mono={false}>{o.payment_method}</Kv>
              <Kv label="Tracking" mono={false}>{o.tracking_number ? `${o.carrier} ${o.tracking_number} · ${o.delivery_status}` : o.delivery_status}</Kv>
            </dl>
            <p className="fine" style={{ marginTop: 10 }}>Sign in at <a href="https://www.sandbox.paypal.com" target="_blank" rel="noopener noreferrer">sandbox.paypal.com</a> with the sandbox business account, open Activity, and search these ids.</p>
          </section>
          <section className="card card-pad stack">
            <h2>Under the hood · PayPal API calls ({calls.length})</h2>
            <div className="stack">
              {calls.length ? calls.map((c) => (
                <Panel key={c.id} id={`call-${c.id}`} open={open} onToggle={onToggle} summary={
                  <>{c.op}
                    <span className="mono" style={{ float: 'right', color: c.http_status < 300 ? 'var(--success)' : 'var(--alert)' }}>{c.http_status}</span>
                    <div className="mono meta">{c.request?.method || ''} {c.request?.path || ''}</div></>
                }>
                  <p className="meta">PayPal-Request-Id: <span className="mono">{c.request_id || '—'}</span></p>
                  <Json value={c.response} />
                </Panel>
              )) : <p className="meta">None yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
