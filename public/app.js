// Shared helpers for the three Funguo pages. Plain JS, no build step.
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

  const money = (n, cur = 'USD') =>
    n == null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: cur }).format(n);

  const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

  const MARK = `<svg viewBox="0 0 32 32" aria-hidden="true"><rect width="32" height="32" rx="8" fill="#0c1829"/><circle cx="12.5" cy="15" r="4.1" fill="none" stroke="#d4af37" stroke-width="1.8"/><path d="M16.2 15H24.2M20.6 15v3.1M24.2 15v2.2" fill="none" stroke="#d4af37" stroke-width="1.8" stroke-linecap="round"/></svg>`;

  const STATE_STYLE = {
    INITIATED: 'b-slate',
    HELD: 'b-amber',
    SHIPPED: 'b-sky',
    INSPECTED: 'b-indigo',
    RELEASED: 'b-emerald',
    DISPUTED: 'b-rose',
    RESOLVED_RELEASE: 'b-emerald',
    RESOLVED_PARTIAL: 'b-teal',
    RESOLVED_REFUND: 'b-violet',
  };
  const badge = (state) =>
    `<span class="badge ${STATE_STYLE[state] || 'b-slate'}">${esc(state)}</span>`;

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
      : path.startsWith('/market') ? 'market'
      : path.startsWith('/login') ? 'login'
      : path.startsWith('/signup') ? 'signup'
      : '';
    const link = (href, key, label) => `<a href="${href}" ${here === key ? 'aria-current="page"' : ''}>${label}</a>`;
    const links = !me
      ? [link('/login', 'login', 'Sign in'), link('/signup', 'signup', 'Create account')]
      : me.role === 'seller'
        ? [link('/seller', 'seller', 'Dashboard'), link('/support', 'support', 'Support')]
        : me.role === 'admin'
          ? [link('/admin', 'admin', 'Audit'), link('/support', 'support', 'Support')]
          : [link('/buyer', 'buyer', 'Dashboard'), link('/support', 'support', 'Support')];
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

  return { $, api, esc, money, when, badge, riskBadge, ticketBadge, toast, header, json, MARK, persona, orderLink, ticketLink };
})();
