import { describe, expect, it } from 'vitest';

import {
  createRevisionState,
  transitionAction,
  type ActionState,
} from '../../../packages/domain/src/lifecycle.js';

const now = '2026-08-11T10:00:00.000Z';
const workspaceId = '00000000-0000-4000-8000-000000000001';

function actionState(status: ActionState['status'] = 'DRAFT'): ActionState {
  return {
    actionId: '00000000-0000-4000-8000-000000000010',
    workspaceId,
    passportHash: 'a'.repeat(64),
    status,
    version: 3,
    approval: undefined,
  };
}

function transition(
  state: ActionState,
  to: ActionState['status'],
  overrides: Partial<Parameters<typeof transitionAction>[0]> = {},
) {
  return transitionAction({
    state,
    to,
    expectedVersion: state.version,
    commandId: 'command-1',
    actor: { type: 'worker', id: 'worker-1' },
    correlationId: 'correlation-1',
    causationId: 'cause-1',
    occurredAt: now,
    ...overrides,
  });
}

describe('transitionAction', () => {
  it.each([
    ['DRAFT', 'CHALLENGE_REQUIRED'],
    ['DRAFT', 'PENDING_APPROVAL'],
    ['CHALLENGE_REQUIRED', 'PENDING_APPROVAL'],
    ['PENDING_APPROVAL', 'APPROVED'],
    ['APPROVED', 'EXECUTING'],
    ['EXECUTING', 'SUCCEEDED'],
    ['EXECUTING', 'FAILED'],
    ['APPROVED', 'REVOKED'],
    ['PENDING_APPROVAL', 'EXPIRED'],
    ['DRAFT', 'BLOCKED'],
  ] as const)('moves monotonically from %s to %s', (from, to) => {
    const state = actionState(from);
    const result = transition(state, to, {
      ...(to === 'APPROVED'
        ? {
            approval: {
              eventId: 'b'.repeat(64),
              approvedBy: 'c'.repeat(64),
              approvedAt: now,
              expiresAt: '2026-08-11T11:00:00.000Z',
            },
          }
        : {}),
      ...(from === 'APPROVED'
        ? {
            state: {
              ...state,
              approval: {
                eventId: 'b'.repeat(64),
                approvedBy: 'c'.repeat(64),
                approvedAt: now,
                expiresAt: '2026-08-11T11:00:00.000Z',
              },
            },
          }
        : {}),
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        state: { status: to, version: 4 },
        audit: {
          aggregateId: state.actionId,
          beforeStatus: from,
          afterStatus: to,
          correlationId: 'correlation-1',
          causationId: 'cause-1',
          occurredAt: now,
        },
      },
    });
  });

  it('rejects skipped, duplicate, reverse, and terminal transitions', () => {
    expect(transition(actionState('DRAFT'), 'APPROVED')).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition', retryable: false },
    });
    expect(transition(actionState('APPROVED'), 'APPROVED')).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition', retryable: false },
    });
    expect(
      transition(actionState('APPROVED'), 'PENDING_APPROVAL'),
    ).toMatchObject({
      ok: false,
      error: { code: 'invalid_transition', retryable: false },
    });
    expect(transition(actionState('SUCCEEDED'), 'EXECUTING')).toMatchObject({
      ok: false,
      error: { code: 'terminal_state', retryable: false },
    });
  });

  it('rejects stale state versions without emitting an audit event', () => {
    const result = transition(actionState(), 'PENDING_APPROVAL', {
      expectedVersion: 2,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'stale_version',
        retryable: true,
        details: { expected: 2, actual: 3 },
      },
    });
  });

  it('rejects execution when approval has expired', () => {
    const state = {
      ...actionState('APPROVED'),
      approval: {
        eventId: 'b'.repeat(64),
        approvedBy: 'c'.repeat(64),
        approvedAt: '2026-08-11T08:00:00.000Z',
        expiresAt: '2026-08-11T09:00:00.000Z',
      },
    };

    expect(transition(state, 'EXECUTING')).toMatchObject({
      ok: false,
      error: { code: 'approval_expired', retryable: false },
    });
  });

  it('rejects an already-expired approval before entering APPROVED', () => {
    const state = actionState('PENDING_APPROVAL');

    expect(
      transition(state, 'APPROVED', {
        approval: {
          eventId: 'b'.repeat(64),
          approvedBy: 'c'.repeat(64),
          approvedAt: '2026-08-11T08:00:00.000Z',
          expiresAt: '2026-08-11T09:00:00.000Z',
        },
      }),
    ).toMatchObject({
      ok: false,
      error: { code: 'approval_expired', retryable: false },
    });
  });

  it('creates byte-for-byte deterministic audit records for equal commands', () => {
    const state = actionState();
    const first = transition(state, 'PENDING_APPROVAL');
    const second = transition(state, 'PENDING_APPROVAL');

    expect(first).toEqual(second);
  });

  it('invalidates approval and starts a new revision in DRAFT', () => {
    const revision = createRevisionState(
      {
        ...actionState('APPROVED'),
        approval: {
          eventId: 'b'.repeat(64),
          approvedBy: 'c'.repeat(64),
          approvedAt: now,
          expiresAt: '2026-08-11T11:00:00.000Z',
        },
      },
      'd'.repeat(64),
      '00000000-0000-4000-8000-000000000011',
    );

    expect(revision).toEqual({
      actionId: '00000000-0000-4000-8000-000000000011',
      workspaceId,
      passportHash: 'd'.repeat(64),
      status: 'DRAFT',
      version: 0,
      approval: undefined,
    });
  });
});
