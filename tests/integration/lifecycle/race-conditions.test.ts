import { describe, expect, it } from 'vitest';

import {
  InMemoryLifecycleCommandStore,
  LifecycleCommandService,
  type LifecycleCommand,
} from '../../../apps/worker/src/runtime.js';

const workspaceA = '00000000-0000-4000-8000-000000000001';
const workspaceB = '00000000-0000-4000-8000-000000000002';
const actionId = '00000000-0000-4000-8000-000000000010';
const now = '2026-08-11T10:00:00.000Z';

function createService(
  status: 'PENDING_APPROVAL' | 'APPROVED' = 'PENDING_APPROVAL',
) {
  const store = new InMemoryLifecycleCommandStore([
    {
      actionId,
      workspaceId: workspaceA,
      passportHash: 'a'.repeat(64),
      status,
      version: 0,
      approval:
        status === 'APPROVED'
          ? {
              eventId: 'a'.repeat(64),
              approvedBy: 'b'.repeat(64),
              approvedAt: now,
              expiresAt: '2026-08-11T11:00:00.000Z',
            }
          : undefined,
    },
  ]);
  return { store, service: new LifecycleCommandService(store) };
}

function command<Overrides extends Record<string, unknown>>(
  overrides: Overrides,
): Omit<LifecycleCommand, 'to'> & Overrides {
  return {
    workspaceId: workspaceA,
    actionId,
    expectedVersion: 0,
    commandId: 'command-1',
    actor: { type: 'human' as const, id: 'reviewer-1' },
    correlationId: 'correlation-1',
    causationId: 'buzz-event-1',
    occurredAt: now,
    ...overrides,
  } as Omit<LifecycleCommand, 'to'> & Overrides;
}

describe('LifecycleCommandService', () => {
  it('replays the same approval command without a second audit record', async () => {
    const { service, store } = createService();
    const approval = command({
      to: 'APPROVED' as const,
      approval: {
        eventId: 'b'.repeat(64),
        approvedBy: 'c'.repeat(64),
        approvedAt: now,
        expiresAt: '2026-08-11T11:00:00.000Z',
      },
    });

    const first = await service.execute(approval);
    const replay = await service.execute(approval);

    expect(replay).toEqual(first);
    expect(store.auditEvents()).toHaveLength(1);
  });

  it('rejects a reused command ID with a conflicting payload', async () => {
    const { service } = createService();
    await service.execute(command({ to: 'BLOCKED' as const }));

    await expect(
      service.execute(command({ to: 'APPROVED' as const })),
    ).resolves.toMatchObject({
      ok: false,
      error: { code: 'idempotency_conflict', retryable: false },
    });
  });

  it('allows exactly one of simultaneous approval and rejection commands', async () => {
    const { service, store } = createService();
    const [approval, rejection] = await Promise.all([
      service.execute(
        command({
          commandId: 'approve',
          to: 'APPROVED' as const,
          approval: {
            eventId: 'b'.repeat(64),
            approvedBy: 'c'.repeat(64),
            approvedAt: now,
            expiresAt: '2026-08-11T11:00:00.000Z',
          },
        }),
      ),
      service.execute(command({ commandId: 'reject', to: 'BLOCKED' as const })),
    ]);

    expect([approval, rejection].filter((result) => result.ok)).toHaveLength(1);
    expect(store.auditEvents()).toHaveLength(1);
  });

  it('allows exactly one execution claim for concurrent workers', async () => {
    const { service, store } = createService('APPROVED');
    const [first, second] = await Promise.all([
      service.execute(
        command({
          commandId: 'claim-a',
          to: 'EXECUTING' as const,
          actor: { type: 'worker', id: 'worker-a' },
        }),
      ),
      service.execute(
        command({
          commandId: 'claim-b',
          to: 'EXECUTING' as const,
          actor: { type: 'worker', id: 'worker-b' },
        }),
      ),
    ]);

    expect([first, second].filter((result) => result.ok)).toHaveLength(1);
    expect(store.auditEvents()).toHaveLength(1);
  });

  it('keeps retryable failures in EXECUTING and terminal failures in FAILED', async () => {
    const { service } = createService('APPROVED');
    const claim = await service.execute(command({ to: 'EXECUTING' as const }));
    if (!claim.ok) throw new Error('fixture claim must succeed');

    const retryable = await service.recordFailure({
      ...command({ commandId: 'retryable', expectedVersion: 1 }),
      retryable: true,
      reason: 'provider timeout',
    });
    const terminal = await service.recordFailure({
      ...command({ commandId: 'terminal', expectedVersion: 2 }),
      retryable: false,
      reason: 'provider rejected request',
    });

    expect(retryable).toMatchObject({
      ok: true,
      value: { state: { status: 'EXECUTING', version: 2 } },
    });
    expect(terminal).toMatchObject({
      ok: true,
      value: { state: { status: 'FAILED', version: 3 } },
    });
  });

  it('does not disclose or mutate an action from another workspace', async () => {
    const { service, store } = createService();
    const result = await service.execute(
      command({ workspaceId: workspaceB, to: 'BLOCKED' as const }),
    );

    expect(result).toMatchObject({
      ok: false,
      error: { code: 'action_not_found', retryable: false },
    });
    expect(store.auditEvents()).toHaveLength(0);
  });
});
