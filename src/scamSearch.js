// Similarity search over known scam-listing patterns (Elastic interface).
//
// searchScamPatterns(text, k) -> {
//   backend: 'elastic' | 'local-cosine',
//   matches: [{ id, label, severity, stage, score, text }]   // score = cosine similarity
// }
//
// With ELASTIC_URL + ELASTIC_API_KEY set, queries an Elastic index with a kNN
// search over a dense_vector field (`npm run seed` creates + fills the index).
// Otherwise it runs the same cosine similarity locally over the seeded corpus
// embeddings in data/scam-embeddings.json. Same vectors, same interface.
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { embed, cosine, DIMS } from './embed.js';

const CORPUS = JSON.parse(fs.readFileSync(new URL('./data/scam-patterns.json', import.meta.url)));
const EMB_FILE = path.join(path.dirname(path.resolve(config.dbPath)), 'scam-embeddings.json');

let local = null;
function localIndex() {
  if (local) return local;
  try {
    local = JSON.parse(fs.readFileSync(EMB_FILE, 'utf8'));
    if (local.length !== CORPUS.length || local[0]?.embedding?.length !== DIMS) local = null;
  } catch {
    local = null;
  }
  local ??= CORPUS.map((p) => ({ ...p, embedding: embed(`${p.label}. ${p.text}`) }));
  return local;
}

function searchLocal(vec, k) {
  return localIndex()
    .map(({ embedding, ...p }) => ({ ...p, score: +cosine(vec, embedding).toFixed(3) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

const esHeaders = () => ({ Authorization: `ApiKey ${config.elastic.apiKey}`, 'Content-Type': 'application/json' });

async function searchElastic(vec, k) {
  const res = await fetch(`${config.elastic.url}/${config.elastic.index}/_search`, {
    method: 'POST',
    headers: esHeaders(),
    body: JSON.stringify({
      knn: { field: 'embedding', query_vector: vec, k, num_candidates: 50 },
      _source: ['id', 'label', 'severity', 'stage', 'text'],
    }),
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Elastic ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const body = await res.json();
  // For cosine similarity Elastic reports _score = (1 + cos) / 2.
  return body.hits.hits.map((h) => ({ ...h._source, score: +(2 * h._score - 1).toFixed(3) }));
}

export async function searchScamPatterns(text, k = 3) {
  if (!String(text ?? '').trim()) return { backend: 'none', matches: [] };
  const vec = embed(text);
  if (config.elastic.url && config.elastic.apiKey) {
    try {
      return { backend: 'elastic', matches: await searchElastic(vec, k) };
    } catch (e) {
      console.warn('[scamSearch] Elastic failed, using local cosine:', e.message);
      return { backend: 'local-cosine', note: `Elastic unavailable (${e.message})`, matches: searchLocal(vec, k) };
    }
  }
  return { backend: 'local-cosine', matches: searchLocal(vec, k) };
}

/** Called by the seed script: write local embeddings and, if configured, (re)build the Elastic index. */
export async function indexCorpus() {
  const docs = CORPUS.map((p) => ({ ...p, embedding: embed(`${p.label}. ${p.text}`) }));
  fs.writeFileSync(EMB_FILE, JSON.stringify(docs));
  local = docs;
  if (!(config.elastic.url && config.elastic.apiKey)) return { backend: 'local-cosine', count: docs.length, file: EMB_FILE };

  const base = `${config.elastic.url}/${config.elastic.index}`;
  await fetch(base, { method: 'DELETE', headers: esHeaders() });
  const created = await fetch(base, {
    method: 'PUT',
    headers: esHeaders(),
    body: JSON.stringify({
      mappings: {
        properties: {
          id: { type: 'keyword' },
          label: { type: 'text' },
          severity: { type: 'keyword' },
          stage: { type: 'keyword' },
          text: { type: 'text' },
          embedding: { type: 'dense_vector', dims: DIMS, index: true, similarity: 'cosine' },
        },
      },
    }),
  });
  if (!created.ok) throw new Error(`Elastic index create failed: ${created.status} ${await created.text()}`);
  const bulk = docs.flatMap((d) => [JSON.stringify({ index: { _id: d.id } }), JSON.stringify(d)]).join('\n') + '\n';
  const res = await fetch(`${base}/_bulk?refresh=true`, {
    method: 'POST',
    headers: { ...esHeaders(), 'Content-Type': 'application/x-ndjson' },
    body: bulk,
  });
  const out = await res.json();
  if (!res.ok || out.errors) throw new Error(`Elastic bulk index failed: ${JSON.stringify(out).slice(0, 300)}`);
  return { backend: 'elastic', count: docs.length, index: config.elastic.index };
}
