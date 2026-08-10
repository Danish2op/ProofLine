import { createHash } from 'node:crypto';

import { canonicalize } from './canonicalize.js';
import { hashCanonicalJson } from './hashing.js';

const secretKeyParts = [
  'apikey',
  'authorization',
  'bearer',
  'cookie',
  'credential',
  'password',
  'privatekey',
  'secret',
  'session',
  'token',
];
const secretContainers = new Set(['credentials', 'secrets']);
const secretPatterns = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
];

export interface RedactedPayload {
  protectedPayloadHash: string;
  redacted: unknown;
}

/**
 * Creates a display-safe representation without changing the verifiable hash
 * of the original payload. Labels are deterministic so repeated observations
 * of the same protected value remain correlatable without revealing it.
 */
export function redactForDisplay(payload: unknown): RedactedPayload {
  return {
    protectedPayloadHash: hashCanonicalJson(payload),
    redacted: redactValue(payload, false),
  };
}

function redactValue(value: unknown, forceSensitive: boolean): unknown {
  if (typeof value === 'string') {
    return forceSensitive || isSecretString(value) ? stableLabel(value) : value;
  }
  if (value === null || typeof value !== 'object') {
    return forceSensitive ? stableLabel(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, forceSensitive));
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const normalizedKey = normalizeKey(key);
      const redactNested =
        forceSensitive ||
        isSensitiveKey(normalizedKey) ||
        secretContainers.has(normalizedKey);
      return [key, redactValue(nestedValue, redactNested)];
    }),
  );
}

function isSecretString(value: string): boolean {
  return secretPatterns.some((pattern) => pattern.test(value));
}

function isSensitiveKey(normalizedKey: string): boolean {
  return secretKeyParts.some((part) => normalizedKey.includes(part));
}

function normalizeKey(key: string): string {
  return key.replaceAll(/[^a-z0-9]/gi, '').toLowerCase();
}

function stableLabel(value: unknown): string {
  const content = typeof value === 'string' ? value : canonicalize(value);
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return `[REDACTED:${digest.slice(0, 12)}]`;
}
