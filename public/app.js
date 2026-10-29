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

  const STATE_STYLE = {
    INITIATED: 'bg-slate-100 text-slate-700',
    HELD: 'bg-amber-100 text-amber-800',
    SHIPPED: 'bg-sky-100 text-sky-800',
    INSPECTED: 'bg-indigo-100 text-indigo-800',
    RELEASED: 'bg-emerald-100 text-emerald-800',
    DISPUTED: 'bg-rose-100 text-rose-800',
    RESOLVED_RELEASE: 'bg-emerald-100 text-emerald-800',
    RESOLVED_PARTIAL: 'bg-teal-100 text-teal-800',
    RESOLVED_REFUND: 'bg-violet-100 text-violet-800',
  };
  const badge = (state) =>
    `<span class="inline-block rounded-full px-2.5 py-0.5 text-xs font-semibold tracking-wide ${STATE_STYLE[state] || 'bg-slate-100'}">${esc(state)}</span>`;

  const RISK_STYLE = { low: 'bg-emerald-100 text-emerald-800', medium: 'bg-amber-100 text-amber-800', high: 'bg-rose-100 text-rose-800' };
  const riskBadge = (v) =>
    v ? `<span class="inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${RISK_STYLE[v.risk] || ''}">${esc(v.risk)} risk</span>` : '';

  function toast(msg, kind = 'error') {
    const el = document.createElement('div');
    el.className = `fixed bottom-4 left-1/2 -translate-x-1/2 z-50 max-w-lg rounded-lg px-4 py-3 text-sm shadow-lg ${
      kind === 'error' ? 'bg-rose-600 text-white' : 'bg-slate-900 text-white'
    }`;
    el.textContent = msg;
    document.body.appendChild(el);
    setTimeout(() => el.remove(), 6000);
  }

  async function header() {
    const h = await api('/api/health').catch(() => null);
    const sim = h?.paypal_mode === 'simulate';
    $('#hdr').innerHTML = `
      ${sim ? `<div class="bg-amber-400 text-amber-950 text-center text-sm font-medium py-1.5 px-4">
        PAYPAL_MODE=simulate — PayPal calls are answered by an in-process simulator. Set sandbox credentials for real calls.</div>` : ''}
      <header class="border-b border-slate-200 bg-white">
        <div class="mx-auto max-w-5xl px-4 py-3 flex items-center justify-between gap-4">
          <a href="/" class="flex items-center gap-2 font-bold text-lg text-slate-900">
            <span class="grid place-items-center w-8 h-8 rounded-lg bg-emerald-600 text-white">🔑</span> Funguo
            <span class="hidden sm:inline text-sm font-normal text-slate-500">AI-adjudicated escrow on PayPal</span>
          </a>
          <div class="flex flex-wrap justify-end gap-1.5 text-[11px] text-slate-600">
            ${h ? [
              ['PayPal', h.paypal_mode],
              ['Agent', h.agent_engine],
              ['Products', h.product_data],
              ['Scam search', h.scam_search],
            ].map(([k, v]) => `<span class="rounded bg-slate-100 px-1.5 py-0.5"><b>${k}</b> ${esc(v)}</span>`).join('') : ''}
          </div>
        </div>
      </header>`;
    return h;
  }

  const json = (o) => `<pre class="text-xs bg-slate-950 text-slate-100 rounded-lg p-3 overflow-x-auto max-h-80">${esc(JSON.stringify(o, null, 2))}</pre>`;

  return { $, api, esc, money, when, badge, riskBadge, toast, header, json };
})();
