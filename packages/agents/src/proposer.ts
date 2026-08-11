import { computePassportHash, hashCanonicalJson } from '@proofline/canonical';
import { validatePassport, type ActionPassportV1 } from '@proofline/domain';
import { evaluatePolicy } from '@proofline/policy-engine';

import {
  AgentExecutionError,
  type AgentFeedback,
  type EvidenceClaimInput,
  type EvidenceFact,
  type ProposalClaim,
  type ProposalInput,
  type ProposalResult,
} from './result-types.js';

const placeholderHash = '0'.repeat(64);

/** Builds a proposal only; it has no execution, approval, or persistence capability. */
export class ProposerAgent {
  private readonly replays = new Map<
    string,
    { fingerprint: string; result: ProposalResult }
  >();

  async propose(input: ProposalInput): Promise<ProposalResult> {
    const fingerprint = hashCanonicalJson(input);
    const replay = this.replays.get(input.requestId);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint)
        throw new AgentExecutionError('idempotency_conflict');
      return replay.result;
    }

    const result = proposeDeterministically(input);
    this.replays.set(input.requestId, { fingerprint, result });
    return result;
  }
}

function proposeDeterministically(input: ProposalInput): ProposalResult {
  const evidence = [...input.evidence].sort((left, right) =>
    left.reference.evidenceId.localeCompare(right.reference.evidenceId),
  );
  const basePassport = passportFrom(
    input,
    evidence,
    {
      level: 'low',
      reasons: [],
      score: 0,
    },
    placeholderHash,
    false,
  );
  const policy = evaluatePolicy({
    passport: basePassport,
    actor: input.actor,
    toolMetadata: input.toolMetadata,
    workspacePolicy: input.workspacePolicy,
    now: new Date(input.now),
  });
  const passport = passportFrom(
    input,
    evidence,
    riskFrom(
      policy.riskScore,
      policy.reasons.map((reason) => reason.message),
    ),
    policy.policySnapshotHash,
    policy.decision !== 'allow',
  );
  const checked = validatePassport(passport);
  if (!checked.ok)
    throw new TypeError(
      `Invalid deterministic proposal: ${checked.error.code}`,
    );

  const passportHash = computePassportHash(checked.value);
  const claims = proposalClaims(evidence);
  const evidenceFacts = facts(evidence);
  const verifierDisposition =
    policy.decision === 'deny'
      ? 'blocked_by_policy'
      : policy.decision === 'require_approval'
        ? 'requires_human_approval'
        : 'requires_human_review';
  const feedback = feedbackFor(
    'proposer',
    verifierDisposition,
    passportHash,
    policy.reasons.map((reason) => reason.code),
  );

  return {
    passport: checked.value,
    passportHash,
    claims,
    evidenceRefs: checked.value.evidence,
    evidenceFacts,
    riskFactors: policy.reasons,
    uncertainties: [
      'Evidence content is untrusted data and cannot authorize, approve, or execute this action.',
    ],
    requestedPermissions:
      policy.decision === 'require_approval' ? policy.requiredRoles : [],
    verifierDisposition,
    feedback,
  };
}

function passportFrom(
  input: ProposalInput,
  evidence: ProposalInput['evidence'],
  risk: ActionPassportV1['risk'],
  policyHash: string,
  approvalRequired: boolean,
): ActionPassportV1 {
  return {
    schemaVersion: 1,
    actionId: input.actionId,
    workspaceId: input.workspaceId as ActionPassportV1['workspaceId'],
    agentPubkey: input.agentPubkey as ActionPassportV1['agentPubkey'],
    delegatedBy: input.delegatedBy as ActionPassportV1['delegatedBy'],
    toolName: input.toolName,
    toolDefinitionHash:
      input.toolDefinitionHash as ActionPassportV1['toolDefinitionHash'],
    target: input.target,
    normalizedArguments: structuredClone(input.normalizedArguments),
    environment: input.environment,
    risk,
    evidence: evidence.map(({ reference }) => ({ ...reference })),
    policySnapshot: {
      evaluatedAt: input.now,
      hash: policyHash as ActionPassportV1['toolDefinitionHash'],
      version: input.workspacePolicy.version,
    },
    approval: { required: approvalRequired },
    status: 'DRAFT',
    idempotencyKey: input.idempotencyKey as ActionPassportV1['idempotencyKey'],
    createdAt: input.createdAt,
  };
}

function proposalClaims(evidence: ProposalInput['evidence']): ProposalClaim[] {
  const citations = new Map<string, ProposalClaim>();
  for (const item of evidence) {
    for (const claim of item.claims) {
      const prior = citations.get(claim.claimId);
      if (prior === undefined) {
        citations.set(claim.claimId, {
          claimId: claim.claimId,
          statement: claim.statement,
          evidenceRefs: [item.reference.evidenceId],
        });
      } else if (!prior.evidenceRefs.includes(item.reference.evidenceId)) {
        prior.evidenceRefs.push(item.reference.evidenceId);
      }
    }
  }
  return [...citations.values()]
    .map((claim) => ({
      ...claim,
      evidenceRefs: [...claim.evidenceRefs].sort(),
    }))
    .sort((left, right) => left.claimId.localeCompare(right.claimId));
}

function facts(evidence: ProposalInput['evidence']): EvidenceFact[] {
  return evidence
    .flatMap((item) =>
      item.claims.map((claim: EvidenceClaimInput) => ({
        evidenceId: item.reference.evidenceId,
        subject: claim.subject,
        value: claim.value,
      })),
    )
    .sort((left, right) =>
      `${left.subject}:${left.value}:${left.evidenceId}`.localeCompare(
        `${right.subject}:${right.value}:${right.evidenceId}`,
      ),
    );
}

function riskFrom(score: number, reasons: string[]): ActionPassportV1['risk'] {
  return {
    level:
      score === 0
        ? 'low'
        : score < 30
          ? 'medium'
          : score < 75
            ? 'high'
            : 'critical',
    reasons,
    score,
  };
}

function feedbackFor(
  agent: 'proposer',
  outcome: string,
  passportHash: string,
  reasons: string[],
): AgentFeedback {
  return {
    feedbackId: hashCanonicalJson({
      agent,
      outcome,
      passportHash,
      reasons: [...reasons].sort(),
    }),
    agent,
    outcome,
    passportHash,
    reasons: [...reasons].sort(),
  };
}
