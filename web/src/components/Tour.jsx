import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';

const DONE = 'funguo.tour.done';

let opener = null;
export function requestTour() { opener?.(); }

function readDone() {
  try { return localStorage.getItem(DONE) === '1'; } catch { return false; }
}
function writeDone() {
  try { localStorage.setItem(DONE, '1'); } catch { /* private mode */ }
}

// A focused task (sign-in, a payment, the sample shop) is not a place to start a tour.
function isQuiet(pathname) {
  return /^\/(login|signup|shop|checkout|seller\/onboarding)(\/|$)/.test(pathname)
    || /^\/(o|i|l)\//.test(pathname);
}

function buildSteps(pathname, user) {
  const narrow = window.matchMedia('(max-width: 900px)').matches;
  if (user) {
    const seller = user.role === 'seller';
    const steps = [
      narrow
        ? {
          target: 'menu',
          title: 'Your menu stays with you',
          body: seller
            ? 'This opens the same menu on every page: your overview, orders, listings, support, and developers.'
            : 'This opens the same menu on every page: your overview, orders, community, support, and developers.',
        }
        : {
          target: 'sidebar',
          title: 'Your menu stays with you',
          body: seller
            ? 'Overview, orders, listings, support, and developers stay in this sidebar on every page. The marked row is the page you are on.'
            : 'Overview, orders, community, support, and developers stay in this sidebar on every page. The marked row is the page you are on.',
        },
    ];
    if (!seller) {
      steps.push({
        target: 'nav-community',
        title: 'Community is always here',
        body: 'Look up a shop other people have reported before you pay. Your other pages stay in this menu.',
      });
    }
    if (pathname.startsWith('/developer')) {
      steps.push({
        target: 'devnav',
        title: 'Developer tools sit under the same menu',
        body: 'Docs, API keys, and the sample shop are in this row. Your dashboard menu is still on the side.',
      });
    }
    return steps;
  }

  const steps = [
    {
      target: null,
      title: 'Welcome to Funguo',
      body: 'A buyer pays into a PayPal hold. The seller is paid when the buyer confirms the item. You can open this tour again from Tour in the menu.',
    },
    {
      target: 'nav',
      title: 'These links stay on every page',
      body: 'Market, Community, and Developers stay in this bar wherever you go. The page you are on is marked.',
    },
  ];
  if (pathname === '/') {
    steps.push(
      {
        target: 'start',
        title: 'Two ways to begin',
        body: 'Request a payment if you are selling. Or open the demo market and try a purchase with a sandbox card.',
      },
      {
        target: 'steps',
        title: 'How a payment moves',
        body: 'Describe the sale, send the link, the buyer pays into a hold, then they confirm or a dispute settles it.',
      },
    );
  } else if (pathname.startsWith('/community')) {
    steps.push({
      target: 'lookup',
      title: 'Check a shop before you pay',
      body: 'Paste a username or a profile link. A report is one person’s account of what happened.',
    });
  } else if (pathname.startsWith('/market')) {
    steps.push({
      target: 'listings',
      title: 'The demo market',
      body: 'Open an item to see the hold. The money waits until the buyer confirms.',
    });
  } else if (pathname.startsWith('/developer')) {
    steps.push({
      target: 'devnav',
      title: 'Same menu, developer tools',
      body: 'Docs, API keys, and the sample shop are in this row. Market and Community stay in the bar above.',
    });
  }
  return steps;
}

function cardStyle(spot) {
  const width = Math.min(340, window.innerWidth - 32);
  if (!spot) return { width, top: '50%', left: '50%', transform: 'translate(-50%, -50%)' };
  const gap = 16;
  const est = 230;
  if (spot.height > window.innerHeight * 0.55 || spot.left + spot.width + gap + width < window.innerWidth - 16 && spot.height > 240) {
    let left = spot.left + spot.width + gap;
    if (left + width > window.innerWidth - 16) left = Math.max(16, spot.left - width - gap);
    const top = Math.max(16, Math.min(spot.top + 16, window.innerHeight - est - 16));
    return { width, top, left };
  }
  let top = spot.top + spot.height + gap;
  if (top + est > window.innerHeight - 16) top = Math.max(16, spot.top - gap - est);
  let left = spot.left;
  if (left + width > window.innerWidth - 16) left = window.innerWidth - width - 16;
  if (left < 16) left = 16;
  return { width, top, left };
}

export default function Tour({ user }) {
  const { pathname } = useLocation();
  const ctx = useRef({ pathname, user });
  ctx.current = { pathname, user };
  const [open, setOpen] = useState(false);
  const [steps, setSteps] = useState([]);
  const [index, setIndex] = useState(0);
  const [spot, setSpot] = useState(null);
  const cardRef = useRef(null);
  const forcedSide = useRef(false);
  const autoStarted = useRef(false);

  function begin() {
    autoStarted.current = true;
    const next = buildSteps(ctx.current.pathname, ctx.current.user);
    setSteps(next);
    setIndex(0);
    setOpen(true);
  }

  function finish() {
    writeDone();
    setOpen(false);
  }

  useEffect(() => bindOpen(begin), []);

  useEffect(() => {
    if (autoStarted.current || isQuiet(pathname) || readDone()) return undefined;
    const t = setTimeout(() => {
      if (autoStarted.current || readDone()) return;
      autoStarted.current = true;
      begin();
    }, 500);
    return () => clearTimeout(t);
  }, [pathname, user]);

  useEffect(() => {
    if (!open) {
      if (forcedSide.current) {
        document.body.classList.remove('side-open');
        forcedSide.current = false;
      }
      return undefined;
    }
    const prev = document.body.style.overflow;
    const step = steps[index];
    setSpot(null);
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const narrow = window.matchMedia('(max-width: 900px)').matches;
    const inSide = step?.target && ['sidebar', 'nav-community', 'tour-launch'].includes(step.target);
    if (narrow && inSide && document.body.classList.contains('has-side')) {
      document.body.classList.add('side-open');
      forcedSide.current = true;
    }
    let alive = true;
    let tries = 0;
    let timer = 0;
    const measure = () => {
      if (!alive) return;
      const el = step?.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
      if (!el && step?.target && tries < 12) {
        tries += 1;
        timer = setTimeout(measure, 200);
        return;
      }
      if (!el) { setSpot(null); return; }
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) { setSpot(null); return; }
      const pad = 8;
      setSpot({ top: r.top - pad, left: r.left - pad, width: r.width + pad * 2, height: r.height + pad * 2 });
    };
    const el = step?.target ? document.querySelector(`[data-tour="${step.target}"]`) : null;
    el?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: reduce ? 'auto' : 'smooth' });
    timer = setTimeout(() => {
      document.body.style.overflow = 'hidden';
      measure();
    }, el && !reduce ? 280 : 40);
    const onReflow = () => measure();
    window.addEventListener('resize', onReflow);
    window.addEventListener('scroll', onReflow, true);
    const focusTimer = setTimeout(() => cardRef.current?.focus(), 30);
    return () => {
      alive = false;
      clearTimeout(timer);
      clearTimeout(focusTimer);
      document.body.style.overflow = prev;
      window.removeEventListener('resize', onReflow);
      window.removeEventListener('scroll', onReflow, true);
    };
  }, [open, index, steps]);

  if (!open || !steps[index]) return null;
  const step = steps[index];
  const last = index === steps.length - 1;

  function onKeyDown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      finish();
      return;
    }
    if (e.key !== 'Tab' || !cardRef.current) return;
    const nodes = [...cardRef.current.querySelectorAll('button')];
    const first = nodes[0];
    const lastNode = nodes[nodes.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); lastNode.focus(); }
    else if (!e.shiftKey && document.activeElement === lastNode) { e.preventDefault(); first.focus(); }
  }

  return (
    <div className="tour-root">
      <div className="tour-catch" />
      {spot ? <div className="tour-hole" style={spot} /> : <div className="tour-scrim" />}
      <div
        className="tour-card card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        aria-describedby="tour-body"
        tabIndex={-1}
        ref={cardRef}
        style={cardStyle(spot)}
        onKeyDown={onKeyDown}
      >
        <p className="tour-progress">Step {index + 1} of {steps.length}</p>
        <h2 id="tour-title">{step.title}</h2>
        <p id="tour-body">{step.body}</p>
        <div className="tour-actions">
          <button type="button" className="btn btn-line" onClick={finish}>Skip</button>
          <div className="tour-actions-end">
            {index > 0 && <button type="button" className="btn btn-line" onClick={() => setIndex((n) => n - 1)}>Back</button>}
            <button type="button" className="btn btn-navy" onClick={() => (last ? finish() : setIndex((n) => n + 1))}>{last ? 'Done' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function bindOpen(fn) {
  opener = fn;
  return () => { if (opener === fn) opener = null; };
}
