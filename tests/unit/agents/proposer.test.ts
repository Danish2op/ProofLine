import { describe, expect, it } from 'vitest';

import type { PassportHash } from '../../../packages/domain/src/action.js';

import {
  ProposerAgent,
  type ProposalInput,
} from '../../../packages/agents/src/index.js';

const now = '2026-08-11T10:15:00.000Z';

describe('ProposerAgent', () => {
  it('produces a canonical, evidence-backed staging proposal with a stable hash', async () => {
    const agent = new ProposerAgent();

    const first = await agent.propose(proposalInput());
    const second = await agent.propose({
      ...proposalInput(),
      evidence: [...proposalInput().evidence].reverse(),
    });

    expect(first.passportHash).toMatch(/^[0-9a-f]{64}$/);
    expect(second.passportHash).toBe(first.passportHash);
    expect(first.passport).toMatchObject({
      status: 'DRAFT',
      target: 'sandbox://demo-web/staging',
      approval: { required: false },
      risk: { level: 'low', score: 0 },
    });
    expect(first.claims).toEqual([
      {
        claimId: 'tests-passed',
        evidenceRefs: ['ci-123'],
        statement: 'The synthetic deployment checks passed.',
      },
    ]);
    expect(first.requestedPermissions).toEqual([]);
  });

  it('requests a human approval role for a production deployment without approving itself', async () => {
    const proposal = await new ProposerAgent().propose(
      proposalInput({
        environment: 'production',
        target: 'sandbox://demo-web/production',
      }),
    );

    expect(proposal.passport.approval).toEqual({ required: true });
    expect(proposal.requestedPermissions).toEqual(['owner']);
    expect(proposal.verifierDisposition).toBe('requires_human_approval');
    expect(proposal.passport.risk.reasons).toEqual([
      'The action targets the production environment.',
    ]);
  });

  it('reuses an exact request replay and rejects conflicting request reuse', async () => {
    const agent = new ProposerAgent();
    const input = proposalInput({ requestId: 'proposal-replay-1' });

    expect(await agent.propose(input)).toBe(await agent.propose(input));
    await expect(
      agent.propose(
        proposalInput({
          requestId: 'proposal-replay-1',
          target: 'sandbox://different-target/staging',
        }),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});

function proposalInput(overrides: Partial<ProposalInput> = {}): ProposalInput {
  return {
    requestId: 'proposal-safe-staging-1',
    actionId: '4b136918-d3bc-4ee2-a7f5-0dc9f25c5c87',
    workspaceId: 'b6bf1e8d-5f5e-47a7-9c8b-6497afb94bb5',
    agentPubkey: 'a'.repeat(64),
    delegatedBy: 'b'.repeat(64),
    toolName: 'sandbox.deploy',
    toolDefinitionHash: 'c'.repeat(64),
    target: 'sandbox://demo-web/staging',
    normalizedArguments: { release: '2026.08.11' },
    environment: 'staging',
    idempotencyKey: 'deploy-demo-web-20260811-01',
    createdAt: now,
    now,
    actor: {
      pubkey: 'a'.repeat(64),
      roles: ['agent'],
      recognized: true,
      delegatedAuthority: {
        delegatedBy: 'b'.repeat(64),
        scopes: ['sandbox.deploy'],
        expiresAt: '2026-08-11T11:00:00.000Z',
      },
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
    evidence: [
      {
        reference: {
          evidenceId: 'ci-123',
          source: 'synthetic CI run',
          contentHash: 'd'.repeat(64) as PassportHash,
          collectedAt: '2026-08-11T10:00:00.000Z',
          expiresAt: '2026-08-11T11:00:00.000Z',
        },
        claims: [
          {
            claimId: 'tests-passed',
            subject: 'deployment-checks',
            value: 'passed',
            statement: 'The synthetic deployment checks passed.',
          },
        ],
        content: 'All deployment checks passed.',
      },
    ],
    ...overrides,
  };
}
