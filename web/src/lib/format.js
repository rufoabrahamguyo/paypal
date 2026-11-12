const LOCAL = {
  KES: 'KSh', UGX: 'USh', TZS: 'TSh', RWF: 'FRw', NGN: '₦', GHS: 'GH₵', ZAR: 'R',
  EGP: 'E£', ETB: 'Br', INR: '₹', AED: 'AED', SAR: 'SAR', GBP: '£', EUR: '€',
  JPY: '¥', CNY: 'CN¥', BRL: 'R$', MXN: 'MX$',
};
const ZERO = new Set(['JPY', 'UGX', 'RWF']);

export function money(n, cur = 'USD') {
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
}

export const when = (iso) => (iso ? new Date(iso).toLocaleString() : '—');

export function greeting(name) {
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = String(name || '').trim().split(/\s+/)[0];
  return first ? `${hello}, ${first}` : hello;
}

export const STATE_STYLE = {
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
export const stateLabel = (state) => STATE_LABEL[state] || String(state || '').replaceAll('_', ' ').toLowerCase();

export const SETTLED = ['RELEASED', 'PAID', 'VOIDED', 'RESOLVED_RELEASE', 'RESOLVED_PARTIAL', 'RESOLVED_REFUND'];

export const dashPath = (role) => (role === 'seller' ? '/seller' : role === 'admin' ? '/admin' : '/buyer');

// Only same-site paths are allowed as a post-login destination.
export const safeNext = (next) => (typeof next === 'string' && next.startsWith('/') && !next.startsWith('//') && !next.includes('\\') ? next : '');

export const initials = (name) => String(name || '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();

export async function copy(text) {
  await navigator.clipboard?.writeText(text).catch(() => {});
}
