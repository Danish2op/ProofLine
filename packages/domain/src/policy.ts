import { z } from 'zod';

import type { PassportHash } from './action.js';

const hashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform((value) => value as PassportHash);

const timestampSchema = z.string().refine(isIsoTimestamp, {
  message: 'Expected an ISO 8601 UTC timestamp with millisecond precision.',
});

export const RiskSchema = z
  .object({
    level: z.enum(['low', 'medium', 'high', 'critical']),
    reasons: z.array(z.string().min(1).max(256)).max(32),
    score: z.number().finite().min(0).max(100),
  })
  .strict();

export type Risk = z.infer<typeof RiskSchema>;

export const PolicySnapshotSchema = z
  .object({
    evaluatedAt: timestampSchema,
    hash: hashSchema,
    version: z.string().min(1).max(128),
  })
  .strict();

export type PolicySnapshot = z.infer<typeof PolicySnapshotSchema>;

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
