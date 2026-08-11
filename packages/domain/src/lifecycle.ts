import type { ActionLifecycleStatus } from './events.js';
import { isValidLifecycleTransition } from './events.js';

export interface ApprovalBinding {
  eventId: string;
  approvedBy: string;
  approvedAt: string;
  expiresAt: string;
}

export interface ActionState {
  actionId: string;
  workspaceId: string;
  passportHash: string;
  status: ActionLifecycleStatus;
  version: number;
  approval?: ApprovalBinding;
}

export interface LifecycleActor {
  type: 'human' | 'agent' | 'worker' | 'system';
  id: string | null;
}

export interface TransitionInput {
  state: ActionState;
  to: ActionLifecycleStatus;
  expectedVersion: number;
  commandId: string;
  actor: LifecycleActor;
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
  approval?: ApprovalBinding;
  failure?: { retryable: boolean; reason: string };
}

export interface LifecycleAuditRecord {
  eventId: string;
  eventType: 'ACTION_TRANSITIONED' | 'ACTION_RETRY_SCHEDULED';
  aggregateId: string;
  workspaceId: string;
  beforeStatus: ActionLifecycleStatus;
  afterStatus: ActionLifecycleStatus;
  beforeVersion: number;
  afterVersion: number;
  actor: LifecycleActor;
  correlationId: string;
  causationId: string | null;
  occurredAt: string;
  metadata: Record<string, string | boolean>;
}

export interface LifecycleError {
  code:
    | 'invalid_transition'
    | 'terminal_state'
    | 'stale_version'
    | 'approval_required'
    | 'approval_expired'
    | 'invalid_failure';
  message: string;
  retryable: boolean;
  details?: Record<string, string | number>;
}

export type TransitionResult =
  | { ok: true; value: { state: ActionState; audit: LifecycleAuditRecord } }
  | { ok: false; error: LifecycleError };

const terminalStatuses = new Set<ActionLifecycleStatus>([
  'SUCCEEDED',
  'FAILED',
  'EXPIRED',
  'REVOKED',
  'BLOCKED',
]);

export function transitionAction(input: TransitionInput): TransitionResult {
  const { state } = input;
  if (input.expectedVersion !== state.version) {
    return failure('stale_version', 'Action state version is stale.', true, {
      expected: input.expectedVersion,
      actual: state.version,
    });
  }

  if (terminalStatuses.has(state.status)) {
    return failure(
      'terminal_state',
      `Action is terminal in ${state.status}.`,
      false,
    );
  }

  const retryableFailure = input.failure?.retryable === true;
  if (retryableFailure) {
    if (state.status !== 'EXECUTING' || input.to !== 'EXECUTING') {
      return failure(
        'invalid_failure',
        'Retryable failures may only be recorded while executing.',
        false,
      );
    }
  } else if (!isValidLifecycleTransition(state.status, input.to)) {
    return failure(
      'invalid_transition',
      `Action cannot transition from ${state.status} to ${input.to}.`,
      false,
    );
  }

  const approval = input.to === 'APPROVED' ? input.approval : state.approval;
  if (input.to === 'APPROVED' && approval === undefined) {
    return failure(
      'approval_required',
      'An approval transition requires a verified approval binding.',
      false,
    );
  }
  if (
    (input.to === 'APPROVED' || input.to === 'EXECUTING') &&
    approval !== undefined &&
    approval.expiresAt <= input.occurredAt
  ) {
    return failure(
      'approval_expired',
      'The approval binding is already expired.',
      false,
    );
  }
  if (input.to === 'EXECUTING') {
    if (approval === undefined) {
      return failure(
        'approval_required',
        'Execution requires a verified approval binding.',
        false,
      );
    }
  }

  const next: ActionState = {
    ...state,
    status: input.to,
    version: state.version + 1,
    ...(approval === undefined ? {} : { approval }),
  };
  const audit: LifecycleAuditRecord = {
    eventId: `${state.actionId}:${next.version}:${input.commandId}`,
    eventType: retryableFailure
      ? 'ACTION_RETRY_SCHEDULED'
      : 'ACTION_TRANSITIONED',
    aggregateId: state.actionId,
    workspaceId: state.workspaceId,
    beforeStatus: state.status,
    afterStatus: next.status,
    beforeVersion: state.version,
    afterVersion: next.version,
    actor: input.actor,
    correlationId: input.correlationId,
    causationId: input.causationId,
    occurredAt: input.occurredAt,
    metadata: retryableFailure
      ? { retryable: true, reason: input.failure?.reason ?? '' }
      : {},
  };
  return { ok: true, value: { state: next, audit } };
}

export function createRevisionState(
  previous: ActionState,
  passportHash: string,
  actionId: string,
): ActionState {
  return {
    actionId,
    workspaceId: previous.workspaceId,
    passportHash,
    status: 'DRAFT',
    version: 0,
    approval: undefined,
  };
}

function failure(
  code: LifecycleError['code'],
  message: string,
  retryable: boolean,
  details?: Record<string, string | number>,
): TransitionResult {
  return { ok: false, error: { code, message, retryable, details } };
}
