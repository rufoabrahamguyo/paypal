// Seller identity verification. Runs when a seller submits their National ID.
//
// These are automated document checks, not a government ID lookup: the number
// must be well formed and not already used by another shop, all three photos
// must be present, real-sized images, and three different pictures. A pass
// marks the seller verified straight away; the audit desk can still reject a
// seller later with a note, which sends them back to fix it.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { config } from './config.js';
import { getSellerDocument, IDENTITY_KINDS, nationalIdInUse, setKyc, kycFor } from './db.js';

const MIN_BYTES = 2048;
const LABEL = { id_front: 'the front of the ID', id_back: 'the back of the ID', face: 'the photo of your face' };

export const normalizeId = (raw) => String(raw || '').toUpperCase().replace(/[\s-]/g, '');
const hashId = (id) => crypto.createHmac('sha256', config.kycSecret).update(id).digest('hex');

export function verifyIdentity(sellerId, rawNumber) {
  const issues = [];
  const current = kycFor(sellerId);
  const number = normalizeId(rawNumber);
  let hash = null;
  if (number) {
    if (!/^[A-Z0-9]{6,12}$/.test(number)) issues.push('The National ID number should be 6 to 12 letters or digits.');
    else {
      hash = hashId(number);
      if (nationalIdInUse(hash, sellerId)) issues.push('That National ID number is already used by another shop.');
    }
  } else if (!current.national_id_last4) {
    issues.push('Enter your National ID number.');
  }

  const digests = new Map();
  for (const kind of IDENTITY_KINDS) {
    const doc = getSellerDocument(sellerId, kind);
    if (!doc || !fs.existsSync(doc.file_path)) {
      issues.push(`Upload ${LABEL[kind]}.`);
      continue;
    }
    const bytes = fs.readFileSync(doc.file_path);
    if (bytes.length < MIN_BYTES) issues.push(`The picture of ${LABEL[kind]} is too small to read. Take a clearer photo.`);
    const digest = crypto.createHash('sha256').update(bytes).digest('hex');
    if (digests.has(digest)) issues.push(`The picture of ${LABEL[kind]} is the same file as ${LABEL[digests.get(digest)]}.`);
    else digests.set(digest, kind);
  }

  return setKyc(sellerId, {
    status: issues.length ? 'rejected' : 'verified',
    note: issues.length ? issues.join(' ') : null,
    last4: hash ? number.slice(-4) : undefined,
    hash: hash ?? undefined,
  });
}
