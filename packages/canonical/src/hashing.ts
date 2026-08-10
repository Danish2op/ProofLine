import { createHash } from 'node:crypto';

import { canonicalize } from './canonicalize.js';

export type HashablePassport = Record<string, unknown>;

export function computePassportHash(passport: HashablePassport): string {
  return hashCanonicalJson(passport);
}

export function hashCanonicalJson(value: unknown): string {
  return createHash('sha256').update(canonicalize(value), 'utf8').digest('hex');
}
