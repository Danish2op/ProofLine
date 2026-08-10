import { describe, expect, it } from 'vitest';

import type { ActionPassportV1 } from '../../../packages/domain/src/action.js';
import {
  evaluatePolicy,
  type Actor,
  type PolicyInput,
  type ToolMetadata,
  type WorkspacePolicy,
} from '../../../packages/policy-engine/src/evaluate.js';

const now = new Date('2026-08-10T10:15:00.000Z');

describe('evaluatePolicy', () => {
  it('auto-allows a trusted read-only staging action', () => {
    const decision = evaluatePolicy(policyInput());

    expect(decision).toMatchObject({
      decision: 'allow',
      reasons: [],
      requiredRoles: [],
      riskScore: 0,
    });
    expect(decision.policySnapshotHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('requires owner approval for a destructive action and records its risk', () => {
    const decision = evaluatePolicy(
      policyInput({
        toolMetadata: { destructive: true, readOnly: false },
      }),
    );

    expect(decision).toMatchObject({
      decision: 'require_approval',
      requiredRoles: ['owner'],
      riskScore: 30,
      reasons: [
        {
          code: 'destructive_action',
          score: 30,
        },
      ],
    });
  });

  it('requires owner approval for a non-read-only action without destructive annotations', () => {
    const decision = evaluatePolicy(
      policyInput({ toolMetadata: { readOnly: false } }),
    );

    expect(decision).toMatchObject({
      decision: 'require_approval',
      requiredRoles: ['owner'],
      riskScore: 15,
      reasons: [{ code: 'write_capable_action', score: 15 }],
    });
  });

  it('requires approval for a production action even when it is read-only', () => {
    const decision = evaluatePolicy(
      policyInput({ passport: { environment: 'production' } }),
    );

    expect(decision).toMatchObject({
      decision: 'require_approval',
      requiredRoles: ['owner'],
      riskScore: 25,
      reasons: [{ code: 'production_environment', score: 25 }],
    });
  });

  it('denies access to workspace-restricted data', () => {
    const decision = evaluatePolicy(
      policyInput({
        toolMetadata: { dataClasses: ['restricted'] },
        workspacePolicy: { restrictedDataClasses: ['restricted'] },
      }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'restricted_data', score: 40 }],
      riskScore: 40,
    });
  });

  it('denies missing or malformed tool metadata instead of treating it as safe', () => {
    const decision = evaluatePolicy({
      ...policyInput(),
      toolMetadata: undefined as unknown as ToolMetadata,
    });

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'untrusted_tool_metadata', score: 100 }],
      riskScore: 100,
    });
  });

  it('denies an action with expired evidence', () => {
    const decision = evaluatePolicy(
      policyInput({
        passport: {
          evidence: [
            {
              ...passport().evidence[0],
              expiresAt: '2026-08-10T10:14:59.999Z',
            },
          ],
        },
      }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'stale_evidence', score: 100 }],
      riskScore: 100,
    });
  });

  it('denies an action with an invalid evidence expiry timestamp', () => {
    const decision = evaluatePolicy(
      policyInput({
        passport: {
          evidence: [
            {
              ...passport().evidence[0],
              expiresAt: 'not-a-timestamp',
            },
          ],
        },
      }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'stale_evidence', score: 100 }],
    });
  });

  it('denies an unrecognized agent', () => {
    const decision = evaluatePolicy(
      policyInput({ actor: { recognized: false } }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'unrecognized_agent', score: 100 }],
      riskScore: 100,
    });
  });

  it('denies an agent without matching delegated authority', () => {
    const decision = evaluatePolicy(
      policyInput({ actor: { delegatedAuthority: undefined } }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'missing_delegated_authority', score: 100 }],
      riskScore: 100,
    });
  });

  it('uses a canonical policy snapshot hash independent of policy object key order', () => {
    const first = evaluatePolicy(
      policyInput({
        workspacePolicy: {
          version: 'mvp-1',
          restrictedDataClasses: ['confidential'],
          deniedToolNames: ['sandbox.destroy'],
        },
      }),
    );
    const second = evaluatePolicy(
      policyInput({
        workspacePolicy: {
          deniedToolNames: ['sandbox.destroy'],
          restrictedDataClasses: ['confidential'],
          version: 'mvp-1',
        },
      }),
    );

    expect(first.policySnapshotHash).toBe(second.policySnapshotHash);
  });

  it('gives an explicit workspace deny precedence over an approval requirement', () => {
    const decision = evaluatePolicy(
      policyInput({
        toolMetadata: { destructive: true, readOnly: false },
        workspacePolicy: { deniedToolNames: ['sandbox.deploy'] },
      }),
    );

    expect(decision.decision).toBe('deny');
    expect(decision.reasons.map((reason) => reason.code)).toEqual(
      expect.arrayContaining(['workspace_explicit_deny', 'destructive_action']),
    );
  });

  it('gives a production approval requirement precedence over a read-only allow', () => {
    const decision = evaluatePolicy(
      policyInput({ passport: { environment: 'production' } }),
    );

    expect(decision.decision).toBe('require_approval');
  });

  it('never defaults ambiguous metadata to an allow decision', () => {
    const decision = evaluatePolicy({
      ...policyInput(),
      toolMetadata: {
        ...toolMetadata(),
        externalSideEffect: 'false',
      } as unknown as ToolMetadata,
    });

    expect(decision.decision).toBe('deny');
    expect(decision.reasons.map((reason) => reason.code)).toContain(
      'untrusted_tool_metadata',
    );
  });

  it('denies metadata with no declared scopes as ambiguous', () => {
    const decision = evaluatePolicy(
      policyInput({ toolMetadata: { declaredScopes: [] } }),
    );

    expect(decision).toMatchObject({
      decision: 'deny',
      reasons: [{ code: 'untrusted_tool_metadata', score: 100 }],
    });
  });
});

function policyInput(
  overrides: {
    actor?: Partial<Actor>;
    passport?: Partial<ActionPassportV1>;
    toolMetadata?: Partial<ToolMetadata>;
    workspacePolicy?: Partial<WorkspacePolicy>;
  } = {},
): PolicyInput {
  const currentPassport = { ...passport(), ...overrides.passport };
  const currentToolMetadata = { ...toolMetadata(), ...overrides.toolMetadata };

  return {
    passport: currentPassport,
    actor: {
      ...actor(currentPassport, currentToolMetadata),
      ...overrides.actor,
    },
    toolMetadata: currentToolMetadata,
    workspacePolicy: {
      version: 'mvp-1',
      trustedToolDefinitionHashes: [currentToolMetadata.definitionHash],
      ...overrides.workspacePolicy,
    },
    now,
  };
}

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

function actor(
  currentPassport: ActionPassportV1,
  currentToolMetadata: ToolMetadata,
): Actor {
  return {
    pubkey: currentPassport.agentPubkey,
    roles: ['agent'],
    recognized: true,
    delegatedAuthority: {
      delegatedBy: currentPassport.delegatedBy,
      scopes: currentToolMetadata.declaredScopes,
    },
  };
}

function toolMetadata(): ToolMetadata {
  return {
    readOnly: true,
    destructive: false,
    idempotent: true,
    externalSideEffect: false,
    dataClasses: ['internal'],
    declaredScopes: ['sandbox.deploy'],
    definitionHash: 'c'.repeat(64),
  };
}
