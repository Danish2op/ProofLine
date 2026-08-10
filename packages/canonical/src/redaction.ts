import { createHash } from 'node:crypto';

import { canonicalize } from './canonicalize.js';
import { hashCanonicalJson } from './hashing.js';

const sensitiveKey =
  /(?:api[_-]?key|authorization|credential|password|private[_-]?key|secret|token)/i;

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
    redacted: redactValue(payload),
  };
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!isRecord(value)) return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [
      key,
      sensitiveKey.test(key)
        ? stableLabel(nestedValue)
        : redactValue(nestedValue),
    ]),
  );
}

function stableLabel(value: unknown): string {
  const content = typeof value === 'string' ? value : canonicalize(value);
  const digest = createHash('sha256').update(content, 'utf8').digest('hex');
  return `[REDACTED:${digest.slice(0, 12)}]`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
