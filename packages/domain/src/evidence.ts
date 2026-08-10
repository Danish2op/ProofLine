import { z } from 'zod';

import type { PassportHash } from './action.js';

const hashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform((value) => value as PassportHash);

const timestampSchema = z.string().refine(isIsoTimestamp, {
  message: 'Expected an ISO 8601 UTC timestamp with millisecond precision.',
});

export const EvidenceItemSchema = z
  .object({
    collectedAt: timestampSchema,
    contentHash: hashSchema,
    evidenceId: z.string().min(1).max(128),
    expiresAt: timestampSchema.optional(),
    source: z.string().min(1).max(256),
  })
  .strict();

export type EvidenceItem = z.infer<typeof EvidenceItemSchema>;

export const EvidenceSchema = z.array(EvidenceItemSchema).max(100);

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
