import type { ActionPassportV1, EvidenceItem } from '@proofline/domain';
import type {
  Actor,
  PolicyDecision,
  ToolMetadata,
  WorkspacePolicy,
} from '@proofline/policy-engine';

export const agentCapabilities = {
  proposer: {
    dataAccess: ['structured_evidence', 'tool_metadata', 'workspace_policy'],
    prohibitedActions: [
      'approve_action',
      'execute_tool',
      'mutate_lifecycle_status',
      'persist_directly',
    ],
  },
  verifier: {
    dataAccess: [
      'action_passport',
      'structured_evidence',
      'tool_metadata',
      'workspace_policy',
    ],
    prohibitedActions: [
      'approve_action',
      'execute_tool',
      'mutate_lifecycle_status',
      'persist_directly',
    ],
  },
} as const;

export interface EvidenceClaimInput {
  claimId: string;
  statement: string;
  subject: string;
  value: string;
}

/** Raw content is untrusted evidence data and is never interpreted as instructions. */
export interface StructuredEvidence {
  reference: EvidenceItem;
  claims: EvidenceClaimInput[];
  content?: string;
}

export interface ProposalInput {
  requestId: string;
  actionId: string;
  workspaceId: string;
  agentPubkey: string;
  delegatedBy: string;
  toolName: string;
  toolDefinitionHash: string;
  target: string;
  normalizedArguments: unknown;
  environment: string;
  idempotencyKey: string;
  createdAt: string;
  now: string;
  actor: Actor;
  toolMetadata: ToolMetadata;
  workspacePolicy: WorkspacePolicy;
  evidence: StructuredEvidence[];
}

export interface ProposalClaim {
  claimId: string;
  statement: string;
  evidenceRefs: string[];
}

export interface EvidenceFact {
  evidenceId: string;
  subject: string;
  value: string;
}

export interface AgentFeedback {
  feedbackId: string;
  agent: 'proposer' | 'verifier';
  outcome: string;
  passportHash: string | null;
  reasons: string[];
}

export interface ProposalResult {
  passport: ActionPassportV1;
  passportHash: string;
  claims: ProposalClaim[];
  evidenceRefs: EvidenceItem[];
  evidenceFacts: EvidenceFact[];
  riskFactors: PolicyDecision['reasons'];
  uncertainties: string[];
  requestedPermissions: string[];
  verifierDisposition:
    'blocked_by_policy' | 'requires_human_approval' | 'requires_human_review';
  feedback: AgentFeedback;
}

export interface VerificationInput {
  requestId: string;
  proposal: unknown;
  now: string;
  authorizedTarget: string;
  actor: Actor;
  toolMetadata: ToolMetadata;
  workspacePolicy: WorkspacePolicy;
}

export interface VerificationFinding {
  code:
    | 'conflicting_evidence'
    | 'malformed_proposal'
    | 'missing_citation'
    | 'passport_hash_mismatch'
    | 'policy_denied'
    | 'policy_mismatch'
    | 'scope_expansion'
    | 'stale_evidence';
  message: string;
}

export interface VerificationResult {
  decision: 'approve' | 'reject' | 'request_changes';
  confidence: number;
  checkedPassportHash: string | null;
  findings: VerificationFinding[];
  escalationReasons: VerificationFinding['code'][];
  requiredHumanQuestions: string[];
  feedback: AgentFeedback;
}

export interface OptionalProvider {
  run(): Promise<unknown>;
}

export interface OptionalProviderRun<T> {
  fallback: () => Promise<T>;
  provider?: OptionalProvider;
  /** Parses untrusted provider output before it may be shown as optional advice. */
  parse?: (output: unknown) => unknown | null;
  retries: number;
  timeoutMs: number;
}

export interface OptionalProviderResult<T> {
  value: T;
  providerFailure?: {
    code: 'provider_failure' | 'provider_timeout';
    attempts: number;
  };
}

export class AgentExecutionError extends Error {
  constructor(public readonly code: 'idempotency_conflict') {
    super('Agent request ID was already used with a different input.');
    this.name = 'AgentExecutionError';
  }
}
