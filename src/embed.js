// Deterministic local text embedding (feature hashing over words, word
// bigrams and character trigrams). No API key, no network, and stable across
// runs, so the same vectors can be indexed in Elastic or searched locally.
// TODO(live): swap for a hosted embedding model (e.g. Elastic's ELSER / an
// inference endpoint) by changing this one function and DIMS.
export const DIMS = 1024;

const STOP = new Set('a an and are as at be by for from has have i in is it its of on or that the this to was were will with my me you your our'.split(' '));

function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function add(v, feature, weight) {
  const h = fnv1a(feature);
  v[h % DIMS] += (h & 0x80000000 ? -1 : 1) * weight;
}

export function embed(text) {
  const v = new Array(DIMS).fill(0);
  const toks = String(text)
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1 && !STOP.has(t));
  toks.forEach((t, i) => {
    add(v, `w:${t}`, 1);
    if (i > 0) add(v, `b:${toks[i - 1]}_${t}`, 0.6);
    const p = `_${t}_`;
    for (let j = 0; j + 3 <= p.length; j++) add(v, `c:${p.slice(j, j + 3)}`, 0.25);
  });
  const norm = Math.hypot(...v);
  return norm ? v.map((x) => +(x / norm).toFixed(6)) : v;
}

export const cosine = (a, b) => a.reduce((s, x, i) => s + x * b[i], 0);
