import { describe, expect, it } from 'vitest';

import {
  createPassportRevision,
  validatePassport,
} from '../../../packages/domain/src/action.js';
import { isValidLifecycleTransition } from '../../../packages/domain/src/events.js';
import { computePassportHash } from '../../../packages/canonical/src/hashing.js';

function validPassport() {
  return {
    schemaVersion: 1,
    actionId: '4b136918-d3bc-4ee2-a7f5-0dc9f25c5c87',
    workspaceId: 'b6bf1e8d-5f5e-47a7-9c8b-6497afb94bb5',
    agentPubkey: 'a'.repeat(64),
    delegatedBy: 'b'.repeat(64),
    toolName: 'sandbox.deploy',
    toolDefinitionHash: 'c'.repeat(64),
    target: 'sandbox://demo-web/staging',
    normalizedArguments: { dryRun: false, release: '2026.08.10' },
    environment: 'staging',
    risk: {
      level: 'medium',
      reasons: ['External deployment'],
      score: 42,
    },
    evidence: [
      {
        collectedAt: '2026-08-10T10:00:00.000Z',
        contentHash: 'd'.repeat(64),
        evidenceId: 'build-20260810-01',
        expiresAt: '2026-08-10T11:00:00.000Z',
        source: 'synthetic CI run',
      },
    ],
    policySnapshot: {
      evaluatedAt: '2026-08-10T10:01:00.000Z',
      hash: 'e'.repeat(64),
      version: '2026.08.10',
    },
    approval: {
      expiresAt: '2026-08-10T10:30:00.000Z',
      required: true,
    },
    idempotencyKey: 'deploy-demo-web-20260810-01',
    createdAt: '2026-08-10T10:02:00.000Z',
  };
}

describe('validatePassport', () => {
  it('accepts a complete version 1 passport', () => {
    const result = validatePassport(validPassport());

    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.value.target).toBe('sandbox://demo-web/staging');
  });

  it('rejects a missing agent identity', () => {
    const result = validatePassport({ ...validPassport(), agentPubkey: '' });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'missing_identity', path: 'agentPubkey' },
    });
  });

  it('rejects unknown security-sensitive fields', () => {
    const result = validatePassport({
      ...validPassport(),
      signedBy: 'attacker',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unknown_field' },
    });
  });

  it.each([
    ['risk', { ...validPassport().risk, clientOverride: 'allow' }],
    ['approval', { ...validPassport().approval, reviewerRole: 'owner' }],
  ])('rejects unknown nested %s fields', (field, value) => {
    const result = validatePassport({ ...validPassport(), [field]: value });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'unknown_field' },
    });
  });

  it('rejects oversized targets before they enter the domain', () => {
    const result = validatePassport({
      ...validPassport(),
      target: 'x'.repeat(2_049),
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'too_large', path: 'target' },
    });
  });

  it('rejects invalid Unicode before it can create an ambiguous passport hash', () => {
    const result = validatePassport({
      ...validPassport(),
      target: `sandbox://${String.fromCharCode(0xd800)}`,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_unicode', path: 'target' },
    });
  });

  it('rejects invalid Unicode in normalized argument keys', () => {
    const result = validatePassport({
      ...validPassport(),
      normalizedArguments: { [String.fromCharCode(0xd800)]: 'value' },
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_unicode', path: 'normalizedArguments' },
    });
  });

  it('rejects non-NFC Unicode before canonical hashing', () => {
    const result = validatePassport({
      ...validPassport(),
      target: 'sandbox://Cafe\u0301',
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'invalid_unicode', path: 'target' },
    });
  });

  it.each([
    ['undefined', undefined],
    ['function', () => 'side effect'],
    ['symbol', Symbol('secret')],
    ['bigint', BigInt(1)],
  ])(
    'rejects normalized arguments containing %s because they cannot be hashed',
    (_name, value) => {
      const passport = {
        ...validPassport(),
        normalizedArguments: { value },
      };

      expect(() => computePassportHash(passport)).toThrow();
      expect(validatePassport(passport)).toMatchObject({
        ok: false,
        error: { code: 'non_deterministic_value' },
      });
    },
  );

  it.each([
    ['oversized string', { value: 'x'.repeat(16_385) }],
    ['oversized array', { value: Array.from({ length: 1_001 }, () => 0) }],
    [
      'oversized object',
      {
        value: Object.fromEntries(
          Array.from({ length: 1_001 }, (_, index) => [index, index]),
        ),
      },
    ],
    ['deeply nested value', nestValue(33)],
  ])('rejects normalized arguments with %s', (_name, normalizedArguments) => {
    const result = validatePassport({
      ...validPassport(),
      normalizedArguments,
    });

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'too_large' },
    });
  });

  it('rejects runtime objects that canonical JSON cannot represent', () => {
    const passport = {
      ...validPassport(),
      normalizedArguments: {
        generatedAt: new Date('2026-08-10T00:00:00.000Z'),
      },
    };

    expect(() => computePassportHash(passport)).toThrow();
    expect(validatePassport(passport)).toMatchObject({
      ok: false,
      error: { code: 'non_deterministic_value' },
    });
  });

  it('rejects invalid timestamps and non-deterministic values', () => {
    const badTimestamp = validatePassport({
      ...validPassport(),
      createdAt: '2026-08-10 10:02:00',
    });
    const nonFiniteNumber = validatePassport({
      ...validPassport(),
      normalizedArguments: { retries: Number.NaN },
    });

    expect(badTimestamp).toMatchObject({
      ok: false,
      error: { code: 'invalid_timestamp', path: 'createdAt' },
    });
    expect(nonFiniteNumber).toMatchObject({
      ok: false,
      error: {
        code: 'non_deterministic_value',
        path: 'normalizedArguments.retries',
      },
    });
  });
});

describe('createPassportRevision', () => {
  it('creates a new action ID without mutating the earlier passport', () => {
    const parsedPrevious = validatePassport(validPassport());
    if (!parsedPrevious.ok) throw new Error('fixture must be valid');
    const previous = parsedPrevious.value;
    const revision = createPassportRevision(previous, {
      target: 'sandbox://demo-web/production',
    });

    expect(revision.actionId).not.toBe(previous.actionId);
    expect(previous.target).toBe('sandbox://demo-web/staging');
    expect(revision.target).toBe('sandbox://demo-web/production');
    expect(revision.approval).not.toBe(previous.approval);
    expect(computePassportHash(revision)).not.toBe(
      computePassportHash(previous),
    );
  });

  it('invalidates prior approval and returns the revision to DRAFT', () => {
    const parsedPrevious = validatePassport(validPassport());
    if (!parsedPrevious.ok) throw new Error('fixture must be valid');
    const previous = {
      ...parsedPrevious.value,
      approval: {
        approvedAt: '2026-08-10T10:03:00.000Z',
        approvedBy: parsedPrevious.value.agentPubkey,
        expiresAt: '2026-08-10T10:30:00.000Z',
        required: true,
      },
    };

    const revision = createPassportRevision(previous, {
      target: 'sandbox://demo-web/production',
    });

    expect(revision).toMatchObject({
      approval: { required: true },
      status: 'DRAFT',
    });
    expect(revision.approval).not.toHaveProperty('approvedAt');
    expect(revision.approval).not.toHaveProperty('approvedBy');
    expect(revision.approval).not.toHaveProperty('expiresAt');
  });

  it('creates a valid DRAFT passport when there is no previous revision', () => {
    const parsedPrevious = validatePassport(validPassport());
    if (!parsedPrevious.ok) throw new Error('fixture must be valid');
    const { actionId, createdAt, schemaVersion, status, ...patch } =
      parsedPrevious.value;

    const revision = createPassportRevision(null, patch);

    expect(revision.actionId).not.toBe(actionId);
    expect(revision.createdAt).not.toBe(createdAt);
    expect(revision.schemaVersion).toBe(schemaVersion);
    expect(revision.status).toBe('DRAFT');
    expect(revision.approval).toEqual({ required: true });
    expect(status).toBe('DRAFT');
  });
});

describe('action lifecycle transitions', () => {
  it.each([
    ['DRAFT', 'CHALLENGE_REQUIRED'],
    ['CHALLENGE_REQUIRED', 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', 'APPROVED'],
    ['APPROVED', 'EXECUTING'],
    ['EXECUTING', 'SUCCEEDED'],
    ['EXECUTING', 'FAILED'],
    ['PENDING_APPROVAL', 'EXPIRED'],
    ['APPROVED', 'REVOKED'],
    ['DRAFT', 'BLOCKED'],
  ] as const)('allows %s to %s', (from, to) => {
    expect(isValidLifecycleTransition(from, to)).toBe(true);
  });

  it('rejects backwards transitions', () => {
    expect(isValidLifecycleTransition('APPROVED', 'PENDING_APPROVAL')).toBe(
      false,
    );
  });

  it.each(['SUCCEEDED', 'FAILED', 'EXPIRED', 'REVOKED', 'BLOCKED'] as const)(
    'treats %s as terminal',
    (status) => {
      expect(isValidLifecycleTransition(status, 'DRAFT')).toBe(false);
      expect(isValidLifecycleTransition(status, 'EXECUTING')).toBe(false);
    },
  );
});

function nestValue(depth: number): Record<string, unknown> {
  let value: Record<string, unknown> = { leaf: true };
  for (let index = 0; index < depth; index += 1) {
    value = { value };
  }
  return value;
}
