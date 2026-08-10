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
  /\bnsec1[023456789acdefghjklmnpqrstuvwxyz]{20,}\b/,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\bsb_(?:secret|publishable)_[A-Za-z0-9_-]{16,}\b/,
  /\bsbp_[A-Za-z0-9_-]{16,}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{16,}\b/,
  /\bBearer\s+[A-Za-z0-9._~+/=-]{16,}\b/i,
];

export interface RedactedPayload {
  protectedPayloadHash: string;
  redacted: unknown;
}

export type SensitivePath = readonly (string | number)[];

export interface RedactionOptions {
  /**
   * Explicit sensitivity metadata for values whose syntax is ambiguous. For
   * example, use `[[]]` for a sensitive root value or `[[0]]` for the first
   * sensitive array element. Bare 64-hex strings remain visible by default
   * because they can be public Nostr identifiers or Proofline audit hashes.
   */
  sensitivePaths?: readonly SensitivePath[];
}

/**
 * Creates a display-safe representation without changing the verifiable hash
 * of the original payload. Labels are deterministic so repeated observations
 * of the same protected value remain correlatable without revealing it. Callers
 * must provide sensitivePaths for syntax-ambiguous values such as raw hex keys.
 */
export function redactForDisplay(
  payload: unknown,
  options: RedactionOptions = {},
): RedactedPayload {
  const sensitivePaths = new Set(
    options.sensitivePaths?.map(serializePath) ?? [],
  );
  return {
    protectedPayloadHash: hashCanonicalJson(payload),
    redacted: redactValue(payload, false, [], sensitivePaths),
  };
}

function redactValue(
  value: unknown,
  forceSensitive: boolean,
  path: SensitivePath,
  sensitivePaths: ReadonlySet<string>,
): unknown {
  const redactHere = forceSensitive || sensitivePaths.has(serializePath(path));
  if (typeof value === 'string') {
    return redactHere || isSecretString(value) ? stableLabel(value) : value;
  }
  if (value === null || typeof value !== 'object') {
    return redactHere ? stableLabel(value) : value;
  }
  if (Array.isArray(value)) {
    return value.map((item, index) =>
      redactValue(item, redactHere, [...path, index], sensitivePaths),
    );
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => {
      const normalizedKey = normalizeKey(key);
      const redactNested =
        redactHere ||
        isSensitiveKey(normalizedKey) ||
        secretContainers.has(normalizedKey);
      return [
        key,
        redactValue(nestedValue, redactNested, [...path, key], sensitivePaths),
      ];
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

function serializePath(path: SensitivePath): string {
  return JSON.stringify(path);
}

function stableLabel(value: unknown): string {
  const content = typeof value === 'string' ? value : canonicalize(value);
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return `[REDACTED:${digest.slice(0, 12)}]`;
}
