import { Link } from 'react-router-dom';
import { STATE_STYLE, money, stateLabel, when } from '../lib/format.js';

export function Mark() {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#0c1829" />
      <circle cx="12.5" cy="15" r="4.1" fill="none" stroke="#d4af37" strokeWidth="1.8" />
      <path d="M16.2 15H24.2M20.6 15v3.1M24.2 15v2.2" fill="none" stroke="#d4af37" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

export function Brand({ to, sub = 'Escrow on PayPal' }) {
  return (
    <Link to={to} className="brand">
      <span className="brand-mark"><Mark /></span>
      <span>
        <span className="brand-name">Funguo</span>
        <span className="brand-sub">{sub}</span>
      </span>
    </Link>
  );
}

const ICON = {
  home: <path d="M3 10.5 12 4l9 6.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z" />,
  orders: <><path d="M8 6h12M8 12h12M8 18h12" /><circle cx="4" cy="6" r="1" /><circle cx="4" cy="12" r="1" /><circle cx="4" cy="18" r="1" /></>,
  market: <><path d="M5 8h14l-1 12H6z" /><path d="M9 8a3 3 0 0 1 6 0" /></>,
  tag: <><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></>,
  shield: <><path d="M12 3 4 6v6c0 5 3.5 8 8 9 4.5-1 8-4 8-9V6z" /><path d="m9 12 2 2 4-4" /></>,
  users: <><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18 14.5a6.5 6.5 0 0 1 3.5 5.5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" /><circle cx="12" cy="17.5" r=".6" /></>,
  audit: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>,
  code: <path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14" />,
  logout: <path d="M15 4h4a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" />,
  menu: <path d="M4 7h16M4 12h16M4 17h16" />,
  search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>,
};

export function Icon({ name }) {
  return (
    <svg className="ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {ICON[name]}
    </svg>
  );
}

export function SimBar() {
  return <div className="sim-bar" role="status">Simulate mode. PayPal calls stay inside this app until sandbox credentials are set.</div>;
}

export function Badge({ state }) {
  return <span className={`badge ${STATE_STYLE[state] || 'b-slate'}`} title={state}>{stateLabel(state)}</span>;
}

const TICKET_STYLE = { open: 'b-amber', in_review: 'b-sky', resolved: 'b-emerald' };
export function TicketBadge({ status }) {
  return <span className={`badge ${TICKET_STYLE[status] || 'b-slate'}`}>{String(status || '').replaceAll('_', ' ')}</span>;
}

const RISK_STYLE = { low: 'b-emerald', medium: 'b-amber', high: 'b-rose' };
export function RiskBadge({ verification: v }) {
  return v ? <span className={`risk ${RISK_STYLE[v.risk] || ''}`}>{v.risk} risk</span> : null;
}

export function StarText({ n }) {
  return <span className="stars" aria-label={`${n} out of 5`}>{'★'.repeat(n)}{'☆'.repeat(5 - n)}</span>;
}

// ★★★★☆ 4.2 (12 reviews)
export function Stars({ rating, count }) {
  if (!count) return <span className="meta">No ratings yet</span>;
  const full = Math.round(rating);
  return (
    <span className="stars" title={`${rating} out of 5`}>
      <span aria-hidden="true">{'★'.repeat(full)}{'☆'.repeat(5 - full)}</span> <b>{rating.toFixed(1)}</b>{' '}
      <span className="meta">({count} review{count === 1 ? '' : 's'})</span>
    </span>
  );
}

export const Json = ({ value }) => <pre className="json">{JSON.stringify(value, null, 2)}</pre>;

export function Loading({ children = 'Loading…' }) {
  return <p className="meta" style={{ marginTop: 18 }}>{children}</p>;
}

export function ErrorNote({ error }) {
  return error ? <p className="callout callout-bad">{error.message}</p> : null;
}

export function SocialLinks({ seller }) {
  const links = seller?.socials || [];
  if (!links.length) return null;
  return (
    <div className="social-links">
      {links.map((a) => (
        <a key={a.id || a.handle} className="social-link" href={a.profile_url} target="_blank" rel="noopener noreferrer">{a.label} · @{a.handle}</a>
      ))}
    </div>
  );
}

export function CommunityFlags({ seller }) {
  return (seller?.socials || []).filter((a) => a.reports > 0).map((a) => (
    <Link key={a.handle} className="callout callout-bad" to={`/community?platform=${encodeURIComponent(a.platform)}&handle=${encodeURIComponent(a.handle)}`}>
      {a.label} @{a.handle} has {a.reports} community report{a.reports === 1 ? '' : 's'}. Read them before you pay.
    </Link>
  ));
}

export function OrderRow({ order: o, hint = '' }) {
  const who = o.seller_name && o.buyer_name ? `${o.seller_name} · ${o.buyer_name}` : (o.seller_name || o.buyer_name || '');
  return (
    <Link className="row-link" to={`/o/${o.id}`}>
      <span><b>{o.listing_title || 'Order'}</b><span className="meta">{who}{hint ? ` · ${hint}` : ''}</span></span>
      <span className="price">{money(o.amount, o.currency)}</span>
      <span><Badge state={o.state} /></span>
      <span className="meta">{when(o.updated_at)}</span>
    </Link>
  );
}

export function TicketRow({ ticket: t }) {
  return (
    <Link className="row-link cols-3" to={`/support/${t.id}`}>
      <span><b>{t.subject}</b><span className="meta">{t.topic}{t.order_id ? ` · ${t.order_id}` : ''}</span></span>
      <span><TicketBadge status={t.status} /></span>
      <span className="meta">{when(t.updated_at)}</span>
    </Link>
  );
}

export const Empty = ({ children }) => <p className="empty">{children}</p>;
