import { useEffect, useState } from 'react';
import { Link, Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '../lib/session.jsx';
import { dashPath, initials } from '../lib/format.js';
import { Brand, Icon, SimBar } from './ui.jsx';
import Tour, { requestTour } from './Tour.jsx';

// Sidebar items per role. `match` decides which item is current for a path.
function sideNav(user, path) {
  const exact = (p) => path === p;
  const prefix = (...ps) => ps.some((p) => path === p || path.startsWith(`${p}/`));
  const orders = (base) => path === `${base}/orders` || path.startsWith('/o/');
  const community = { to: '/community', label: 'Community', icon: 'users', on: prefix('/community') };
  const support = { to: '/support', label: 'Support', icon: 'help', on: prefix('/support') };
  // API keys, docs, and the sample call. Same place for every signed-in role.
  const developers = { to: '/developer', label: 'Developers', icon: 'code', on: prefix('/developer') };
  if (user.role === 'seller') {
    return [
      { to: '/seller', label: 'Overview', icon: 'home', on: exact('/seller') },
      { to: '/seller/orders', label: 'Orders', icon: 'orders', on: orders('/seller') },
      { to: '/seller/listings', label: 'Listings', icon: 'tag', on: path === '/seller/listings' || path.startsWith('/l/') },
      { to: '/seller/verification', label: 'Verification', icon: 'shield', on: exact('/seller/verification') },
      support,
      developers,
    ];
  }
  if (user.role === 'admin') {
    return [
      { to: '/admin', label: 'Audit trail', icon: 'audit', on: prefix('/admin', '/o') },
      { to: '/market', label: 'Market', icon: 'market', on: prefix('/market', '/l') },
      community,
      support,
      developers,
    ];
  }
  return [
    { to: '/buyer', label: 'Overview', icon: 'home', on: exact('/buyer') },
    { to: '/buyer/orders', label: 'Orders', icon: 'orders', on: orders('/buyer') },
    { to: '/sellers', label: 'Find sellers', icon: 'search', on: prefix('/sellers', '/s') },
    community,
    support,
    developers,
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
        <button type="button" className="mbar-btn" data-tour="menu" onClick={() => setOpen(true)} aria-label="Open menu" aria-controls="side" aria-expanded={open}><Icon name="menu" /></button>
        <Brand to={dashPath(user.role)} />
      </div>
      <aside className="side" id="side" aria-label="Dashboard">
        <div className="side-brand"><Brand to={dashPath(user.role)} sub={role} /></div>
        <nav className="side-nav" aria-label="Primary" data-tour="sidebar">
          {sideNav(user, pathname).map((n) => (
            <Link key={n.to} to={n.to} className="side-link" data-tour={n.to === '/community' ? 'nav-community' : undefined} aria-current={n.on ? 'page' : undefined}><Icon name={n.icon} /><span>{n.label}</span></Link>
          ))}
        </nav>
        <div className="side-foot">
          <button type="button" className="side-tour" data-tour="tour-launch" onClick={requestTour}>Take a tour</button>
          <div className="side-user">
            <span className="side-avatar" aria-hidden="true">{initials(user.name || user.email)}</span>
            <span className="side-who"><b>{user.name}</b><span>{user.email}</span></span>
            <button type="button" className="side-out" onClick={logout} aria-label="Log out" title="Log out"><Icon name="logout" /></button>
          </div>
        </div>
      </aside>
      {open && <div className="side-scrim" onClick={() => setOpen(false)} />}
      {sim && <SimBar />}
      {pathname.startsWith('/developer') && <DevSubnav pathname={pathname} />}
      <Outlet />
    </>
  );
}

// The same destinations on every public page. The current one is marked.
const PRIMARY = [
  { to: '/market', label: 'Market', on: (p) => p === '/market' || p.startsWith('/l/') || p.startsWith('/checkout') },
  { to: '/community', label: 'Community', on: (p) => p.startsWith('/community') },
  { to: '/developer', label: 'Developers', on: (p) => p.startsWith('/developer') },
];

function accountHref(path, pathname, search) {
  if (pathname === '/login' || pathname === '/signup') return `${path}${search}`;
  if (pathname === '/') return path;
  return `${path}?next=${encodeURIComponent(pathname + search)}`;
}

function TopBar() {
  const { pathname, search } = useLocation();
  return (
    <header className="topbar">
      <div className="topbar-inner">
        <Brand to="/" label="Funguo, home" />
        <nav className="topnav" id="site-nav" aria-label="Primary" data-tour="nav">
          {PRIMARY.map((item) => (
            <Link key={item.to} to={item.to} data-tour={item.to === '/community' ? 'nav-community' : undefined} aria-current={item.on(pathname) ? 'page' : undefined}>{item.label}</Link>
          ))}
          <Link to={accountHref('/login', pathname, search)} aria-current={pathname === '/login' ? 'page' : undefined}>Sign in</Link>
          <Link to={accountHref('/signup', pathname, search)} className="topnav-cta" aria-current={pathname === '/signup' ? 'page' : undefined}>Create account</Link>
          <button type="button" className="tour-launch" onClick={requestTour}>Tour</button>
        </nav>
      </div>
      {pathname.startsWith('/developer') && <DevSubnav pathname={pathname} />}
    </header>
  );
}

function DevSubnav({ pathname }) {
  const items = [
    ['/developer', 'Overview', pathname === '/developer'],
    ['/developer/docs', 'Docs', pathname.startsWith('/developer/docs')],
    ['/developer/dashboard', 'Apps & credentials', pathname.startsWith('/developer/dashboard') || pathname.startsWith('/developer/apps')],
    ['/shop', 'Sample shop', false],
  ];
  return (
    <nav className="site-subnav" aria-label="Developer" data-tour="devnav">
      {items.map(([to, label, on]) => (
        <Link key={to} to={to} aria-current={on ? 'page' : undefined}>{label}</Link>
      ))}
    </nav>
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

export default function Layout() {
  const { user, health, ready, logout } = useSession();
  const { pathname } = useLocation();
  if (!ready) return null;
  const sim = health?.paypal_mode === 'simulate';
  const skip = <a className="skip" href="#main">Skip to content</a>;
  const tour = <Tour user={user} />;
  if (pathname === '/login' || pathname === '/signup') {
    return <>{skip}{sim && <SimBar />}<TopBar /><Outlet />{tour}</>;
  }
  if (user && pathname === '/seller/onboarding') {
    return <>{skip}{sim && <SimBar />}<FocusBar logout={logout} /><Outlet />{tour}</>;
  }
  if (user) return <>{skip}<Shell user={user} sim={sim} logout={logout} />{tour}</>;
  return <>{skip}{sim && <SimBar />}<TopBar /><Outlet />{tour}</>;
}

// ---- route guards (the server enforces the same rules on full page loads) ----
export function RequireUser({ role, children }) {
  const { user } = useSession();
  const { pathname, search } = useLocation();
  if (!user) return <Navigate to={`/login?next=${encodeURIComponent(pathname + search)}`} replace />;
  if (role && user.role !== role) return <Navigate to={dashPath(user.role)} replace />;
  return children;
}
