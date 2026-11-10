import { useState } from 'react';
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom';
import { api, formData } from '../../lib/api.js';
import { copy, money, when } from '../../lib/format.js';
import { useLoad, useTitle } from '../../lib/hooks.js';
import { useToast } from '../../lib/toast.jsx';
import { Badge, ErrorNote, Json, Loading } from '../../components/ui.jsx';

const mask = (s) => `${s.slice(0, 7)}${'•'.repeat(18)}${s.slice(-4)}`;

function CopyField({ label, value, secret }) {
  const toast = useToast();
  const [shown, setShown] = useState(false);
  return (
    <label className="lbl">{label}
      <div className="cred">
        <input className="field" readOnly value={secret && !shown ? mask(value) : value} />
        {secret && <button type="button" className="btn btn-line" onClick={() => setShown(!shown)}>{shown ? 'Hide' : 'Show'}</button>}
        <button type="button" className="btn btn-line" onClick={async () => { await copy(value); toast('Copied', 'info'); }}>Copy</button>
      </div>
    </label>
  );
}

// A button that needs a second click, instead of a browser confirm() dialog.
function ArmedButton({ className, label, armedLabel, onConfirm, as = 'button' }) {
  const [armed, setArmed] = useState(false);
  const props = {
    type: 'button',
    onClick: () => (armed ? onConfirm() : setArmed(true)),
  };
  if (as === 'link') {
    return <button {...props} className="see-all" style={{ background: 'none', border: 0, padding: 0, cursor: 'pointer' }}>{armed ? armedLabel : label}</button>;
  }
  return <button {...props} className={armed ? `${className} btn-danger` : className}>{armed ? armedLabel : label}</button>;
}

// ---- app list ------------------------------------------------------------------------
function AppList() {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const { data, error } = useLoad(() => api('/api/developer/apps'));
  return (
    <>
      <div className="page-head">
        <div>
          <p className="eyebrow">Dashboard</p>
          <h1 className="page-title">Apps &amp; Credentials</h1>
          <p className="page-lead">Each app gets its own secret key, webhook and event log. Keys work against PayPal Sandbox.</p>
        </div>
        <span className="mode-pill">● Sandbox</span>
      </div>
      <section className="card card-pad stack" style={{ margin: '18px 0 24px' }}>
        <h2 style={{ margin: 0 }}>Create app</h2>
        <form className="pair" onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const { app } = await api('/api/developer/apps', { json: formData(e.target) });
            navigate(`/developer/apps/${app.id}#credentials`);
          } catch (err) { toast(err.message); setBusy(false); }
        }}>
          <label className="lbl">App name<input name="name" required className="field" placeholder="My shop" /></label>
          <label className="lbl">Webhook URL <span className="opt">optional</span><input name="webhook_url" className="field" placeholder="https://example.com/hooks/funguo" /></label>
          <div><button className="btn btn-primary" type="submit" disabled={busy}>Create app</button></div>
        </form>
      </section>
      <h2 className="section-title">Your apps</h2>
      <ErrorNote error={error} />
      <div className="app-list" style={{ marginTop: 12 }}>
        {!data ? <p className="meta">Loading…</p> : data.apps.length ? data.apps.map((a) => (
          <Link key={a.id} className="card app-tile" to={`/developer/apps/${a.id}`}>
            <h3>{a.name}</h3>
            <p className="meta" style={{ margin: 0 }}><code>{a.id}</code> · created {when(a.created_at)}</p>
            <div className="kv" style={{ marginTop: 12 }}>
              <div><span>Payments</span><b>{a.stats.payments}</b></div>
              <div><span>On hold</span><b>{money(a.stats.held)}</b></div>
              <div><span>Captured</span><b>{money(a.stats.captured)}</b></div>
            </div>
            <p className="meta" style={{ margin: '10px 0 0' }}>{a.webhook_url ? `Webhook: ${a.webhook_url}` : 'No webhook yet'}</p>
          </Link>
        )) : <p className="empty card">No apps yet. Create one above to get a secret key.</p>}
      </div>
    </>
  );
}

// ---- one app -------------------------------------------------------------------------
const TABS = [['credentials', 'Credentials'], ['webhooks', 'Webhooks'], ['payments', 'Payments'], ['events', 'Event log'], ['settings', 'Settings']];

function AppDetail({ id }) {
  const toast = useToast();
  const navigate = useNavigate();
  const { hash } = useLocation();
  const tab = TABS.some(([k]) => `#${k}` === hash) ? hash.slice(1) : 'credentials';
  const [hookResult, setHookResult] = useState(null);
  const { data: d, error, reload } = useLoad(() => api(`/api/developer/apps/${encodeURIComponent(id)}`), [id]);
  useTitle(d?.app.name || 'App');
  const path = `/api/developer/apps/${encodeURIComponent(id)}`;

  const run = async (fn, msg) => {
    try { await fn(); if (msg) toast(msg, 'info'); await reload(); } catch (err) { toast(err.message); }
  };

  if (error) return <><ErrorNote error={error} /><p><Link to="/developer/dashboard">Back to your apps</Link></p></>;
  if (!d) return <Loading />;
  const { app, stats, payments, events } = d;
  const origin = window.location.origin;

  return (
    <>
      <p className="meta" style={{ margin: 0 }}><Link to="/developer/dashboard">Apps &amp; Credentials</Link> / {app.name}</p>
      <div className="page-head" style={{ marginTop: 8 }}>
        <h1 className="page-title" style={{ margin: 0 }}>{app.name}</h1>
        <span className="mode-pill">● Sandbox</span>
      </div>
      <section className="stats" aria-label="App summary">
        <article className="card stat"><span>Payments</span><strong>{stats.payments}</strong></article>
        <article className="card stat"><span>On hold</span><strong>{money(stats.held)}</strong></article>
        <article className="card stat"><span>Captured</span><strong>{money(stats.captured)}</strong></article>
        <article className="card stat"><span>Webhook</span><strong style={{ fontSize: 15 }}>{app.webhook_url ? 'Configured' : 'Not set'}</strong></article>
      </section>
      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => <button key={k} type="button" role="tab" aria-selected={k === tab} onClick={() => navigate(`#${k}`, { replace: true })}>{label}</button>)}
      </div>

      {tab === 'credentials' && (
        <>
          <section className="card card-pad stack">
            <h2 style={{ margin: 0 }}>API credentials</h2>
            <CopyField label="App ID" value={app.id} />
            <CopyField label="Secret key" value={app.api_key} secret />
            <p className="fine" style={{ margin: 0 }}>Send as <code>Authorization: Bearer</code> from your server only. Rolling it stops the old key at once.{' '}
              <ArmedButton as="link" label="Roll key" armedLabel="Click again to roll. The old key stops working." onConfirm={() => run(() => api(`${path}/rotate`, { json: { which: 'secret' } }), 'New secret key created')} />
            </p>
            <CopyField label="API base URL" value={`${origin}/api/v1`} />
          </section>
          <section className="card card-pad stack" style={{ marginTop: 16 }}>
            <h2 style={{ margin: 0 }}>Try it</h2>
            <pre className="code">{`curl ${origin}/api/v1/payments \\
  -H "Authorization: Bearer $FUNGUO_SECRET_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{ "option": "pal_lock", "amount": 25, "description": "Test hold" }'`}</pre>
            <p className="fine" style={{ margin: 0 }}>Set <code>FUNGUO_SECRET_KEY</code> to the secret key above. Then open the <code>approval_url</code> from the response and approve with a sandbox buyer. See the <Link to="/developer/docs#create">API reference</Link>.</p>
          </section>
        </>
      )}

      {tab === 'webhooks' && (
        <>
          <section className="card card-pad stack">
            <h2 style={{ margin: 0 }}>Webhook endpoint</h2>
            <form className="stack" onSubmit={(e) => { e.preventDefault(); run(() => api(path, { method: 'PATCH', json: formData(e.target) }), 'Webhook saved'); }}>
              <label className="lbl">URL<input name="webhook_url" className="field" defaultValue={app.webhook_url || ''} key={app.webhook_url} placeholder="https://example.com/hooks/funguo" /></label>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button className="btn btn-primary" type="submit">Save</button>
                <button className="btn btn-line" type="button" disabled={!app.webhook_url} onClick={async () => {
                  try { setHookResult(await api(`${path}/webhook-test`, { json: {} })); await reload(); } catch (err) { toast(err.message); }
                }}>Send test event</button>
              </div>
            </form>
            {hookResult && (hookResult.delivered
              ? <div className="callout callout-ok">Delivered. Your endpoint answered HTTP {hookResult.status}.</div>
              : <div className="callout callout-bad">Not delivered{hookResult.status ? `: HTTP ${hookResult.status}` : hookResult.error ? `: ${hookResult.error}` : ''}.</div>)}
          </section>
          <section className="card card-pad stack" style={{ marginTop: 16 }}>
            <h2 style={{ margin: 0 }}>Signing secret</h2>
            <CopyField label="Webhook signing secret" value={app.webhook_secret} secret />
            <p className="fine" style={{ margin: 0 }}>Verify the <code>Funguo-Signature</code> header with it. <Link to="/developer/docs#signatures">How to verify</Link>.{' '}
              <ArmedButton as="link" label="Roll signing secret" armedLabel="Click again to roll. The old secret stops working." onConfirm={() => run(() => api(`${path}/rotate`, { json: { which: 'webhook' } }), 'New signing secret created')} />
            </p>
          </section>
        </>
      )}

      {tab === 'payments' && (
        <section className="card">
          {payments.length ? (
            <div style={{ overflowX: 'auto' }}>
              <table className="data">
                <thead><tr><th>Payment</th><th>Option</th><th>State</th><th>Amount</th><th>Created</th></tr></thead>
                <tbody>
                  {payments.map((p) => (
                    <tr key={p.id}>
                      <td><Link to={`/o/${p.id}`}><code>{p.id}</code></Link><div className="meta">{p.description || ''}{p.reference ? ` · ${p.reference}` : ''}</div></td>
                      <td>{p.option === 'checkout' ? 'Checkout' : 'Pal-Lock'}</td>
                      <td><Badge state={p.state} /></td>
                      <td className="price">{money(p.captured_amount ?? p.amount, p.currency)}</td>
                      <td className="meta">{when(p.created_at)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <p className="empty">No payments yet. Create one with the secret key on the Credentials tab.</p>}
        </section>
      )}

      {tab === 'events' && (
        <section className="card">
          {events.length ? events.map((e) => (
            <details key={e.id} className="row-link" style={{ display: 'block' }}>
              <summary style={{ display: 'flex', justifyContent: 'space-between', gap: 12, cursor: 'pointer', listStyle: 'none' }}>
                <span><code>{e.type}</code> <span className="meta">{e.order_id || ''}</span></span>
                <span>{e.delivered ? <span className="badge b-emerald">delivered</span> : <span className="badge b-rose">not delivered</span>} <span className="meta">{when(e.created_at)}</span></span>
              </summary>
              <Json value={e.payload} />
            </details>
          )) : <p className="empty">No events yet. Events appear when a payment changes state, or when you send a test event.</p>}
        </section>
      )}

      {tab === 'settings' && (
        <>
          <section className="card card-pad stack">
            <h2 style={{ margin: 0 }}>App name</h2>
            <form className="cred" onSubmit={(e) => { e.preventDefault(); run(() => api(path, { method: 'PATCH', json: formData(e.target) }), 'Saved'); }}>
              <input name="name" className="field" required defaultValue={app.name} key={app.name} />
              <button className="btn btn-primary" type="submit">Save</button>
            </form>
          </section>
          <section className="card card-pad stack danger-zone" style={{ marginTop: 16 }}>
            <h2 style={{ margin: 0 }}>Delete app</h2>
            <p className="meta" style={{ margin: 0 }}>The secret key stops working immediately. Payments already made stay on record for the audit trail.</p>
            <div>
              <ArmedButton className="btn btn-line" label="Delete this app" armedLabel="Click again to delete" onConfirm={async () => {
                try { await api(path, { method: 'DELETE' }); navigate('/developer/dashboard'); } catch (err) { toast(err.message); }
              }} />
            </div>
          </section>
        </>
      )}
    </>
  );
}

export default function DeveloperDashboard() {
  const { id } = useParams();
  useTitle('Apps & Credentials');
  return <main id="main" className="dev-page">{id ? <AppDetail id={id} /> : <AppList />}</main>;
}
