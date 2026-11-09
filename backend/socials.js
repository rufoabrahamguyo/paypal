// Seller social accounts. The profile URL is built from a fixed host and a
// handle, then checked for a code the seller places on that public page.
// We never fetch an address the seller typed in.

export const PLATFORMS = {
  instagram: { label: 'Instagram', url: (h) => `https://www.instagram.com/${h}/` },
  tiktok: { label: 'TikTok', url: (h) => `https://www.tiktok.com/@${h}` },
  facebook: { label: 'Facebook', url: (h) => `https://www.facebook.com/${h}` },
  x: { label: 'X', url: (h) => `https://x.com/${h}` },
  youtube: { label: 'YouTube', url: (h) => `https://www.youtube.com/@${h}` },
};

const SKIP = new Set(['p', 'reel', 'reels', 'stories', 'explore', 'accounts', 'share', 'watch', 'shorts', 'channel', 'c', 'user']);

export function listPlatforms() {
  return Object.entries(PLATFORMS).map(([id, p]) => ({ id, label: p.label }));
}

export function platformLabel(id) {
  return PLATFORMS[id]?.label || id;
}

export function profileUrl(platform, handle) {
  const spec = PLATFORMS[platform];
  if (!spec) return null;
  return spec.url(handle);
}

/** Accept @name or a profile link and return a bare handle. */
export function cleanHandle(raw) {
  let text = String(raw || '').trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text) || /[a-z0-9.-]+\.[a-z]{2,}\//i.test(text)) {
    try {
      const u = new URL(text.includes('://') ? text : `https://${text}`);
      const parts = u.pathname.split('/').filter(Boolean).map((p) => {
        try { return decodeURIComponent(p); } catch { return p; }
      });
      const at = parts.find((p) => p.startsWith('@'));
      text = at ? at.slice(1) : (parts.find((p) => !SKIP.has(p.toLowerCase())) || '');
    } catch {
      return null;
    }
  }
  text = text.replace(/^@+/, '').trim();
  if (!/^[A-Za-z0-9._]{2,30}$/.test(text)) return null;
  if (text.startsWith('.') || text.endsWith('.') || text.includes('..')) return null;
  return text;
}

/** Read the public profile we built and see if the seller's code is on it. */
export async function profileHasCode(platform, handle, code) {
  const url = profileUrl(platform, handle);
  if (!url || !code) return { found: false, blocked: true };
  const res = await fetch(url, {
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
    headers: {
      'User-Agent': 'Funguo/0.1 (seller identity check)',
      Accept: 'text/html,application/xhtml+xml',
    },
  });
  if (res.status >= 300 && res.status < 400) return { found: false, blocked: true };
  if (!res.ok) return { found: false, blocked: true };
  const text = (await res.text()).slice(0, 800_000);
  return { found: text.includes(code), blocked: false };
}
