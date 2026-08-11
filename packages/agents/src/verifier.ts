import { computePassportHash, hashCanonicalJson } from '@proofline/canonical';
import { validatePassport, type ActionPassportV1 } from '@proofline/domain';
import { evaluatePolicy } from '@proofline/policy-engine';

import {
  AgentExecutionError,
  type AgentFeedback,
  type EvidenceFact,
  type ProposalClaim,
  type ProposalResult,
  type VerificationFinding,
  type VerificationInput,
  type VerificationResult,
} from './result-types.js';

/** Independently validates an immutable proposal; it cannot approve, execute, or persist it. */
export class VerifierAgent {
  private readonly replays = new Map<
    string,
    { fingerprint: string; result: VerificationResult }
  >();

  async verify(input: VerificationInput): Promise<VerificationResult> {
    const fingerprint = hashCanonicalJson(input);
    const replay = this.replays.get(input.requestId);
    if (replay !== undefined) {
      if (replay.fingerprint !== fingerprint)
        throw new AgentExecutionError('idempotency_conflict');
      return replay.result;
    }

    const result = verifyDeterministically(input);
    this.replays.set(input.requestId, { fingerprint, result });
    return result;
  }
}

function verifyDeterministically(input: VerificationInput): VerificationResult {
  const proposal = parseProposal(input.proposal);
  if (proposal === null)
    return rejection(
      [
        finding(
          'malformed_proposal',
          'The proposal does not match the canonical result shape.',
        ),
      ],
      null,
    );

  const validation = validatePassport(proposal.passport);
  if (!validation.ok)
    return rejection(
      [finding('malformed_proposal', 'The proposed passport is not valid.')],
      null,
    );

  const passport = validation.value;
  const checkedPassportHash = computePassportHash(passport);
  const findings: VerificationFinding[] = [];
  if (proposal.passportHash !== checkedPassportHash) {
    findings.push(
      finding(
        'passport_hash_mismatch',
        'The supplied passport hash does not match the canonical passport.',
      ),
    );
  }
  if (passport.target !== input.authorizedTarget) {
    findings.push(
      finding(
        'scope_expansion',
        'The proposal target differs from the server-authorized target.',
      ),
    );
  }
  if (passport.evidence.length === 0) {
    findings.push(
      finding('empty_evidence', 'A proposal must contain passport evidence.'),
    );
  }
  if (proposal.claims.length === 0) {
    findings.push(
      finding('empty_claims', 'A proposal must contain at least one claim.'),
    );
  }
  if (proposal.evidenceFacts.length === 0) {
    findings.push(
      finding(
        'missing_evidence_facts',
        'Evidence facts are required to independently check conflicts.',
      ),
    );
  }
  findings.push(...citationFindings(proposal.claims, passport));
  findings.push(
    ...conflictFindings(
      proposal.evidenceFacts,
      new Set(passport.evidence.map((item) => item.evidenceId)),
    ),
  );

  const policy = evaluatePolicy({
    passport,
    actor: input.actor,
    toolMetadata: input.toolMetadata,
    workspacePolicy: input.workspacePolicy,
    now: new Date(input.now),
  });
  if (
    policy.policySnapshotHash !== passport.policySnapshot.hash ||
    policy.riskScore !== passport.risk.score ||
    passport.approval.required !== (policy.decision !== 'allow')
  ) {
    findings.push(
      finding(
        'policy_mismatch',
        'The passport policy snapshot, risk, or approval request is inconsistent with independent evaluation.',
      ),
    );
  }
  if (policy.reasons.some((reason) => reason.code === 'stale_evidence')) {
    findings.push(
      finding(
        'stale_evidence',
        'At least one cited evidence reference is expired or missing.',
      ),
    );
  }
  if (policy.decision === 'deny') {
    findings.push(
      finding(
        'policy_denied',
        'Independent policy evaluation denies this proposal.',
      ),
    );
  }

  if (findings.length === 0) return approval(checkedPassportHash);
  const hardReject = findings.some((entry) =>
    [
      'malformed_proposal',
      'empty_claims',
      'empty_evidence',
      'missing_evidence_facts',
      'passport_hash_mismatch',
      'policy_denied',
      'policy_mismatch',
      'scope_expansion',
      'stale_evidence',
      'unbound_evidence_fact',
    ].includes(entry.code),
  );
  return rejection(
    findings,
    checkedPassportHash,
    hardReject ? 'reject' : 'request_changes',
  );
}

function parseProposal(value: unknown): ProposalResult | null {
  if (
    !isRecord(value) ||
    !isRecord(value.passport) ||
    typeof value.passportHash !== 'string'
  )
    return null;
  if (!Array.isArray(value.claims) || !Array.isArray(value.evidenceFacts))
    return null;
  return value as unknown as ProposalResult;
}

function citationFindings(
  claims: ProposalClaim[],
  passport: ActionPassportV1,
): VerificationFinding[] {
  const evidenceIds = new Set(passport.evidence.map((item) => item.evidenceId));
  const missing = claims.some(
    (claim) =>
      !isRecord(claim) ||
      typeof claim.claimId !== 'string' ||
      typeof claim.statement !== 'string' ||
      !Array.isArray(claim.evidenceRefs) ||
      claim.evidenceRefs.length === 0 ||
      claim.evidenceRefs.some(
        (reference) =>
          typeof reference !== 'string' || !evidenceIds.has(reference),
      ),
  );
  return missing
    ? [
        finding(
          'missing_citation',
          'Every claim must cite one or more passport evidence references.',
        ),
      ]
    : [];
}

function conflictFindings(
  facts: EvidenceFact[],
  evidenceIds: Set<string>,
): VerificationFinding[] {
  const values = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (
      !isRecord(fact) ||
      typeof fact.subject !== 'string' ||
      typeof fact.value !== 'string'
    ) {
      return [finding('malformed_proposal', 'Evidence facts are malformed.')];
    }
    if (!evidenceIds.has(fact.evidenceId)) {
      return [
        finding(
          'unbound_evidence_fact',
          'Every evidence fact must reference a passport evidence ID.',
        ),
      ];
    }
    const observed = values.get(fact.subject) ?? new Set<string>();
    observed.add(fact.value);
    values.set(fact.subject, observed);
  }
  return [...values.values()].some((observed) => observed.size > 1)
    ? [
        finding(
          'conflicting_evidence',
          'Evidence asserts conflicting values for the same subject.',
        ),
      ]
    : [];
}

function approval(passportHash: string): VerificationResult {
  return {
    decision: 'approve',
    confidence: 1,
    checkedPassportHash: passportHash,
    findings: [],
    escalationReasons: [],
    requiredHumanQuestions: [
      'Does the human reviewer approve this exact passport hash?',
    ],
    feedback: feedbackFor('approve', passportHash, []),
  };
}

function rejection(
  findings: VerificationFinding[],
  passportHash: string | null,
  decision: 'reject' | 'request_changes' = 'reject',
): VerificationResult {
  const reasons = findings.map((entry) => entry.code).sort();
  return {
    decision,
    confidence: decision === 'reject' ? 1 : 0.8,
    checkedPassportHash: passportHash,
    findings,
    escalationReasons: reasons,
    requiredHumanQuestions: [
      'Resolve the verifier findings before requesting human approval.',
    ],
    feedback: feedbackFor(decision, passportHash, reasons),
  };
}

function finding(
  code: VerificationFinding['code'],
  message: string,
): VerificationFinding {
  return { code, message };
}

function feedbackFor(
  outcome: string,
  passportHash: string | null,
  reasons: string[],
): AgentFeedback {
  return {
    feedbackId: hashCanonicalJson({
      agent: 'verifier',
      outcome,
      passportHash,
      reasons,
    }),
    agent: 'verifier',
    outcome,
    passportHash,
    reasons,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
