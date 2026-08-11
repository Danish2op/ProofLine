import { describe, expect, it, vi } from 'vitest';

const registeredHandlers: Array<(request: Request) => Promise<Response>> = [];
vi.stubGlobal('Deno', {
  serve: (handler: (request: Request) => Promise<Response>) =>
    registeredHandlers.push(handler),
});

const revokeModule =
  await import('../../../supabase/functions/revoke-action/index.ts');
const approveModule =
  await import('../../../supabase/functions/approve-action/index.ts');

type Caller = { userId: string; accessToken: string };
type BoundaryDependencies = {
  authenticate: (request: Request) => Promise<Caller | null>;
  authorize: (
    caller: Caller,
    workspaceId: string,
    permission: 'approve_action' | 'revoke_action',
  ) => Promise<boolean>;
  transition: (input: Record<string, unknown>) => Promise<Response>;
};

const caller: Caller = { userId: 'user-1', accessToken: 'token-1' };
const workspaceId = '00000000-0000-4000-8000-000000000001';
const actionId = '00000000-0000-4000-8000-000000000010';

function request(
  body: Record<string, unknown>,
  authorization = 'Bearer token-1',
): Request {
  return new Request('https://proofline.example.test', {
    method: 'POST',
    headers: { authorization, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function dependencies(
  overrides: Partial<BoundaryDependencies> = {},
): BoundaryDependencies {
  return {
    authenticate: async () => caller,
    authorize: async () => true,
    transition: async (input) =>
      Response.json({ ok: true, state: { version: 1 }, received: input }),
    ...overrides,
  };
}

describe('revoke-action command boundary', () => {
  it('fails closed without a valid authenticated caller and never calls service-role mutation', async () => {
    const transition = vi.fn(async () => Response.json({ ok: true }));
    const handler = revokeModule.createRevokeActionHandler(
      dependencies({
        authenticate: async () => null,
        transition,
      }),
    );

    const response = await handler(
      request({ workspaceId, actionPassportId: actionId }),
    );

    expect(response.status).toBe(401);
    expect(transition).not.toHaveBeenCalled();
  });

  it('rejects a caller without revoke permission, including a cross-workspace attempt', async () => {
    const transition = vi.fn(async () => Response.json({ ok: true }));
    const authorize = vi.fn(
      async (_caller: Caller, requestedWorkspace: string) =>
        requestedWorkspace === workspaceId,
    );
    const handler = revokeModule.createRevokeActionHandler(
      dependencies({ authorize, transition }),
    );

    const response = await handler(
      request({
        workspaceId: '00000000-0000-4000-8000-000000000099',
        actionPassportId: actionId,
        commandId: '00000000-0000-4000-8000-000000000021',
        commandHash: 'a'.repeat(64),
        correlationId: '00000000-0000-4000-8000-000000000022',
        expectedVersion: 0,
      }),
    );

    expect(response.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(
      caller,
      '00000000-0000-4000-8000-000000000099',
      'revoke_action',
    );
    expect(transition).not.toHaveBeenCalled();
  });

  it('derives the mutation actor from the authenticated caller and targets the requested workspace', async () => {
    const transition = vi.fn(async (input: Record<string, unknown>) =>
      Response.json({ ok: true, received: input }),
    );
    const handler = revokeModule.createRevokeActionHandler(
      dependencies({ transition }),
    );

    await handler(
      request({
        workspaceId,
        actionPassportId: actionId,
        commandId: '00000000-0000-4000-8000-000000000011',
        commandHash: 'a'.repeat(64),
        correlationId: '00000000-0000-4000-8000-000000000012',
        expectedVersion: 0,
        actorType: 'human',
        actorId: 'attacker-supplied-id',
      }),
    );

    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        source_target_status: 'REVOKED',
        source_actor_id: caller.userId,
        target_workspace_id: workspaceId,
        target_action_passport_id: actionId,
      }),
    );
  });
});

describe('approve-action command boundary', () => {
  it('uses transition_action with approval data rather than the legacy Buzz approval RPC', async () => {
    const transition = vi.fn(async (input: Record<string, unknown>) =>
      Response.json({ ok: true, state: { version: 1 }, received: input }),
    );
    const handler = approveModule.createApproveActionHandler(
      dependencies({ transition }),
    );

    const response = await handler(
      request({
        workspaceId,
        actionPassportId: actionId,
        commandId: '00000000-0000-4000-8000-000000000013',
        commandHash: 'b'.repeat(64),
        correlationId: '00000000-0000-4000-8000-000000000014',
        expectedVersion: 0,
        approvalEventId: 'buzz-event-1',
        approvedAt: '2026-08-11T10:00:00.000Z',
        expiresAt: '2026-08-11T11:00:00.000Z',
      }),
    );

    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        source_target_status: 'APPROVED',
        source_approval_event_id: 'buzz-event-1',
        source_approved_at: '2026-08-11T10:00:00.000Z',
        source_expires_at: '2026-08-11T11:00:00.000Z',
      }),
    );
  });
});
