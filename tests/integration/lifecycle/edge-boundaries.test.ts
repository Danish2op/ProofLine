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
const processBuzzModule =
  await import('../../../supabase/functions/process-buzz-event/index.ts');
const createModule =
  await import('../../../supabase/functions/create-action/index.ts');
const lifecycleBoundaryModule =
  await import('../../../supabase/functions/_shared/lifecycle-boundary.ts');

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

type CreateDependencies = {
  authenticate: (request: Request) => Promise<Caller | null>;
  authorize: (
    caller: Caller,
    workspaceId: string,
    permission: 'create_action',
  ) => Promise<boolean>;
  insert: (action: Record<string, unknown>) => Promise<Response>;
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

function createDependencies(
  overrides: Partial<CreateDependencies> = {},
): CreateDependencies {
  return {
    authenticate: async () => caller,
    authorize: async () => true,
    insert: async (action) => Response.json(action, { status: 201 }),
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
  it('serializes exactly the named approve_verified_action_v2 SQL arguments', () => {
    const payload = lifecycleBoundaryModule.lifecycleRpcPayload({
      target_workspace_id: workspaceId,
      target_action_passport_id: actionId,
      source_expected_version: 0,
      source_target_status: 'APPROVED',
      source_command_id: '00000000-0000-4000-8000-000000000032',
      source_command_hash: 'b'.repeat(64),
      source_actor_type: 'human',
      source_actor_id: caller.userId,
      source_correlation_id: '00000000-0000-4000-8000-000000000033',
      source_causation_id: null,
      source_approval_event_id: 'a'.repeat(64),
      source_approved_at: '2026-08-11T10:00:00.000Z',
      source_expires_at: '2026-08-11T11:00:00.000Z',
      source_approval_actor_pubkey: 'c'.repeat(64),
      source_approval_raw_event_json: { id: 'a'.repeat(64) },
      unexpected_attacker_field: 'must-not-reach-postgrest',
    });

    expect(Object.keys(payload).sort()).toEqual(
      [
        'source_approval_actor_pubkey',
        'source_approval_event_id',
        'source_approval_raw_event_json',
        'source_approved_at',
        'source_causation_id',
        'source_command_hash',
        'source_command_id',
        'source_correlation_id',
        'source_actor_id',
        'source_expected_version',
        'source_expires_at',
        'target_action_passport_id',
        'target_workspace_id',
      ].sort(),
    );
    expect(payload).not.toHaveProperty('source_target_status');
    expect(payload).not.toHaveProperty('source_actor_type');
    expect(payload).not.toHaveProperty('unexpected_attacker_field');
  });

  it('requires the complete verified approval contract before calling the lifecycle RPC', async () => {
    const transition = vi.fn(async () => Response.json({ ok: true }));
    const handler = approveModule.createApproveActionHandler(
      dependencies({ transition }),
    );

    const response = await handler(
      request({
        workspaceId,
        actionPassportId: actionId,
        commandId: '00000000-0000-4000-8000-000000000030',
        commandHash: 'b'.repeat(64),
        correlationId: '00000000-0000-4000-8000-000000000031',
        expectedVersion: 0,
        approvalEventId: 'a'.repeat(64),
        approvedAt: '2026-08-11T10:00:00.000Z',
        expiresAt: '2026-08-11T11:00:00.000Z',
      }),
    );

    expect(response.status).toBe(400);
    expect(transition).not.toHaveBeenCalled();
  });

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
        approvalActorPubkey: 'c'.repeat(64),
        rawEvent: {
          id: 'a'.repeat(64),
          pubkey: 'c'.repeat(64),
          sig: 'd'.repeat(128),
          kind: 7,
          tags: [],
          content: '+',
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(transition).toHaveBeenCalledWith(
      expect.objectContaining({
        source_target_status: 'APPROVED',
        source_approval_event_id: 'buzz-event-1',
        source_approved_at: '2026-08-11T10:00:00.000Z',
        source_expires_at: '2026-08-11T11:00:00.000Z',
        source_approval_actor_pubkey: 'c'.repeat(64),
      }),
    );
  });
});

describe('legacy Buzz and create-action boundaries', () => {
  it('fails closed instead of invoking the legacy approval mutation', async () => {
    const response = await processBuzzModule.createProcessBuzzEventHandler()(
      request({}),
    );

    expect(response.status).toBe(410);
    expect(await response.json()).toMatchObject({
      error: { code: 'endpoint_deprecated' },
    });
  });

  it('authenticates create-action before service-role insert and rejects cross-workspace membership', async () => {
    const insert = vi.fn(async () =>
      Response.json({ ok: true }, { status: 201 }),
    );
    const authorize = vi.fn(async () => false);
    const handler = createModule.createCreateActionHandler(
      createDependencies({ authorize, insert }),
    );

    const response = await handler(
      request({
        action: { workspace_id: workspaceId, status: 'DRAFT' },
      }),
    );

    expect(response.status).toBe(403);
    expect(authorize).toHaveBeenCalledWith(
      caller,
      workspaceId,
      'create_action',
    );
    expect(insert).not.toHaveBeenCalled();
  });
});
