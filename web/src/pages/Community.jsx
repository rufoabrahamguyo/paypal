import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote, Loading } from '../components/ui.jsx';

function ReportCard({ report: r }) {
  return (
    <article className="report">
      <div className="flag-top"><b>{r.reason_label}</b><span className="meta">{when(r.created_at)} · a Funguo member</span></div>
      <p>{r.body}</p>
    </article>
  );
}

function AccountCard({ account: a, open }) {
  const count = a.count ?? a.reports;
  const n = typeof count === 'number' ? count : (a.reports?.length || 0);
  const reports = Array.isArray(a.reports) ? a.reports : [];
  return (
    <article className="card card-pad stack">
      <div className="flag-top">
        <h2 style={{ margin: 0 }}>{a.label || 'Account'} · @{a.handle}</h2>
        <span className={n ? 'warn' : 'ok'}>{n ? `${n} report${n === 1 ? '' : 's'}` : 'No reports'}</span>
      </div>
      {a.profile_url && <a className="social-link" href={a.profile_url} target="_blank" rel="noopener noreferrer">{a.profile_url}</a>}
      {reports.length
        ? <div className="flag-list">{reports.map((r, i) => <ReportCard key={r.id || i} report={r} />)}</div>
        : !n && <p className="meta" style={{ margin: 0 }}>Nobody has reported this account yet. That is not a promise the shop is safe.</p>}
      {!open && <Link to={`/community?platform=${encodeURIComponent(a.platform)}&handle=${encodeURIComponent(a.handle)}`}>Open the reports</Link>}
    </article>
  );
}

function ReportForm({ reasons, checked }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  return (
    <form className="card card-pad stack" onSubmit={async (e) => {
      e.preventDefault();
      setBusy(true);
      try {
        const data = await api('/api/community', { json: formData(e.target) });
        toast('Report posted', 'info');
        e.target.reset();
        navigate(`/community?platform=${encodeURIComponent(data.account.platform)}&handle=${encodeURIComponent(data.account.handle)}`);
      } catch (err) { toast(err.message); }
      setBusy(false);
    }}>
      <h2>Report an account</h2>
      <p className="meta" style={{ margin: 0 }}>Say what the shop did. Leave out phone numbers, home addresses, and photos of their ID.</p>
      <div className="pair">
        <label className="lbl">App
          <select name="platform" className="field" required defaultValue={checked?.platform || 'tiktok'} key={checked?.platform}>
            <option value="tiktok">TikTok</option>
            <option value="instagram">Instagram</option>
            <option value="facebook">Facebook</option>
            <option value="x">X</option>
            <option value="youtube">YouTube</option>
          </select>
        </label>
        <label className="lbl">Username
          <input name="handle" required className="field" placeholder="@shop or profile link" defaultValue={checked?.handle || ''} key={checked?.handle} />
        </label>
      </div>
      <label className="lbl">What happened
        <select name="reason" className="field" required>
          {reasons.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
        </select>
      </label>
      <label className="lbl">What they did
        <textarea name="body" required rows={4} className="field" placeholder="They asked for payment on WhatsApp, then stopped answering." />
      </label>
      <button className="btn btn-primary" type="submit" disabled={busy}>Post report</button>
    </form>
  );
}

export default function Community() {
  useTitle('Community');
  const { user } = useSession();
  const toast = useToast();
  const { pathname, search } = useLocation();
  const [params, setParams] = useSearchParams();
  const { data, error } = useLoad(() => {
    const q = new URLSearchParams();
    for (const k of ['platform', 'handle', 'q']) if (params.get(k)) q.set(k, params.get(k));
    return api(`/api/community${q.size ? `?${q}` : ''}`);
  }, [search]);

  const checked = data?.checked;
  const list = data?.accounts || [];
  let result = null;
  if (checked?.platform) {
    result = <section className="stack section-gap"><h2 className="section-title">This account</h2><AccountCard account={checked} open /></section>;
  } else if (checked?.handle) {
    const matches = checked.matches || [];
    result = (
      <section className="stack section-gap">
        <h2 className="section-title">@{checked.handle}</h2>
        {matches.length
          ? matches.map((a) => <AccountCard key={`${a.platform}-${a.handle}`} account={{ ...a, count: a.reports }} />)
          : <div className="card"><p className="empty">No reports for that username. Pick the app it uses and you can file one.</p></div>}
      </section>
    );
  }

  return (
    <main id="main" className="page">
      <p className="eyebrow">Community</p>
      <h1 className="page-title">Check a shop before you pay</h1>
      <p className="page-lead">Look up a TikTok, Instagram, Facebook, X, or YouTube account. Members report shops that took the money, sent the wrong item, or pushed payment off Funguo. A report is one person’s account of what happened.</p>
      <ErrorNote error={error} />
      {!data ? <Loading>Loading the list…</Loading> : (
        <>
          <form className="card card-pad stack" onSubmit={(e) => {
            e.preventDefault();
            const q = e.target.q.value.trim();
            if (!q) return toast('Enter a username or a profile link');
            setParams({ q });
          }}>
            <label className="lbl">Username or profile link
              <input name="q" className="field" placeholder="@shopname or https://www.tiktok.com/@shopname" defaultValue={params.get('q') || ''} />
            </label>
            <button className="btn btn-navy" type="submit">Check this account</button>
          </form>
          {result}
          <div className="dash-grid section-gap">
            {user ? <ReportForm reasons={data.reasons || []} checked={checked} /> : (
              <section className="card card-pad stack">
                <h2>Report an account</h2>
                <p className="meta" style={{ margin: 0 }}>Sign in to post what a shop did. Your name is not shown on the report.</p>
                <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(pathname + search)}`}>Sign in to report</Link>
              </section>
            )}
            <section className="stack">
              <h2 className="section-title">Accounts with reports</h2>
              {list.length
                ? <div className="flag-list">{list.map((a) => <AccountCard key={`${a.platform}-${a.handle}`} account={a} />)}</div>
                : <div className="card"><p className="empty">No accounts have been reported yet.</p></div>}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
