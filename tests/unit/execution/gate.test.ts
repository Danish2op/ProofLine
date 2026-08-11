import { computePassportHash } from '@proofline/canonical';
import type { ActionPassportV1 } from '@proofline/domain';
import { describe, expect, it } from 'vitest';
import { ExecutionGate } from '../../../packages/execution/src/gate.ts';

const now = '2026-08-11T12:00:00.000Z';

describe('ExecutionGate', () => {
  it('allows only an exact, approved, unexpired passport', () => {
    const passport = validPassport();
    const hash = computePassportHash(passport);

    expect(
      new ExecutionGate().validate({
        passport,
        approvedPassportHash: hash,
        approvedTarget: passport.target,
        approvedArguments: passport.normalizedArguments,
        approval: {
          approvedBy: 'reviewer-1',
          approvedAt: '2026-08-11T11:00:00.000Z',
          expiresAt: '2026-08-11T13:00:00.000Z',
        },
        executorIdentity: 'worker-1',
        authorizedExecutorIdentity: 'worker-1',
        now,
      }),
    ).toEqual({ ok: true, passportHash: hash });
  });

  it.each([
    ['changed target', { target: 'sandbox://production' }],
    ['changed arguments', { normalizedArguments: { release: 'tampered' } }],
    ['changed tool hash', { toolDefinitionHash: 'f'.repeat(64) }],
    ['changed evidence', { evidence: [] }],
    [
      'changed policy',
      {
        policySnapshot: {
          evaluatedAt: now,
          hash: 'f'.repeat(64),
          version: 'changed',
        },
      },
    ],
  ])('rejects %s', (_name, change) => {
    const approved = validPassport();
    const changed = { ...approved, ...change } as ActionPassportV1;
    const result = new ExecutionGate().validate({
      passport: changed,
      approvedPassportHash: computePassportHash(approved),
      approvedTarget: approved.target,
      approvedArguments: approved.normalizedArguments,
      approval: {
        approvedBy: 'reviewer-1',
        approvedAt: '2026-08-11T11:00:00.000Z',
        expiresAt: '2026-08-11T13:00:00.000Z',
      },
      executorIdentity: 'worker-1',
      authorizedExecutorIdentity: 'worker-1',
      now,
    });
    expect(result.ok).toBe(false);
  });

  it.each([
    ['expired approval', { expiresAt: '2026-08-11T11:59:59.999Z' }],
    ['missing approval', null],
    ['wrong executor', { executorIdentity: 'worker-2' }],
  ])('rejects %s', (_name, change) => {
    const passport = validPassport();
    const hash = computePassportHash(passport);
    const result = new ExecutionGate().validate({
      passport,
      approvedPassportHash: hash,
      approvedTarget: passport.target,
      approvedArguments: passport.normalizedArguments,
      approval:
        change && 'expiresAt' in change
          ? {
              approvedBy: 'reviewer-1',
              approvedAt: '2026-08-11T11:00:00.000Z',
              expiresAt: change.expiresAt,
            }
          : change === null
            ? null
            : {
                approvedBy: 'reviewer-1',
                approvedAt: '2026-08-11T11:00:00.000Z',
                expiresAt: '2026-08-11T13:00:00.000Z',
              },
      executorIdentity:
        change && 'executorIdentity' in change
          ? change.executorIdentity
          : 'worker-1',
      authorizedExecutorIdentity: 'worker-1',
      now,
    });
    expect(result.ok).toBe(false);
  });
});

function validPassport(): ActionPassportV1 {
  return {
    schemaVersion: 1,
    actionId: '4b136918-d3bc-4ee2-a7f5-0dc9f25c5c87',
    workspaceId:
      'b6bf1e8d-5f5e-47a7-9c8b-6497afb94bb5' as ActionPassportV1['workspaceId'],
    agentPubkey: 'a'.repeat(64) as ActionPassportV1['agentPubkey'],
    delegatedBy: 'b'.repeat(64) as ActionPassportV1['delegatedBy'],
    toolName: 'sandbox.deploy',
    toolDefinitionHash: 'c'.repeat(
      64,
    ) as ActionPassportV1['toolDefinitionHash'],
    target: 'sandbox://demo-web/staging',
    normalizedArguments: { release: '2026.08.11' },
    environment: 'staging',
    risk: { level: 'low', reasons: [], score: 0 },
    evidence: [
      {
        evidenceId: 'ci-123',
        source: 'synthetic CI',
        contentHash: 'd'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
        collectedAt: '2026-08-11T10:00:00.000Z',
        expiresAt: '2026-08-11T14:00:00.000Z',
      },
    ],
    policySnapshot: {
      evaluatedAt: '2026-08-11T10:15:00.000Z',
      hash: 'e'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
      version: 'mvp-1',
    },
    approval: { required: true },
    status: 'PENDING_APPROVAL',
    idempotencyKey:
      'deploy-demo-web-20260811-01' as ActionPassportV1['idempotencyKey'],
    createdAt: '2026-08-11T10:15:00.000Z',
  };
}
