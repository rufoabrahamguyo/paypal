// Central env loading. Every secret comes from the environment; nothing is
// hard-coded. Missing required values fail loudly with a pointer to the fix.
import 'dotenv/config';

const env = (k, d = '') => (process.env[k] ?? '').trim() || d;

const port = Number(env('PORT', '3000'));

export const config = {
  port,
  baseUrl: (env('BASE_URL') || env('RENDER_EXTERNAL_URL') || `http://localhost:${port}`).replace(/\/$/, ''),
  dbPath: env('DB_PATH', './data/funguo.db'),
  platformFeeBps: Number(env('PLATFORM_FEE_BPS', '250')),
  // PayPal guarantees authorized funds for ~3 days; after that, wallet holds are reauthorized.
  honorPeriodHours: Number(env('HONOR_PERIOD_HOURS', '72')),

  paypal: {
    mode: env('PAYPAL_MODE', 'sandbox'),
    clientId: env('PAYPAL_CLIENT_ID'),
    secret: env('PAYPAL_SECRET'),
    webhookId: env('PAYPAL_WEBHOOK_ID'),
    // Sandbox only. There is deliberately no switch to the live API.
    baseUrl: 'https://api-m.sandbox.paypal.com',
  },

  anthropic: {
    apiKey: env('ANTHROPIC_API_KEY'),
    model: env('ANTHROPIC_MODEL', 'claude-opus-5-5'),
    minConfidence: Number(env('AGENT_MIN_CONFIDENCE', '0.7')),
  },

  channel3: { apiKey: env('CHANNEL3_API_KEY') },

  elastic: {
    url: env('ELASTIC_URL').replace(/\/$/, ''),
    apiKey: env('ELASTIC_API_KEY'),
    index: env('ELASTIC_INDEX', 'funguo-scam-patterns'),
  },
};

export const isSimulated = () => config.paypal.mode === 'simulate';

export function assertPayPalConfig() {
  if (!['sandbox', 'simulate'].includes(config.paypal.mode)) {
    throw new Error(`PAYPAL_MODE must be "sandbox" or "simulate" (got "${config.paypal.mode}"). Live mode is intentionally unsupported.`);
  }
  if (isSimulated()) return;
  const missing = ['PAYPAL_CLIENT_ID', 'PAYPAL_SECRET'].filter((k) => !env(k));
  if (missing.length) {
    throw new Error(
      `Missing ${missing.join(' and ')}.\n` +
        '  -> Create a sandbox app at https://developer.paypal.com/dashboard/applications/sandbox\n' +
        '     and copy its Client ID / Secret into .env (see .env.example).\n' +
        '  -> Or set PAYPAL_MODE=simulate to click through with an in-process PayPal stand-in.',
    );
  }
}
