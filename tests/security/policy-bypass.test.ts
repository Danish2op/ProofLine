import { describe, expect, it } from 'vitest';

import type { ActionPassportV1 } from '../../packages/domain/src/action.js';
import {
  evaluatePolicy,
  type PolicyInput,
} from '../../packages/policy-engine/src/evaluate.js';

describe('policy bypass resistance', () => {
  it('rejects a forged client allow decision and recomputes the server-side denial', () => {
    const input = {
      passport: passport(),
      actor: {
        pubkey: 'a'.repeat(64),
        roles: ['agent'],
        recognized: false,
      },
      toolMetadata: {
        readOnly: true,
        destructive: false,
        idempotent: true,
        externalSideEffect: false,
        dataClasses: ['internal'],
        declaredScopes: ['sandbox.deploy'],
        definitionHash: 'c'.repeat(64),
      },
      workspacePolicy: {
        version: 'mvp-1',
        trustedToolDefinitionHashes: ['c'.repeat(64)],
      },
      now: new Date('2026-08-10T10:15:00.000Z'),
      decision: 'allow',
    } as unknown as PolicyInput;

    const decision = evaluatePolicy(input);

    expect(decision.decision).toBe('deny');
    expect(decision.reasons.map((reason) => reason.code)).toContain(
      'unrecognized_agent',
    );
  });
});

function passport(): ActionPassportV1 {
  return {
    schemaVersion: 1,
    status: 'DRAFT',
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
    normalizedArguments: { release: '2026.08.10' },
    environment: 'staging',
    risk: { level: 'low', reasons: [], score: 0 },
    evidence: [
      {
        collectedAt: '2026-08-10T10:00:00.000Z',
        contentHash: 'd'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
        evidenceId: 'build-20260810-01',
        expiresAt: '2026-08-10T11:00:00.000Z',
        source: 'synthetic CI run',
      },
    ],
    policySnapshot: {
      evaluatedAt: '2026-08-10T10:01:00.000Z',
      hash: 'e'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
      version: 'mvp-1',
    },
    approval: { required: false },
    idempotencyKey:
      'deploy-demo-web-20260810-01' as ActionPassportV1['idempotencyKey'],
    createdAt: '2026-08-10T10:02:00.000Z',
  };
}
