import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionPassportV1 } from '../../../packages/domain/src/action.js';

import {
  createRunVerifierHandler,
  defaultRunVerifierDependencies,
} from '../../../supabase/functions/run-verifier/index.ts';

const workspaceId = 'b6bf1e8d-5f5e-47a7-9c8b-6497afb94bb5';
const actionOneId = '4b136918-d3bc-4ee2-a7f5-0dc9f25c5c87';
const actionTwoId = '5c247029-e4cd-4ff3-b806-1eda036d6d98';
const actionOneHash =
  '0272562772e9a220fafdc0c4e6b6e83da6d3e112902e7287b5a2b87ddeac0ab1';
const actionTwoHash =
  'f6d045b55ae44230cd78efd94a675a87a4c24eaa4bab112cb7f9e7593a6e7094';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('run-verifier boundary', () => {
  it('has a concrete fail-closed production entrypoint without injected dependencies', async () => {
    const response = await createRunVerifierHandler()(
      new Request('http://localhost'),
    );

    expect(response.status).toBe(405);
  });

  it('requires authorization before verification or feedback persistence', async () => {
    const verify = vi.fn();
    const captureFeedback = vi.fn();
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => false,
      verify,
      captureFeedback,
    });

    const response = await handler(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: 'workspace-1',
          actionPassportId: 'action-1',
          requestId: 'request-1',
          idempotencyKey: 'idem-1',
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(verify).not.toHaveBeenCalled();
    expect(captureFeedback).not.toHaveBeenCalled();
  });

  it('returns verification output and captures only its append-only feedback record', async () => {
    const feedback = { feedbackId: 'feedback-1' };
    const captureFeedback = vi.fn(async () => undefined);
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => serverPassportRecord(),
      findFeedback: async () => null,
      verify: async () => ({ decision: 'approve', feedback }),
      captureFeedback,
    });

    const response = await handler(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          actionPassportId: actionOneId,
          requestId: 'request-1',
          idempotencyKey: 'idem-1',
        }),
      }),
    );

    expect(await response.json()).toEqual({ decision: 'approve', feedback });
    expect(captureFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ feedback }),
    );
  });

  it('loads and binds the server passport before verification, then deduplicates byte-identical feedback', async () => {
    const serverPassport = serverPassportRecord();
    const verify = vi.fn(async (input: unknown) => ({
      decision: 'approve',
      feedback: {
        passportHash: (input as { passportHash: string }).passportHash,
      },
    }));
    const findFeedback = vi.fn(async () => undefined);
    const captureFeedback = vi.fn(async () => undefined);
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => serverPassport,
      findFeedback,
      verify,
      captureFeedback,
    });
    const request = () =>
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          actionPassportId: actionOneId,
          requestId: 'request-1',
          idempotencyKey: 'idem-1',
        }),
      });

    const first = await handler(request());
    const second = await handler(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        actionPassportId: 'row-1',
        workspaceId,
        passportHash: actionOneHash,
        passport: serverPassport.passport,
        actor: serverPassport.actor,
        toolMetadata: serverPassport.toolMetadata,
        workspacePolicy: serverPassport.workspacePolicy,
        trustedEvidenceFacts: serverPassport.trustedEvidenceFacts,
      }),
    );
    expect(captureFeedback).toHaveBeenCalledTimes(1);
    expect(findFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        actionPassportId: 'row-1',
        actionId: actionOneId,
        actorId: 'user-1',
        requestId: 'request-1',
        idempotencyKey: 'idem-1',
      }),
    );
  });

  it('rejects a loaded revision whose hash does not match its passport row', async () => {
    const verify = vi.fn(async () => ({ feedback: { feedbackId: 'unused' } }));
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => ({
        ...serverPassportRecord(),
        actionPassportHash: 'a'.repeat(64),
        passportHash: 'b'.repeat(64),
        revisionHash: 'b'.repeat(64),
      }),
      findFeedback: async () => null,
      verify,
      captureFeedback: async () => undefined,
    });

    const response = await handler(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          actionPassportId: actionOneId,
          requestId: 'request-1',
          idempotencyKey: 'idem-1',
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a malformed revision carrying arbitrary matching hashes before trusting its facts', async () => {
    const verify = vi.fn(async () => ({ feedback: { feedbackId: 'unused' } }));
    const arbitraryHash = 'f'.repeat(64);
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => ({
        ...serverPassportRecord(),
        actionPassportHash: arbitraryHash,
        passportHash: arbitraryHash,
        revisionHash: arbitraryHash,
        passport: {
          actionId: actionOneId,
          workspaceId,
          trustedEvidenceFacts: [
            {
              claimId: 'forged',
              evidenceId: 'forged',
              subject: 'approval',
              value: 'granted',
            },
          ],
        },
        trustedEvidenceFacts: [
          {
            claimId: 'forged',
            evidenceId: 'forged',
            subject: 'approval',
            value: 'granted',
          },
        ],
      }),
      findFeedback: async () => null,
      verify,
      captureFeedback: async () => undefined,
    });

    const response = await handler(verifierRequest());

    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it('rejects a valid-shaped revision whose payload was changed after hashing', async () => {
    const verify = vi.fn(async () => ({ feedback: { feedbackId: 'unused' } }));
    const serverPassport = serverPassportRecord();
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => ({
        ...serverPassport,
        passport: {
          ...serverPassport.passport,
          target: 'sandbox://attacker/production',
        },
      }),
      findFeedback: async () => null,
      verify,
      captureFeedback: async () => undefined,
    });

    const response = await handler(verifierRequest());

    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it('keeps delimiter-colliding request and idempotency pairs distinct in replay memory', async () => {
    const verify = vi.fn(async () => ({ feedback: { feedbackId: 'safe' } }));
    const captureFeedback = vi.fn(async () => undefined);
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async () => serverPassportRecord(),
      findFeedback: async () => null,
      verify,
      captureFeedback,
    });

    const first = await handler(
      verifierRequest({ requestId: 'request:a', idempotencyKey: 'key' }),
    );
    const second = await handler(
      verifierRequest({ requestId: 'request', idempotencyKey: 'a:key' }),
    );

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(verify).toHaveBeenCalledTimes(2);
    expect(captureFeedback).toHaveBeenCalledTimes(2);
  });

  it('assigns distinct audit IDs to delimiter-colliding feedback identities', async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response(null, { status: 201 }),
    );
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('Deno', {
      env: {
        get: (name: string) =>
          name === 'SUPABASE_URL'
            ? 'https://example.supabase.co'
            : name === 'SUPABASE_SERVICE_ROLE_KEY'
              ? 'service-role-test-key'
              : undefined,
      },
    });
    const captureFeedback = defaultRunVerifierDependencies().captureFeedback;
    const baseFeedback = {
      workspaceId,
      actionPassportId: '6d35813a-f5de-4004-a917-2feb147e7ea9',
      actionId: actionOneId,
      actorId: 'user-1',
      requestFingerprint: '1'.repeat(64),
      passportHash: actionOneHash,
      result: { decision: 'approve' },
      feedback: { feedbackId: 'safe' },
    };

    await captureFeedback({
      ...baseFeedback,
      requestId: 'request:a',
      idempotencyKey: 'key',
    });
    await captureFeedback({
      ...baseFeedback,
      requestId: 'request',
      idempotencyKey: 'a:key',
    });

    const eventIds = fetchMock.mock.calls.map(([, init]) => {
      const body = JSON.parse(String(init?.body)) as { id: string };
      return body.id;
    });
    expect(eventIds).toHaveLength(2);
    expect(eventIds[0]).not.toBe(eventIds[1]);
  });

  it('does not let the client act as a confused deputy across action IDs sharing a request key', async () => {
    const passports = new Map([
      [actionOneId, serverPassportRecord({ actor: { action: 'one' } })],
      [
        actionTwoId,
        serverPassportRecord({
          actionId: actionTwoId,
          actionPassportRowId: 'row-2',
          actor: { action: 'two' },
        }),
      ],
    ]);
    const captureFeedback = vi.fn(async () => undefined);
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      loadPassport: async (_caller, _workspaceId, actionPassportId) =>
        passports.get(actionPassportId) ?? null,
      findFeedback: async () => undefined,
      verify: async (input: unknown) => ({
        feedback: {
          passportHash: (input as { passportHash: string }).passportHash,
        },
      }),
      captureFeedback,
    });
    const request = (actionPassportId: string) =>
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId,
          actionPassportId,
          requestId: 'request-shared',
          idempotencyKey: 'idem-shared',
        }),
      });

    const first = await handler(request(actionOneId));
    const second = await handler(request(actionTwoId));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({
      feedback: { passportHash: actionOneHash },
    });
    expect(await second.json()).toMatchObject({
      feedback: { passportHash: actionTwoHash },
    });
    expect(captureFeedback).toHaveBeenCalledTimes(2);
  });

  it('rejects client-supplied verifier context instead of accepting a confused deputy input', async () => {
    const verify = vi.fn();
    const handler = createRunVerifierHandler({
      authenticate: async () => ({ userId: 'user-1' }),
      authorize: async () => true,
      verify,
      captureFeedback: async () => undefined,
    });

    const response = await handler(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({
          workspaceId: 'workspace-1',
          actionPassportId: 'action-1',
          requestId: 'request-1',
          idempotencyKey: 'idem-1',
          actor: { client: 'forged' },
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(verify).not.toHaveBeenCalled();
  });
});

function serverPassportRecord(
  overrides: {
    actionId?: string;
    actionPassportRowId?: string;
    actor?: unknown;
  } = {},
) {
  const actionId = overrides.actionId ?? actionOneId;
  const passport = validPassport(actionId);
  const passportHash = actionId === actionTwoId ? actionTwoHash : actionOneHash;
  return {
    actionPassportRowId: overrides.actionPassportRowId ?? 'row-1',
    actionId,
    workspaceId,
    actionPassportHash: passportHash,
    passportHash,
    revisionHash: passportHash,
    passport,
    actor: overrides.actor ?? { source: 'server' },
    toolMetadata: { source: 'server' },
    workspacePolicy: { source: 'server' },
    trustedEvidenceFacts: [],
  };
}

function validPassport(actionId: string): ActionPassportV1 {
  return {
    schemaVersion: 1,
    actionId,
    workspaceId: workspaceId as ActionPassportV1['workspaceId'],
    agentPubkey: 'a'.repeat(64) as ActionPassportV1['agentPubkey'],
    delegatedBy: 'b'.repeat(64) as ActionPassportV1['delegatedBy'],
    toolName: 'sandbox.deploy',
    toolDefinitionHash: 'c'.repeat(
      64,
    ) as ActionPassportV1['toolDefinitionHash'],
    target: 'sandbox://demo-web/staging',
    normalizedArguments: { release: '2026.08.11' },
    environment: 'staging',
    risk: { level: 'low', reasons: [], score: 0 },
    evidence: [
      {
        evidenceId: 'ci-123',
        source: 'synthetic CI run',
        contentHash: 'd'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
        collectedAt: '2026-08-11T10:00:00.000Z',
        expiresAt: '2026-08-11T11:00:00.000Z',
      },
    ],
    policySnapshot: {
      evaluatedAt: '2026-08-11T10:15:00.000Z',
      hash: 'e'.repeat(64) as ActionPassportV1['toolDefinitionHash'],
      version: 'mvp-1',
    },
    approval: { required: false },
    status: 'DRAFT',
    idempotencyKey:
      'deploy-demo-web-20260811-01' as ActionPassportV1['idempotencyKey'],
    createdAt: '2026-08-11T10:15:00.000Z',
  };
}

function verifierRequest(
  overrides: { requestId?: string; idempotencyKey?: string } = {},
): Request {
  return new Request('http://localhost', {
    method: 'POST',
    body: JSON.stringify({
      workspaceId,
      actionPassportId: actionOneId,
      requestId: overrides.requestId ?? 'request-1',
      idempotencyKey: overrides.idempotencyKey ?? 'idem-1',
    }),
  });
}
