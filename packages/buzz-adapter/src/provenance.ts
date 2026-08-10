import {
  isValidLifecycleTransition,
  type ActionLifecycleStatus,
} from '@proofline/domain';

import type { ApprovalObservation } from './approval-parser.js';

export type ProvenanceRecordStatus = 'stored' | 'duplicate';

export interface ApprovalTransitionResult {
  status: 'applied' | 'duplicate' | 'recorded_unapplied';
  nextStatus: ActionLifecycleStatus | null;
}

/**
 * Small deterministic projection used by workers after their database
 * transaction has loaded the current passport state. Each event ID is retained
 * before a transition is considered, so a relay replay cannot apply twice.
 */
export class EventProvenanceLayer {
  private readonly seenEventIds = new Set<string>();

  recordEvent(eventId: string): ProvenanceRecordStatus {
    if (this.seenEventIds.has(eventId)) return 'duplicate';
    this.seenEventIds.add(eventId);
    return 'stored';
  }

  recordApproval(
    observation: ApprovalObservation,
    currentStatus: ActionLifecycleStatus,
  ): ApprovalTransitionResult {
    if (this.recordEvent(observation.eventId) === 'duplicate') {
      return { status: 'duplicate', nextStatus: null };
    }

    const nextStatus = lifecycleStatusFor(observation.decision);
    if (
      currentStatus !== 'PENDING_APPROVAL' ||
      !nextStatus ||
      !isValidLifecycleTransition(currentStatus, nextStatus)
    ) {
      return { status: 'recorded_unapplied', nextStatus: null };
    }
    return { status: 'applied', nextStatus };
  }
}

export type BuzzFailureCode =
  | 'network_timeout'
  | 'relay_unavailable'
  | 'invalid_signature'
  | 'unauthorized_signer'
  | 'malformed_event'
  | 'policy_denied';

export function isRetryableBuzzFailure(code: BuzzFailureCode): boolean {
  return code === 'network_timeout' || code === 'relay_unavailable';
}

function lifecycleStatusFor(
  decision: ApprovalObservation['decision'],
): ActionLifecycleStatus | null {
  if (decision === 'approve') return 'APPROVED';
  if (decision === 'reject') return 'BLOCKED';
  return null;
}
