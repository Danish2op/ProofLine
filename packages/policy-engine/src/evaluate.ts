import type { ActionPassportV1 } from '@proofline/domain';

import { scoreRiskFactors, type PolicyReason } from './risk.js';
import {
  evaluateRules,
  type Actor,
  type Role,
  type ToolMetadata,
  type WorkspacePolicy,
} from './rules.js';

export type {
  Actor,
  DataClass,
  Role,
  ToolMetadata,
  WorkspacePolicy,
} from './rules.js';
export type { PolicyReason } from './risk.js';

export interface PolicyInput {
  passport: ActionPassportV1;
  actor: Actor;
  toolMetadata: ToolMetadata;
  workspacePolicy: WorkspacePolicy;
  now: Date;
}

export interface PolicyDecision {
  decision: 'allow' | 'require_approval' | 'deny';
  reasons: PolicyReason[];
  requiredRoles: Role[];
  riskScore: number;
  policySnapshotHash: string;
}

/** Evaluates the fixed MVP policy solely from server-authoritative inputs. */
export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const ruleEvaluation = evaluateRules(input);
  const { reasons, riskScore } = scoreRiskFactors(ruleEvaluation.factors);
  const hasDeny = ruleEvaluation.factors.some(
    (factor) => factor.disposition === 'deny',
  );
  const requiresApproval = ruleEvaluation.factors.some(
    (factor) => factor.disposition === 'require_approval',
  );

  return {
    decision: hasDeny
      ? 'deny'
      : requiresApproval
        ? 'require_approval'
        : 'allow',
    reasons,
    requiredRoles:
      hasDeny || !requiresApproval ? [] : ruleEvaluation.requiredRoles,
    riskScore,
    policySnapshotHash: ruleEvaluation.policySnapshotHash,
  };
}
