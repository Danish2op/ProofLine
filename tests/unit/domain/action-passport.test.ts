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

  it('rejects backwards and terminal-state transitions', () => {
    expect(isValidLifecycleTransition('APPROVED', 'PENDING_APPROVAL')).toBe(
      false,
    );
    expect(isValidLifecycleTransition('SUCCEEDED', 'EXECUTING')).toBe(false);
    expect(isValidLifecycleTransition('EXPIRED', 'APPROVED')).toBe(false);
    expect(isValidLifecycleTransition('REVOKED', 'EXECUTING')).toBe(false);
    expect(isValidLifecycleTransition('BLOCKED', 'PENDING_APPROVAL')).toBe(
      false,
    );
  });
});
