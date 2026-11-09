// Shared helpers for the three Funguo pages. Plain JS, no build step.

// The boot splash plays once per browser session, not on every page.
try {
  if (sessionStorage.getItem('funguo-booted')) document.documentElement.classList.add('no-boot');
  else sessionStorage.setItem('funguo-booted', '1');
} catch { /* storage blocked: show the splash */ }

window.F = (() => {
  const $ = (sel, root = document) => root.querySelector(sel);

  async function api(path, opts = {}) {
    const init = { ...opts, headers: { ...(opts.headers || {}) } };
    if (opts.json !== undefined) {
      init.method = init.method || 'POST';
      init.headers['Content-Type'] = 'application/json';
      init.body = JSON.stringify(opts.json);
    }
    const res = await fetch(path, init);
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const err = new Error(body.error || `HTTP ${res.status}`);
      err.body = body;
      throw err;
    }
    return body;
  }

  const esc = (s) =>
    String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const LOCAL = {
    KES: 'KSh', UGX: 'USh', TZS: 'TSh', RWF: 'FRw', NGN: '₦', GHS: 'GH₵', ZAR: 'R',
    EGP: 'E£', ETB: 'Br', INR: '₹', AED: 'AED', SAR: 'SAR', GBP: '£', EUR: '€',
    JPY: '¥', CNY: 'CN¥', BRL: 'R$', MXN: 'MX$',
  };
  const ZERO = new Set(['JPY', 'UGX', 'RWF']);
  const money = (n, cur = 'USD') => {
    if (n == null || n === '') return '—';
    const code = String(cur || 'USD').toUpperCase();
    const amount = Number(n);
    if (!Number.isFinite(amount)) return '—';
    const digits = ZERO.has(code) ? 0 : 2;
    const num = new Intl.NumberFormat('en', { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(amount);
    if (LOCAL[code]) return `${LOCAL[code]} ${num}`;
    try {
      return new Intl.NumberFormat('en', { style: 'currency', currency: code }).format(amount);
    } catch {
      return `${code} ${num}`;
    }
  };

  const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0c1829"/><circle cx="12.5" cy="15" r="4.1" fill="none" stroke="#d4af37" stroke-width="1.8"/><path d="M16.2 15H24.2M20.6 15v3.1M24.2 15v2.2" fill="none" stroke="#d4af37" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  const STATE_STYLE = {
    INITIATED: 'b-slate',
    HELD: 'b-amber',
    SHIPPED: 'b-sky',
    INSPECTED: 'b-indigo',
    PAID: 'b-emerald',
    RELEASED: 'b-emerald',
    VOIDED: 'b-violet',
    DISPUTED: 'b-rose',
    RESOLVED_RELEASE: 'b-emerald',
    RESOLVED_PARTIAL: 'b-teal',
    RESOLVED_REFUND: 'b-violet',
  };
  // Plain words for people; the raw state stays in the tooltip for developers.
  const STATE_LABEL = {
    INITIATED: 'Awaiting payment',
    HELD: 'Money held',
    SHIPPED: 'Shipped',
    INSPECTED: 'Delivered',
    PAID: 'Paid',
    RELEASED: 'Paid to seller',
    VOIDED: 'Hold cancelled',
    DISPUTED: 'In dispute',
    RESOLVED_RELEASE: 'Paid to seller',
    RESOLVED_PARTIAL: 'Partly refunded',
    RESOLVED_REFUND: 'Refunded',
  };
  const stateLabel = (state) => STATE_LABEL[state] || String(state || '').replaceAll('_', ' ').toLowerCase();
  const badge = (state) =>
    `<span class="badge ${STATE_STYLE[state] || 'b-slate'}" title="${esc(state)}">${esc(stateLabel(state))}</span>`;

  const TICKET_STYLE = { open: 'b-amber', in_review: 'b-sky', resolved: 'b-emerald' };
  const ticketBadge = (status) =>
    `<span class="badge ${TICKET_STYLE[status] || 'b-slate'}">${esc(String(status || '').replaceAll('_', ' '))}</span>`;

  const RISK_STYLE = { low: 'b-emerald', medium: 'b-amber', high: 'b-rose' };
  const riskBadge = (v) =>
    v ? `<span class="risk ${RISK_STYLE[v.risk] || ''}">${esc(v.risk)} risk</span>` : '';

  function toast(msg, kind = 'error') {
    const el = document.createElement('div');
    el.className = `toast${kind === 'error' ? ' is-error' : ''}`;
    el.setAttribute('role', kind === 'error' ? 'alert' : 'status');
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  function dismissBoot() {
    const el = document.getElementById('boot');
    if (!el) return;
    const done = () => el.remove();
    el.addEventListener('animationend', (e) => {
      if (e.animationName === 'boot-fade') done();
    });
    setTimeout(done, 1800);
  }

  async function header() {
    dismissBoot();
    const h = await api('/api/health').catch(() => null);
    const sim = h?.paypal_mode === 'simulate';
    const me = await api('/api/auth/me').then((r) => r.user).catch(() => null);
    if (me?.role === 'buyer') persona.setBuyer(me.email, me.name);
    if (me?.role === 'seller' && me.seller_id) persona.setSeller(me.seller_id);
    const path = location.pathname;
    const here = path.startsWith('/buyer') ? 'buyer'
      : path.startsWith('/seller') ? 'seller'
      : path.startsWith('/admin') ? 'admin'
      : path.startsWith('/support') ? 'support'
      : path.startsWith('/market') || path.startsWith('/l/') ? 'market'
      : path.startsWith('/community') ? 'community'
      : path.startsWith('/developers') ? 'developers'
      : path.startsWith('/login') ? 'login'
      : path.startsWith('/signup') ? 'signup'
      : '';
    const link = (href, key, label) => `<a href="${href}" ${here === key ? 'aria-current="page"' : ''}>${label}</a>`;
    const market = link('/market', 'market', 'Market');
    const community = link('/community', 'community', 'Community');
    const forApp = link('/developers', 'developers', 'For your app');
    const links = !me
      ? [market, community, forApp, link('/login', 'login', 'Sign in'), link('/signup', 'signup', 'Create account')]
      : me.role === 'seller'
        ? [community, forApp, link('/seller', 'seller', 'Dashboard'), link('/support', 'support', 'Support')]
        : me.role === 'admin'
          ? [market, community, forApp, link('/admin', 'admin', 'Audit'), link('/support', 'support', 'Support')]
          : [market, community, forApp, link('/buyer', 'buyer', 'Dashboard'), link('/support', 'support', 'Support')];
    $('#hdr').innerHTML = `
      ${sim ? `<div class="sim-bar" role="status">Simulate mode. PayPal calls stay inside this app until sandbox credentials are set.</div>` : ''}
      <header class="topbar">
        <div class="topbar-inner">
          <a href="/" class="brand">
            <span class="brand-mark">${MARK}</span>
            <span>
              <span class="brand-name">Funguo</span>
              <span class="brand-sub">Escrow on PayPal</span>
            </span>
          </a>
          <nav class="topnav" aria-label="Primary">
            ${links.join('')}
          </nav>
          ${me ? `<button type="button" id="logout" class="btn btn-line">Log out</button>` : ''}
        </div>
      </header>`;
    $('#logout')?.addEventListener('click', async () => {
      await api('/api/auth/logout', { json: {} }).catch(() => {});
      location.href = '/';
    });
    return { health: h, user: me };
  }

  const json = (o) => `<pre class="json">${esc(JSON.stringify(o, null, 2))}</pre>`;

  const persona = {
    buyerEmail: () => localStorage.getItem('funguo_buyer') || '',
    buyerName: () => localStorage.getItem('funguo_buyer_name') || '',
    setBuyer(email, name) {
      localStorage.setItem('funguo_buyer', String(email || '').trim());
      if (name) localStorage.setItem('funguo_buyer_name', name);
    },
    sellerId: () => localStorage.getItem('funguo_seller') || '',
    setSeller(id) { localStorage.setItem('funguo_seller', id || ''); },
  };

  function orderLink(o, hint = '') {
    const who = o.seller_name && o.buyer_name ? `${o.seller_name} · ${o.buyer_name}` : (o.seller_name || o.buyer_name || '');
    return `<a class="row-link" href="/o/${esc(o.id)}">
      <span><b>${esc(o.listing_title || 'Order')}</b><span class="meta">${esc(who)}${hint ? ` · ${esc(hint)}` : ''}</span></span>
      <span class="price">${money(o.amount, o.currency)}</span>
      <span>${badge(o.state)}</span>
      <span class="meta">${when(o.updated_at)}</span>
    </a>`;
  }

  function ticketLink(t) {
    return `<a class="row-link cols-3" href="/support/${esc(t.id)}">
      <span><b>${esc(t.subject)}</b><span class="meta">${esc(t.topic)}${t.order_id ? ` · ${esc(t.order_id)}` : ''}</span></span>
      <span>${ticketBadge(t.status)}</span>
      <span class="meta">${when(t.updated_at)}</span>
    </a>`;
  }

  function socialLinks(s) {
    const links = (s?.socials || []).map((a) =>
      `<a class="social-link" href="${esc(a.profile_url)}" target="_blank" rel="noopener">${esc(a.label)} · @${esc(a.handle)}</a>`,
    ).join('');
    return links ? `<div class="social-links">${links}</div>` : '';
  }

  function communityFlags(s) {
    return (s?.socials || []).filter((a) => a.reports > 0).map((a) =>
      `<a class="callout callout-bad" href="/community?platform=${encodeURIComponent(a.platform)}&handle=${encodeURIComponent(a.handle)}">${esc(a.label)} @${esc(a.handle)} has ${a.reports} community report${a.reports === 1 ? '' : 's'}. Read them before you pay.</a>`,
    ).join('');
  }

  return { $, api, esc, money, when, badge, stateLabel, riskBadge, ticketBadge, toast, header, json, MARK, persona, orderLink, ticketLink, socialLinks, communityFlags };
})();
