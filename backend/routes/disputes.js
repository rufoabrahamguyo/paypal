import { Router } from 'express';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config.js';
import { getDispute, insertDispute, updateDispute, getOrder, now } from '../db.js';
import * as escrow from '../escrow.js';
import { adjudicate } from '../agent.js';

export const disputes = Router();

const UPLOADS = path.join(path.dirname(path.resolve(config.dbPath)), 'uploads');
fs.mkdirSync(UPLOADS, { recursive: true });
const IMAGE_TYPES = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif' };

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOADS,
    filename: (req, file, cb) => cb(null, `${req.params.id}-${Date.now()}${IMAGE_TYPES[file.mimetype]}`),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (req, file, cb) => {
    if (IMAGE_TYPES[file.mimetype]) return cb(null, true);
    const err = new Error('Photo must be JPEG, PNG, WebP or GIF');
    err.status = 400;
    cb(err);
  },
});

function runInBackground(orderId, disputeId) {
  return adjudicate(orderId, disputeId).catch((e) => {
    console.error('[disputes] agent crashed:', e);
    updateDispute(disputeId, { status: 'ESCALATED', decision: 'escalate_to_human', error: e.message, decided_at: now() });
  });
}

/**
 * Open a dispute: multipart/form-data with `complaint` (text) and optional
 * `photo` (image). The order moves to DISPUTED (funds stay held) and the agent
 * runs in the background; poll GET /api/disputes/:id. Pass ?wait=1 to block
 * until the agent has decided (handy for scripts).
 */
disputes.post('/orders/:id/disputes', upload.single('photo'), async (req, res) => {
  const complaint = String(req.body?.complaint ?? '').trim();
  const cleanup = () => req.file && fs.rmSync(req.file.path, { force: true });
  if (complaint.length < 5) {
    cleanup();
    return res.status(400).json({ error: 'complaint is required' });
  }
  const order = getOrder(req.params.id);
  try {
    escrow.openDispute(req.params.id);
  } catch (e) {
    cleanup();
    throw e;
  }
  const d = insertDispute({
    order_id: req.params.id,
    complaint: complaint.slice(0, 4000),
    // With no new photo, the buyer's inspection photo of what arrived is the evidence.
    photo_path: req.file?.path ?? order.inspection_photo_path ?? null,
    photo_mime: req.file?.mimetype ?? order.inspection_photo_mime ?? null,
  });
  const job = runInBackground(req.params.id, d.id);
  if (req.query.wait) await job;
  res.status(req.query.wait ? 200 : 202).json({ ...getDispute(d.id), order_state: getOrder(req.params.id).state });
});

disputes.get('/disputes/:id', (req, res) => {
  const d = getDispute(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  res.json({ ...d, order_state: getOrder(d.order_id)?.state });
});

disputes.get('/disputes/:id/photo', (req, res) => {
  const d = getDispute(req.params.id);
  if (!d?.photo_path || !fs.existsSync(d.photo_path)) return res.sendStatus(404);
  res.type(d.photo_mime).sendFile(path.resolve(d.photo_path));
});

/** Human reviewer resolves an escalated dispute. */
disputes.post('/disputes/:id/resolve', async (req, res) => {
  const d = getDispute(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  if (d.status !== 'ESCALATED') return res.status(409).json({ error: `Dispute is ${d.status}; only escalated disputes need a human` });
  const { decision, refund_amount, note } = req.body ?? {};
  if (!['release_full', 'partial_refund', 'refund_full'].includes(decision)) {
    return res.status(400).json({ error: 'decision must be release_full, partial_refund or refund_full' });
  }
  const { paypal } = await escrow.executeDecision(d.order_id, {
    decision,
    refundAmount: refund_amount,
    actor: 'human-reviewer',
    note: note ? `Human reviewer: ${note}` : `Human reviewer: ${decision}`,
  });
  const findings = { ...(d.findings ?? {}), human_decision: decision, human_note: note ?? null, agent_recommendation: d.findings?.proposed_decision ?? 'escalate_to_human' };
  const updated = updateDispute(d.id, {
    status: 'DECIDED',
    decision,
    refund_amount: decision === 'partial_refund' ? Number(refund_amount) : null,
    rationale: `${d.rationale ?? ''}\n\nResolved by a human reviewer: ${decision.replace('_', ' ')}${note ? ` — ${note}` : ''}.`.trim(),
    findings_json: JSON.stringify(findings),
    engine: `${d.engine} → human`,
    paypal_response_json: JSON.stringify(paypal),
    decided_at: now(),
  });
  res.json(updated);
});

/** Re-run the agent on an escalated dispute (e.g. after a transient API error). */
disputes.post('/disputes/:id/retry', async (req, res) => {
  const d = getDispute(req.params.id);
  if (!d) return res.status(404).json({ error: 'Dispute not found' });
  if (d.status !== 'ESCALATED' || getOrder(d.order_id).state !== 'DISPUTED') {
    return res.status(409).json({ error: 'Only escalated disputes on a still-disputed order can be re-run' });
  }
  updateDispute(d.id, { status: 'OPEN', error: null });
  const job = runInBackground(d.order_id, d.id);
  if (req.query.wait) await job;
  res.status(202).json(getDispute(d.id));
});

/** On boot, any dispute left RUNNING was interrupted by a restart: escalate it. */
export function recoverInterruptedDisputes(db) {
  const stuck = db.prepare("SELECT id FROM disputes WHERE status IN ('OPEN', 'RUNNING')").all();
  for (const { id } of stuck) {
    updateDispute(id, { status: 'ESCALATED', decision: 'escalate_to_human', error: 'Interrupted by a server restart before a decision; no money moved.', decided_at: now() });
  }
  if (stuck.length) console.warn(`[disputes] escalated ${stuck.length} interrupted dispute(s)`);
}
