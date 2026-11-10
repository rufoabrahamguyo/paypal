import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { initials } from '../lib/format.js';
import { useLoad, useTitle } from '../lib/hooks.js';
import { ErrorNote, Stars } from '../components/ui.jsx';

function SellerRow({ seller: s }) {
  return (
    <Link className="seller-row" to={`/s/${s.id}`}>
      {s.photo_url ? <img className="avatar-sm" alt="" src={s.photo_url} /> : <span className="avatar-sm" aria-hidden="true">{initials(s.name)}</span>}
      <span>
        <b>{s.name}</b> {s.verified ? <span className="ok">ID verified</span> : <span className="warn">not verified</span>}
        <span className="meta" style={{ display: 'block' }}>
          {s.total_orders} orders · {s.total_disputes} disputes
          {s.socials.length ? ` · ${s.socials.map((a) => `${a.label} @${a.handle}`).join(', ')}` : ''}
        </span>
      </span>
      <span><Stars rating={s.rating} count={s.review_count} /></span>
    </Link>
  );
}

export default function Sellers() {
  useTitle('Find a seller');
  const [params, setParams] = useSearchParams();
  const q = params.get('q') || '';
  const { data: list, error } = useLoad(() => api(`/api/sellers${q ? `?q=${encodeURIComponent(q)}` : ''}`), [q]);

  return (
    <main id="main" className="page">
      <h1 className="page-title">Find a seller</h1>
      <p className="page-lead">Search by shop name or by their TikTok, Instagram or other handle. Open a shop to read its ratings and reviews before you pay.</p>
      <form className="cred" style={{ margin: '18px 0' }} role="search" onSubmit={(e) => {
        e.preventDefault();
        const value = e.target.q.value.trim();
        setParams(value ? { q: value } : {});
      }}>
        <input name="q" className="field" defaultValue={q} key={q} placeholder="Shop name or @handle" aria-label="Search sellers" />
        <button className="btn btn-primary" type="submit">Search</button>
      </form>
      <ErrorNote error={error} />
      <div className="card">
        {!list ? <p className="empty">Loading…</p>
          : list.length ? list.map((s) => <SellerRow key={s.id} seller={s} />)
            : <p className="empty">No shop matches “{q}”. Check the spelling, or <Link to="/community">look the account up on the community list</Link>.</p>}
      </div>
    </main>
  );
}
