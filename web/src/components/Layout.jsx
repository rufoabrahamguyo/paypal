import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session.jsx';
import { dashPath, initials } from '../lib/format.js';
import { Brand, Icon, SimBar } from './ui.jsx';

// Sidebar items per role. `match` decides which item is current for a path.
function sideNav(user, path) {
  const exact = (p) => path === p;
  const prefix = (...ps) => ps.some((p) => path === p || path.startsWith(`${p}/`));
  const orders = (base) => path === `${base}/orders` || path.startsWith('/o/');
  const community = { to: '/community', label: 'Community', icon: 'users', on: prefix('/community') };
  const support = { to: '/support', label: 'Support', icon: 'help', on: prefix('/support') };
  if (user.role === 'seller') {
    return [
      { to: '/seller', label: 'Overview', icon: 'home', on: exact('/seller') },
      { to: '/seller/orders', label: 'Orders', icon: 'orders', on: orders('/seller') },
      { to: '/seller/listings', label: 'Listings', icon: 'tag', on: path === '/seller/listings' || path.startsWith('/l/') },
      { to: '/seller/verification', label: 'Verification', icon: 'shield', on: exact('/seller/verification') },
      community,
      support,
    ];
  }
  if (user.role === 'admin') {
    return [
      { to: '/admin', label: 'Audit trail', icon: 'audit', on: prefix('/admin', '/o') },
      { to: '/market', label: 'Market', icon: 'market', on: prefix('/market', '/l') },
      community,
      support,
    ];
  }
  return [
    { to: '/buyer', label: 'Overview', icon: 'home', on: exact('/buyer') },
    { to: '/buyer/orders', label: 'Orders', icon: 'orders', on: orders('/buyer') },
    { to: '/sellers', label: 'Find sellers', icon: 'search', on: prefix('/sellers', '/s') },
    { to: '/market', label: 'Market', icon: 'market', on: prefix('/market', '/l', '/i', '/checkout') },
    community,
    support,
  ];
}

function Shell({ user, sim, logout }) {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const role = user.role === 'admin' ? 'Audit desk' : user.role === 'seller' ? 'Seller' : 'Buyer';

  useEffect(() => {
    document.body.classList.add('has-side');
    return () => document.body.classList.remove('has-side', 'side-open');
  }, []);
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    document.body.classList.toggle('side-open', open);
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <>
      <div className="mbar">
        <button type="button" className="mbar-btn" onClick={() => setOpen(true)} aria-label="Open menu" aria-controls="side" aria-expanded={open}><Icon name="menu" /></button>
        <Brand to={dashPath(user.role)} />
      </div>
      <aside className="side" id="side" aria-label="Dashboard">
        <div className="side-brand"><Brand to={dashPath(user.role)} sub={role} /></div>
        <nav className="side-nav" aria-label="Primary">
          {sideNav(user, pathname).map((n) => (
            <Link key={n.to} to={n.to} className="side-link" aria-current={n.on ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label}</span></Link>
          ))}
        </nav>
        <div className="side-foot">
          <Link to="/developer/dashboard" className="side-link"><Icon name="code" /><span>Developer</span></Link>
          <div className="side-user">
            <span className="side-avatar" aria-hidden="true">{initials(user.name || user.email)}</span>
            <span className="side-who"><b>{user.name}</b><span>{user.email}</span></span>
            <button type="button" className="side-out" onClick={logout} aria-label="Log out" title="Log out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      {sim && <SimBar />}
      <Outlet />
    </>
  );
}

// Marketing header: the full menu on the landing page, just the way in everywhere else.
function TopBar() {
  const { pathname, search } = useLocation();
  const here = encodeURIComponent(pathname + search);
  let links;
  if (pathname === '/') {
    links = (
      <>
        <Link to="/market">Market</Link>
        <Link to="/community">Community</Link>
        <Link to="/developer">Developers</Link>
        <Link to="/login">Sign in</Link>
        <Link to="/signup" className="topnav-cta">Create account</Link>
      </>
    );
  } else if (pathname === '/login') {
    links = <Link to={`/signup${search}`}>Create account</Link>;
  } else if (pathname === '/signup') {
    links = <Link to={`/login${search}`}>Sign in</Link>;
  } else {
    links = (
      <>
        <Link to={`/login?next=${here}`}>Sign in</Link>
        <Link to={`/signup?next=${here}`} className="topnav-cta">Create account</Link>
      </>
    );
  }
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand to="/" />
        <nav className="topnav" aria-label="Primary">{links}</nav>
      </div>
    </header>
  );
}

// Onboarding is a focused step: no dashboard links until it is done.
function FocusBar({ logout }) {
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand to="/seller/onboarding" sub="Seller verification" />
        <div className="dev-right"><button type="button" className="btn btn-line" onClick={logout}>Log out</button></div>
      </div>
    </header>
  );
}

function DevBar({ user, logout }) {
  const { pathname } = useLocation();
  const link = (to, label, on) => <Link to={to} aria-current={on ? 'page' : undefined}>{label}</Link>;
  return (
    <header className="topbar devbar">
      <div className="topbar-inner">
        <Brand to="/developer" sub="Developer" />
        <nav className="topnav" aria-label="Developer">
          {link('/developer', 'Overview', pathname === '/developer')}
          {link('/developer/docs', 'Docs', pathname.startsWith('/developer/docs'))}
          {link('/developer/dashboard', 'Apps & Credentials', pathname.startsWith('/developer/dashboard') || pathname.startsWith('/developer/apps'))}
          {link('/shop', 'Sample shop', false)}
        </nav>
        <div className="dev-right">
          {user ? (
            <>
              <Link to={dashPath(user.role)} className="dev-back">Funguo dashboard</Link>
              <button type="button" className="btn btn-line" onClick={logout}>Log out</button>
            </>
          ) : (
            <>
              <Link to="/login?next=%2Fdeveloper%2Fdashboard" className="dev-back">Log in</Link>
              <Link to="/signup?next=%2Fdeveloper%2Fdashboard" className="btn btn-gold">Sign up</Link>
            </>
          )}
        </div>
      </div>
    </header>
  );
}

export default function Layout() {
  const { user, health, ready, logout } = useSession();
  const { pathname } = useLocation();
  if (!ready) return null;
  const sim = health?.paypal_mode === 'simulate';
  const skip = <a className="skip" href="#main">Skip to content</a>;
  if (pathname.startsWith('/developer')) {
    return <>{skip}{sim && <SimBar />}<DevBar user={user} logout={logout} /><Outlet /></>;
  }
  if (user && pathname === '/seller/onboarding') {
    return <>{skip}{sim && <SimBar />}<FocusBar logout={logout} /><Outlet /></>;
  }
  if (user) return <>{skip}<Shell user={user} sim={sim} logout={logout} /></>;
  return <>{skip}{sim && <SimBar />}<TopBar /><Outlet /></>;
}

// ---- route guards (the server enforces the same rules on full page loads) ----
export function RequireUser({ role, children }) {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (role && user.role !== role) return <Navigate to={dashPath(user.role)} replace />;
  return children;
}
