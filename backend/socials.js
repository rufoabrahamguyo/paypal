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

const ALIASES = {
  twitter: 'x',
  x: 'x',
  ig: 'instagram',
  insta: 'instagram',
  instagram: 'instagram',
  fb: 'facebook',
  facebook: 'facebook',
  yt: 'youtube',
  youtube: 'youtube',
  tiktok: 'tiktok',
  'tik tok': 'tiktok',
};

export function listPlatforms() {
  return Object.entries(PLATFORMS).map(([id, p]) => ({ id, label: p.label }));
}

export function platformLabel(id) {
  if (PLATFORMS[id]) return PLATFORMS[id].label;
  const slug = String(id || '');
  if (slug.startsWith('other:')) {
    return slug.slice(6).split('-').filter(Boolean).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
  }
  return id;
}

function slugify(name) {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 30)
    .replace(/-+$/g, '');
}

/** A stored platform id: one of the known apps, or other:<slug>. */
export function isPlatformId(id) {
  if (PLATFORMS[id]) return true;
  return /^other:[a-z0-9]+(?:-[a-z0-9]+)*$/.test(String(id || '')) && String(id).length <= 36;
}

export function isCustomPlatform(id) {
  return isPlatformId(id) && String(id).startsWith('other:');
}

/**
 * Turn a dropdown value into a platform id.
 * `other` needs the typed app name. A name that is really TikTok, Instagram,
 * Facebook, X, or YouTube (including "Twitter") maps back to that app.
 */
export function resolvePlatform(platform, customName) {
  const id = String(platform || '').trim().toLowerCase();
  if (PLATFORMS[id]) return { id, label: PLATFORMS[id].label, custom: false };
  if (id !== 'other') return { error: 'Choose an app, or pick Other and type its name' };
  const name = String(customName || '').trim().replace(/\s+/g, ' ');
  if (name.length < 2 || name.length > 30) return { error: 'Name that app in 2–30 characters' };
  if (/[/@]|https?:/i.test(name)) return { error: 'Type the app name, not a link or username' };
  if (!/^[\p{L}\p{N}][\p{L}\p{N} .&+'’-]*$/u.test(name)) return { error: 'Use letters and numbers in the app name' };
  const known = ALIASES[name.toLowerCase()] || ALIASES[slugify(name).replace(/-/g, '')];
  if (known && PLATFORMS[known]) return { id: known, label: PLATFORMS[known].label, custom: false };
  const slug = slugify(name);
  if (slug.length < 2) return { error: 'Use a name with letters or numbers' };
  return { id: `other:${slug}`, label: name, custom: true };
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
