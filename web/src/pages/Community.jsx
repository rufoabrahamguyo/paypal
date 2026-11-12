import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { api, formData } from '../lib/api.js';
import { when } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { useSession } from '../lib/session.jsx';
import { useToast } from '../lib/toast.jsx';
import { ErrorNote, Loading, PlatformFields } from '../components/ui.jsx';

function ReportCard({ report: r }) {
  return (
    <article className="report">
      <div className="flag-top"><b>{r.reason_label}</b><span className="meta">{when(r.created_at)} · a Funguo member</span></div>
      <p>{r.body}</p>
    </article>
  );
}

function AccountCard({ account: a, open, kinds, user, loginNext, onChange }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [comment, setComment] = useState('');
  const count = a.count ?? a.reports;
  const n = typeof count === 'number' ? count : (a.reports?.length || 0);
  const reports = Array.isArray(a.reports) ? a.reports : [];
  const reactions = a.reactions || { like: 0, same: 0, doubt: 0, mine: null };
  const comments = a.comments || [];
  const commentCount = a.comment_count ?? comments.length;

  async function react(kind) {
    if (!user) return toast('Sign in to react');
    setBusy(true);
    try {
      const data = await api('/api/community/reactions', { json: { platform: a.platform, handle: a.handle, kind } });
      onChange(data.account);
    } catch (err) { toast(err.message); }
    setBusy(false);
  }

  async function sendComment(e) {
    e.preventDefault();
    if (!user) return toast('Sign in to comment');
    setBusy(true);
    try {
      const data = await api('/api/community/comments', { json: { platform: a.platform, handle: a.handle, body: comment } });
      setComment('');
      onChange(data.account);
    } catch (err) { toast(err.message); }
    setBusy(false);
  }

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
      <div className="reacts" role="group" aria-label="Reactions">
        {(kinds || []).map((k) => (
          <button key={k.id} type="button" aria-pressed={reactions.mine === k.id} disabled={busy} onClick={() => react(k.id)}>
            {k.label} <b>{reactions[k.id] || 0}</b>
          </button>
        ))}
      </div>
      {commentCount > 0 && !comments.length && (
        <Link to={`/community?platform=${encodeURIComponent(a.platform)}&handle=${encodeURIComponent(a.handle)}`}>
          {commentCount} comment{commentCount === 1 ? '' : 's'}
        </Link>
      )}
      {!!comments.length && (
        <div className="flag-list">
          {comments.map((c) => (
            <article key={c.id} className="comment">
              <div className="flag-top"><b>{c.author_name}</b><span className="meta">{when(c.created_at)}</span></div>
              <p>{c.body}</p>
            </article>
          ))}
        </div>
      )}
      {user ? (
        <form className="comment-form" onSubmit={sendComment}>
          <label className="lbl">Comment
            <textarea className="field" rows={2} maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Add what you know about this account" />
          </label>
          <button className="btn btn-line" type="submit" disabled={busy || comment.trim().length < 2}>Post comment</button>
        </form>
      ) : (
        <Link to={`/login?next=${encodeURIComponent(loginNext)}`}>Sign in to comment or react</Link>
      )}
    </article>
  );
}

function ReportForm({ reasons, checked }) {
  const toast = useToast();
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const customChecked = String(checked?.platform || '').startsWith('other:');
  const [platform, setPlatform] = useState(customChecked ? 'other' : (checked?.platform || 'tiktok'));
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
      <PlatformFields
        platform={platform}
        onPlatform={setPlatform}
        handleDefault={checked?.handle || ''}
        handleKey={checked?.handle}
        nameDefault={customChecked ? (checked?.label || '') : ''}
        nameKey={checked?.label}
      />
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
  const { data, error, reload } = useLoad(() => {
    const q = new URLSearchParams();
    for (const k of ['platform', 'handle', 'q']) if (params.get(k)) q.set(k, params.get(k));
    return api(`/api/community${q.size ? `?${q}` : ''}`);
  }, [search]);

  const checked = data?.checked;
  const list = (data?.accounts || []).filter((a) => !(checked?.platform && a.platform === checked.platform && a.handle === checked.handle));
  const loginNext = pathname + search;
  let result = null;
  if (checked?.platform) {
    result = <section className="stack section-gap"><h2 className="section-title">This account</h2><AccountCard account={checked} open kinds={data.reaction_kinds} user={user} loginNext={loginNext} onChange={reload} /></section>;
  } else if (checked?.handle) {
    const matches = checked.matches || [];
    result = (
      <section className="stack section-gap">
        <h2 className="section-title">@{checked.handle}</h2>
        {matches.length
          ? matches.map((a) => <AccountCard key={`${a.platform}-${a.handle}`} account={{ ...a, count: a.reports }} kinds={data.reaction_kinds} user={user} loginNext={loginNext} onChange={reload} />)
          : <div className="card"><p className="empty">No reports for that username. Pick the app it uses and you can file one.</p></div>}
      </section>
    );
  }

  return (
    <main id="main" className="page">
      <p className="eyebrow">Community</p>
      <h1 className="page-title">Check a shop before you pay</h1>
      <p className="page-lead">Look up an account on TikTok, Instagram, Facebook, X, YouTube, or another app. Members report shops that took the money, sent the wrong item, or pushed payment off Funguo. A report is one person’s account of what happened.</p>
      <ErrorNote error={error} />
      {!data ? <Loading>Loading the list…</Loading> : (
        <>
          <form className="card card-pad stack" data-tour="lookup" onSubmit={(e) => {
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
            {user ? <ReportForm key={`${checked?.platform || ''}-${checked?.handle || ''}`} reasons={data.reasons || []} checked={checked} /> : (
              <section className="card card-pad stack">
                <h2>Report an account</h2>
                <p className="meta" style={{ margin: 0 }}>Sign in to post what a shop did. Your name is not shown on the report.</p>
                <Link className="btn btn-primary" to={`/login?next=${encodeURIComponent(pathname + search)}`}>Sign in to report</Link>
              </section>
            )}
            <section className="stack">
              <h2 className="section-title">Accounts with reports</h2>
              {list.length
                ? <div className="flag-list">{list.map((a) => <AccountCard key={`${a.platform}-${a.handle}`} account={a} kinds={data.reaction_kinds} user={user} loginNext={loginNext} onChange={reload} />)}</div>
                : <div className="card"><p className="empty">No accounts have been reported yet.</p></div>}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
