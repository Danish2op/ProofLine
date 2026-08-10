import { randomUUID } from 'node:crypto';

import { z, ZodError } from 'zod';

import { findJsonSafetyIssue } from '../../canonical/src/json-safe.js';
import { EvidenceSchema } from './evidence.js';
import {
  DomainValidationError,
  type DomainError,
  type Result,
} from './errors.js';
import { actionLifecycleStatuses } from './events.js';
import { PolicySnapshotSchema, RiskSchema } from './policy.js';

declare const brand: unique symbol;
type Brand<Value, Name extends string> = Value & {
  readonly [brand]: Name;
};

export type PassportHash = Brand<string, 'PassportHash'>;
export type EventId = Brand<string, 'EventId'>;
export type Pubkey = Brand<string, 'Pubkey'>;
export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type IdempotencyKey = Brand<string, 'IdempotencyKey'>;

export const PassportHashSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform((value) => value as PassportHash);
export const EventIdSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform((value) => value as EventId);
export const PubkeySchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/)
  .transform((value) => value as Pubkey);
export const WorkspaceIdSchema = z
  .string()
  .uuid()
  .transform((value) => value as WorkspaceId);
export const IdempotencyKeySchema = z
  .string()
  .min(1)
  .max(256)
  .transform((value) => value as IdempotencyKey);

const timestampSchema = z.string().refine(isIsoTimestamp, {
  message: 'Expected an ISO 8601 UTC timestamp with millisecond precision.',
});

const ApprovalSchema = z
  .object({
    approvedAt: timestampSchema.optional(),
    approvedBy: PubkeySchema.optional(),
    expiresAt: timestampSchema.optional(),
    required: z.boolean(),
  })
  .strict();

export const ActionPassportV1Schema = z
  .object({
    schemaVersion: z.literal(1),
    actionId: z.string().uuid(),
    workspaceId: WorkspaceIdSchema,
    agentPubkey: PubkeySchema,
    delegatedBy: PubkeySchema,
    toolName: z.string().min(1).max(128),
    toolDefinitionHash: PassportHashSchema,
    target: z.string().min(1).max(2_048),
    normalizedArguments: z.unknown(),
    environment: z.string().min(1).max(128),
    risk: RiskSchema,
    evidence: EvidenceSchema,
    policySnapshot: PolicySnapshotSchema,
    approval: ApprovalSchema,
    status: z.enum(actionLifecycleStatuses).default('DRAFT'),
    idempotencyKey: IdempotencyKeySchema,
    createdAt: timestampSchema,
  })
  .strict();

export type ActionPassportV1 = z.infer<typeof ActionPassportV1Schema>;
export type PassportPatch = Partial<
  Omit<ActionPassportV1, 'actionId' | 'createdAt' | 'schemaVersion'>
>;

export function validatePassport(
  passport: unknown,
): Result<ActionPassportV1, DomainError> {
  const parsed = ActionPassportV1Schema.safeParse(passport);
  if (!parsed.success) return { ok: false, error: toDomainError(parsed.error) };

  const jsonSafetyIssue = findJsonSafetyIssue(parsed.data, {
    maxArrayLength: 1_000,
    maxDepth: 32,
    maxObjectProperties: 1_000,
    maxStringLength: 16_384,
    requireNfc: true,
  });
  if (jsonSafetyIssue) return { ok: false, error: jsonSafetyIssue };

  return { ok: true, value: parsed.data };
}

export function createPassportRevision(
  previous: ActionPassportV1 | null,
  patch: PassportPatch,
): ActionPassportV1 {
  const candidate = {
    ...(previous === null ? {} : structuredClone(previous)),
    ...structuredClone(patch),
    actionId: randomUUID(),
    approval: { required: true },
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
    status: 'DRAFT',
  };
  const validated = validatePassport(candidate);
  if (!validated.ok) throw new DomainValidationError(validated.error);
  return validated.value;
}

function toDomainError(error: ZodError): DomainError {
  const issue = error.issues[0];
  const path = issue.path.join('.');
  if (issue.code === 'unrecognized_keys') {
    return {
      code: 'unknown_field',
      message: 'Passport contains an unknown field.',
      path,
    };
  }
  if (path === 'agentPubkey' || path === 'delegatedBy') {
    return {
      code: 'missing_identity',
      message: 'Passport requires valid delegated and agent identities.',
      path,
    };
  }
  if (issue.code === 'too_big') {
    return {
      code: 'too_large',
      message: 'Passport value exceeds its limit.',
      path,
    };
  }
  if (isTimestampPath(path)) {
    return {
      code: 'invalid_timestamp',
      message: 'Passport timestamp is invalid.',
      path,
    };
  }
  return { code: 'invalid_passport', message: issue.message, path };
}

function isTimestampPath(path: string): boolean {
  return /(?:At|expiresAt|collectedAt|evaluatedAt)$/.test(path);
}

function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) {
    return false;
  }
  const parsed = new Date(value);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString() === value;
}
