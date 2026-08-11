import { describe, expect, it } from 'vitest';

import type { PassportHash } from '../../../packages/domain/src/action.js';

import {
  ProposerAgent,
  VerifierAgent,
  type ProposalInput,
  type VerificationInput,
} from '../../../packages/agents/src/index.js';

const now = '2026-08-11T10:15:00.000Z';

describe('VerifierAgent', () => {
  it('approves a canonical staging proposal for review with high confidence', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());

    const result = await new VerifierAgent().verify(
      verificationInput(proposal),
    );

    expect(result).toMatchObject({
      decision: 'approve',
      confidence: 1,
      checkedPassportHash: proposal.passportHash,
      escalationReasons: [],
    });
  });

  it('rejects conflicting evidence claims and explains the escalation', async () => {
    const input = proposalInput();
    input.evidence.push({
      reference: {
        evidenceId: 'ci-conflict',
        source: 'synthetic CI retry',
        contentHash: 'e'.repeat(64) as PassportHash,
        collectedAt: '2026-08-11T10:05:00.000Z',
        expiresAt: '2026-08-11T11:00:00.000Z',
      },
      claims: [
        {
          claimId: 'tests-failed',
          subject: 'deployment-checks',
          value: 'failed',
          statement: 'A retry reported a failure.',
        },
      ],
      content: 'A retry reported a failure.',
    });
    const proposal = await new ProposerAgent().propose(input);

    const result = await new VerifierAgent().verify(
      verificationInput(proposal),
    );

    expect(result.decision).toBe('request_changes');
    expect(result.escalationReasons).toContain('conflicting_evidence');
  });

  it('rejects stale evidence and a changed authorized target', async () => {
    const proposal = await new ProposerAgent().propose(
      proposalInput({
        evidence: [
          {
            ...proposalInput().evidence[0],
            reference: {
              ...proposalInput().evidence[0].reference,
              expiresAt: '2026-08-11T10:14:59.999Z',
            },
          },
        ],
      }),
    );

    const result = await new VerifierAgent().verify(
      verificationInput(proposal, {
        authorizedTarget: 'sandbox://demo-web/other-staging',
      }),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toEqual(
      expect.arrayContaining(['stale_evidence', 'scope_expansion']),
    );
  });

  it('rejects an unknown tool instead of treating its internally consistent proposal as safe', async () => {
    const input = proposalInput({
      toolMetadata: {
        ...proposalInput().toolMetadata,
        definitionHash: 'f'.repeat(64),
      },
    });
    const proposal = await new ProposerAgent().propose(input);
    const result = await new VerifierAgent().verify(
      verificationInput(proposal, {
        toolMetadata: input.toolMetadata,
        workspacePolicy: input.workspacePolicy,
      }),
    );

    expect(result).toMatchObject({
      decision: 'reject',
      escalationReasons: ['policy_denied'],
    });
  });

  it('rejects missing citations, malformed output, and a mismatched hash', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const malformed = structuredClone(proposal) as unknown as Record<
      string,
      unknown
    >;
    malformed.claims = [{ claimId: 'uncited', statement: 'No evidence.' }];

    const uncited = await new VerifierAgent().verify(
      verificationInput(malformed),
    );
    const mismatched = await new VerifierAgent().verify(
      verificationInput({ ...proposal, passportHash: 'f'.repeat(64) }),
    );
    const malformedResult = await new VerifierAgent().verify(
      verificationInput({ malformed: true }),
    );

    expect(uncited.escalationReasons).toContain('missing_citation');
    expect(mismatched.escalationReasons).toContain('passport_hash_mismatch');
    expect(malformedResult).toMatchObject({
      decision: 'reject',
      escalationReasons: ['malformed_proposal'],
    });
  });

  it('rejects empty claims before approving', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const result = await new VerifierAgent().verify(
      verificationInput({ ...proposal, claims: [] }),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toContain('empty_claims');
  });

  it('rejects empty passport evidence before approving', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const withoutEvidence = {
      ...proposal,
      passport: { ...proposal.passport, evidence: [] },
    };
    const result = await new VerifierAgent().verify(
      verificationInput(withoutEvidence),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toContain('empty_evidence');
  });

  it('rejects omitted evidence facts and facts not bound to passport evidence IDs', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const missingFacts = await new VerifierAgent().verify(
      verificationInput({ ...proposal, evidenceFacts: [] }),
    );
    const unboundFact = await new VerifierAgent().verify(
      verificationInput({
        ...proposal,
        evidenceFacts: [
          { ...proposal.evidenceFacts[0], evidenceId: 'not-in-passport' },
        ],
      }),
    );

    expect(missingFacts.escalationReasons).toContain('missing_evidence_facts');
    expect(unboundFact.escalationReasons).toContain('unbound_evidence_fact');
  });

  it('rejects evidence facts that omit a cited evidence item or claim', async () => {
    const input = proposalInput({
      evidence: [
        ...proposalInput().evidence,
        {
          ...proposalInput().evidence[0],
          reference: {
            ...proposalInput().evidence[0].reference,
            evidenceId: 'ci-456',
          },
          claims: [
            {
              claimId: 'artifact-present',
              subject: 'artifact',
              value: 'present',
              statement: 'The artifact exists.',
            },
          ],
        },
      ],
    });
    const proposal = await new ProposerAgent().propose(input);
    const result = await new VerifierAgent().verify(
      verificationInput({
        ...proposal,
        evidenceFacts: proposal.evidenceFacts.filter(
          (fact) => fact.evidenceId !== 'ci-456',
        ),
      }),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toContain('evidence_fact_coverage');
  });

  it('rejects omission of one claim when two claims share an evidence fact value', async () => {
    const input = proposalInput({
      evidence: [
        {
          ...proposalInput().evidence[0],
          claims: [
            {
              claimId: 'primary-check',
              subject: 'deployment-checks',
              value: 'passed',
              statement: 'The primary check passed.',
            },
            {
              claimId: 'secondary-check',
              subject: 'deployment-checks',
              value: 'passed',
              statement: 'The secondary check passed.',
            },
          ],
        },
      ],
    });
    const proposal = await new ProposerAgent().propose(input);
    const result = await new VerifierAgent().verify(
      verificationInput({
        ...proposal,
        evidenceFacts: [proposal.evidenceFacts[0]],
      }),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toContain('evidence_fact_coverage');
  });

  it('rejects a NUL-containing evidence tuple that collides with a trusted fact', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const trustedFact = {
      ...proposal.evidenceFacts[0],
      subject: 'deployment-checks',
      value: 'passed\u0000verified',
    };
    const result = await new VerifierAgent().verify(
      verificationInput(
        {
          ...proposal,
          evidenceFacts: [
            {
              ...trustedFact,
              subject: 'deployment-checks\u0000passed',
              value: 'verified',
            },
          ],
        },
        { trustedEvidenceFacts: [trustedFact] },
      ),
    );

    expect(result.decision).toBe('reject');
    expect(result.escalationReasons).toContain('unbound_evidence_fact');
  });

  it('reuses an exact verification replay and rejects conflicting request reuse', async () => {
    const proposal = await new ProposerAgent().propose(proposalInput());
    const agent = new VerifierAgent();
    const input = verificationInput(proposal, { requestId: 'verify-replay-1' });

    expect(await agent.verify(input)).toBe(await agent.verify(input));
    await expect(
      agent.verify(
        verificationInput(proposal, {
          requestId: 'verify-replay-1',
          authorizedTarget: 'sandbox://other/staging',
        }),
      ),
    ).rejects.toMatchObject({ code: 'idempotency_conflict' });
  });
});

function verificationInput(
  proposal: unknown,
  overrides: Partial<VerificationInput> = {},
): VerificationInput {
  return {
    requestId: 'verify-safe-staging-1',
    proposal,
    now,
    authorizedTarget: 'sandbox://demo-web/staging',
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
    trustedEvidenceFacts:
      isRecord(proposal) && Array.isArray(proposal.evidenceFacts)
        ? (proposal.evidenceFacts as VerificationInput['trustedEvidenceFacts'])
        : [],
    ...overrides,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

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
