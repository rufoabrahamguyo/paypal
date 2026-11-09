// Country chosen at signup decides the currency that person prices in.
// PayPal cannot charge every one of these, so paypalCharge converts the rest
// to USD at a rough rate. Amounts stored and shown in the app stay local.

export const COUNTRIES = [
  { code: 'AU', name: 'Australia', currency: 'AUD', label: 'AUD' },
  { code: 'BR', name: 'Brazil', currency: 'BRL', label: 'R$' },
  { code: 'CA', name: 'Canada', currency: 'CAD', label: 'CAD' },
  { code: 'CN', name: 'China', currency: 'CNY', label: 'CN¥' },
  { code: 'EG', name: 'Egypt', currency: 'EGP', label: 'E£' },
  { code: 'ET', name: 'Ethiopia', currency: 'ETB', label: 'Br' },
  { code: 'FR', name: 'France', currency: 'EUR', label: '€' },
  { code: 'DE', name: 'Germany', currency: 'EUR', label: '€' },
  { code: 'GH', name: 'Ghana', currency: 'GHS', label: 'GH₵' },
  { code: 'IN', name: 'India', currency: 'INR', label: '₹' },
  { code: 'IE', name: 'Ireland', currency: 'EUR', label: '€' },
  { code: 'IT', name: 'Italy', currency: 'EUR', label: '€' },
  { code: 'JP', name: 'Japan', currency: 'JPY', label: '¥' },
  { code: 'KE', name: 'Kenya', currency: 'KES', label: 'KSh' },
  { code: 'MX', name: 'Mexico', currency: 'MXN', label: 'MX$' },
  { code: 'NL', name: 'Netherlands', currency: 'EUR', label: '€' },
  { code: 'NG', name: 'Nigeria', currency: 'NGN', label: '₦' },
  { code: 'RW', name: 'Rwanda', currency: 'RWF', label: 'FRw' },
  { code: 'SA', name: 'Saudi Arabia', currency: 'SAR', label: 'SAR' },
  { code: 'SG', name: 'Singapore', currency: 'SGD', label: 'SGD' },
  { code: 'ZA', name: 'South Africa', currency: 'ZAR', label: 'R' },
  { code: 'ES', name: 'Spain', currency: 'EUR', label: '€' },
  { code: 'TZ', name: 'Tanzania', currency: 'TZS', label: 'TSh' },
  { code: 'UG', name: 'Uganda', currency: 'UGX', label: 'USh' },
  { code: 'AE', name: 'United Arab Emirates', currency: 'AED', label: 'AED' },
  { code: 'GB', name: 'United Kingdom', currency: 'GBP', label: '£' },
  { code: 'US', name: 'United States', currency: 'USD', label: 'USD' },
];

// Local currency units for 1 USD. Rough figures so a KSh price can be compared
// with USD market data and sent to PayPal, which has no shilling charge.
const PER_USD = {
  AED: 3.67,
  EGP: 49,
  ETB: 145,
  GHS: 15.5,
  INR: 84,
  KES: 129,
  NGN: 1550,
  RWF: 1350,
  SAR: 3.75,
  TZS: 2650,
  UGX: 3700,
  ZAR: 18,
};

export const PAYPAL_CURRENCIES = new Set([
  'AUD', 'BRL', 'CAD', 'CNY', 'CZK', 'DKK', 'EUR', 'HKD', 'HUF', 'ILS', 'JPY',
  'MYR', 'MXN', 'TWD', 'NZD', 'NOK', 'PHP', 'PLN', 'GBP', 'RUB', 'SGD', 'SEK',
  'CHF', 'THB', 'USD',
]);

const byCode = new Map(COUNTRIES.map((c) => [c.code, c]));

export function listCountries() {
  return [...COUNTRIES].sort((a, b) => a.name.localeCompare(b.name));
}

export function countryByCode(code) {
  return byCode.get(String(code || '').trim().toUpperCase()) || null;
}

export function labelForCurrency(currency) {
  const code = String(currency || 'USD').toUpperCase();
  return COUNTRIES.find((c) => c.currency === code)?.label || code;
}

const round2 = (n) => Math.round(Number(n) * 100) / 100;

export function toUsd(amount, currency) {
  const code = String(currency || 'USD').toUpperCase();
  const n = Number(amount);
  if (!Number.isFinite(n)) return n;
  if (code === 'USD' || !PER_USD[code]) return round2(n);
  return round2(n / PER_USD[code]);
}

/** Amount and currency to send to PayPal. Local totals stay on the order. */
export function paypalCharge(amount, currency, total = amount) {
  const code = String(currency || 'USD').toUpperCase();
  const n = Number(amount);
  const whole = Number(total);
  if (PAYPAL_CURRENCIES.has(code)) return { amount: round2(n), currency: code };
  const per = PER_USD[code];
  if (!per) return { amount: round2(n), currency: 'USD' };
  const totalUsd = Math.max(0.01, round2(whole / per));
  if (!(n < whole)) return { amount: totalUsd, currency: 'USD' };
  const part = round2(n / per);
  return { amount: Math.max(0.01, Math.min(part, round2(totalUsd - 0.01))), currency: 'USD' };
}
