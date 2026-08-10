import { randomUUID } from 'node:crypto';

import { z, ZodError } from 'zod';

import { EvidenceSchema } from './evidence.js';
import {
  DomainValidationError,
  type DomainError,
  type Result,
} from './errors.js';
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

  const deterministicError = findDeterminismError(parsed.data);
  if (deterministicError) return { ok: false, error: deterministicError };

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
    createdAt: new Date().toISOString(),
    schemaVersion: 1,
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

function findDeterminismError(value: unknown, path = ''): DomainError | null {
  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) {
      return {
        code: 'invalid_unicode',
        message:
          'Passport strings cannot contain unpaired surrogate code units.',
        path,
      };
    }
    if (value.length > 16_384) {
      return {
        code: 'too_large',
        message: 'Passport string exceeds its limit.',
        path,
      };
    }
    return null;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    return {
      code: 'non_deterministic_value',
      message: 'Passport numbers must be finite.',
      path,
    };
  }
  if (value === null || typeof value !== 'object') return null;
  if (Array.isArray(value)) {
    if (value.length > 1_000) {
      return {
        code: 'too_large',
        message: 'Passport array exceeds its limit.',
        path,
      };
    }
    return value.reduce<DomainError | null>(
      (error, item, index) =>
        error ?? findDeterminismError(item, joinPath(path, index)),
      null,
    );
  }

  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return {
      code: 'non_deterministic_value',
      message: 'Passport values must be plain JSON objects.',
      path,
    };
  }

  const entries = Object.entries(value);
  if (entries.length > 1_000) {
    return {
      code: 'too_large',
      message: 'Passport object exceeds its limit.',
      path,
    };
  }
  for (const [key, nestedValue] of entries) {
    if (hasUnpairedSurrogate(key)) {
      return {
        code: 'invalid_unicode',
        message:
          'Passport object keys cannot contain unpaired surrogate code units.',
        path,
      };
    }
    const error = findDeterminismError(nestedValue, joinPath(path, key));
    if (error) return error;
  }
  return null;
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

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

function joinPath(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}
