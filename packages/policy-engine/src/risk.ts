export const policyReasonCodes = [
  'actor_identity_mismatch',
  'destructive_action',
  'expired_delegated_authority',
  'external_side_effect',
  'missing_delegated_authority',
  'non_idempotent_action',
  'production_environment',
  'restricted_data',
  'sensitive_data',
  'stale_evidence',
  'unrecognized_agent',
  'untrusted_tool_metadata',
  'write_capable_action',
  'workspace_explicit_deny',
] as const;

export type PolicyReasonCode = (typeof policyReasonCodes)[number];

export interface PolicyReason {
  code: PolicyReasonCode;
  message: string;
  score: number;
}

export interface RiskFactor extends PolicyReason {
  disposition: 'deny' | 'require_approval';
}

export const riskFactors = {
  actorIdentityMismatch: {
    code: 'actor_identity_mismatch',
    message: 'The authenticated actor does not match the passport agent.',
    score: 100,
    disposition: 'deny',
  },
  destructiveAction: {
    code: 'destructive_action',
    message: 'The tool declares a destructive operation.',
    score: 30,
    disposition: 'require_approval',
  },
  expiredDelegatedAuthority: {
    code: 'expired_delegated_authority',
    message: 'The delegated authority is expired or invalid.',
    score: 100,
    disposition: 'deny',
  },
  externalSideEffect: {
    code: 'external_side_effect',
    message: 'The tool declares an external side effect.',
    score: 20,
    disposition: 'require_approval',
  },
  missingDelegatedAuthority: {
    code: 'missing_delegated_authority',
    message:
      'The agent lacks delegated authority for the declared tool scopes.',
    score: 100,
    disposition: 'deny',
  },
  nonIdempotentAction: {
    code: 'non_idempotent_action',
    message: 'The tool does not declare idempotent execution.',
    score: 10,
    disposition: 'require_approval',
  },
  productionEnvironment: {
    code: 'production_environment',
    message: 'The action targets the production environment.',
    score: 25,
    disposition: 'require_approval',
  },
  restrictedData: {
    code: 'restricted_data',
    message: 'The tool declares data restricted by the workspace policy.',
    score: 40,
    disposition: 'deny',
  },
  sensitiveData: {
    code: 'sensitive_data',
    message: 'The tool declares sensitive data handling.',
    score: 20,
    disposition: 'require_approval',
  },
  staleEvidence: {
    code: 'stale_evidence',
    message: 'The passport evidence is missing or expired.',
    score: 100,
    disposition: 'deny',
  },
  unrecognizedAgent: {
    code: 'unrecognized_agent',
    message: 'The authenticated agent is not recognized by the workspace.',
    score: 100,
    disposition: 'deny',
  },
  untrustedToolMetadata: {
    code: 'untrusted_tool_metadata',
    message:
      'Tool metadata is missing, ambiguous, or not trusted by the workspace.',
    score: 100,
    disposition: 'deny',
  },
  writeCapableAction: {
    code: 'write_capable_action',
    message: 'The tool is not read-only.',
    score: 15,
    disposition: 'require_approval',
  },
  workspaceExplicitDeny: {
    code: 'workspace_explicit_deny',
    message: 'The workspace policy explicitly denies this tool or scope.',
    score: 100,
    disposition: 'deny',
  },
} as const satisfies Record<string, RiskFactor>;

export function scoreRiskFactors(factors: readonly RiskFactor[]): {
  reasons: PolicyReason[];
  riskScore: number;
} {
  return {
    reasons: factors.map(({ code, message, score }) => ({
      code,
      message,
      score,
    })),
    riskScore: Math.min(
      100,
      factors.reduce((total, factor) => total + factor.score, 0),
    ),
  };
}
