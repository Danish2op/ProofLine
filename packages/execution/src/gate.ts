import { computePassportHash, hashCanonicalJson } from '@proofline/canonical';
import type { ActionPassportV1 } from '@proofline/domain';

export interface ExecutionApproval {
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface ExecutionInput {
  passport: ActionPassportV1;
  approvedPassportHash: string;
  approvedTarget: string;
  approvedArguments: unknown;
  approval: ExecutionApproval | null;
  executorIdentity: string;
  authorizedExecutorIdentity: string;
  now: string;
}

export type GateDecision =
  | { ok: true; passportHash: string }
  | { ok: false; code: string; message: string };

/** Rechecks every approval-bound value immediately before a provider call. */
export class ExecutionGate {
  validate(input: ExecutionInput): GateDecision {
    if (input.passport.status === 'REVOKED')
      return deny('revoked_action', 'The action has been revoked.');
    if (input.approval === null || !input.passport.approval.required)
      return deny('approval_required', 'A current human approval is required.');
    const now = Date.parse(input.now);
    const expiresAt = Date.parse(input.approval.expiresAt);
    if (
      !Number.isFinite(now) ||
      !Number.isFinite(expiresAt) ||
      now >= expiresAt
    )
      return deny('approval_expired', 'The human approval is expired.');
    if (input.executorIdentity !== input.authorizedExecutorIdentity)
      return deny('wrong_executor', 'The executor identity is not authorized.');
    if (input.passport.target !== input.approvedTarget)
      return deny(
        'target_changed',
        'The target differs from the approved target.',
      );
    if (
      hashCanonicalJson(input.passport.normalizedArguments) !==
      hashCanonicalJson(input.approvedArguments)
    )
      return deny(
        'arguments_changed',
        'The arguments differ from the approved arguments.',
      );
    const passportHash = computePassportHash(input.passport);
    if (passportHash !== input.approvedPassportHash)
      return deny('passport_changed', 'The passport changed after approval.');
    return { ok: true, passportHash };
  }
}

function deny(code: string, message: string): GateDecision {
  return { ok: false, code, message };
}
