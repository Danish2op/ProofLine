import { describe, expect, it, vi } from 'vitest';

import { createRunVerifierHandler } from '../../../supabase/functions/run-verifier/index.ts';

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
      loadPassport: async () => ({
        actionPassportRowId: 'row-1',
        actionId: 'action-1',
        workspaceId: 'workspace-1',
        actionPassportHash: 'a'.repeat(64),
        passportHash: 'a'.repeat(64),
        revisionHash: 'a'.repeat(64),
        passport: { actionId: 'action-1', workspaceId: 'workspace-1' },
        actor: { source: 'server' },
        toolMetadata: { source: 'server' },
        workspacePolicy: { source: 'server' },
        trustedEvidenceFacts: [],
      }),
      findFeedback: async () => null,
      verify: async () => ({ decision: 'approve', feedback }),
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

    expect(await response.json()).toEqual({ decision: 'approve', feedback });
    expect(captureFeedback).toHaveBeenCalledWith(
      expect.objectContaining({ feedback }),
    );
  });

  it('loads and binds the server passport before verification, then deduplicates byte-identical feedback', async () => {
    const serverPassport = {
      actionPassportRowId: 'row-1',
      actionId: 'action-1',
      workspaceId: 'workspace-1',
      actionPassportHash: 'a'.repeat(64),
      passportHash: 'a'.repeat(64),
      revisionHash: 'a'.repeat(64),
      passport: { actionId: 'action-1', workspaceId: 'workspace-1' },
      actor: { source: 'server' },
      toolMetadata: { source: 'server' },
      workspacePolicy: { source: 'server' },
      trustedEvidenceFacts: [],
    };
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
          workspaceId: 'workspace-1',
          actionPassportId: 'action-1',
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
        workspaceId: 'workspace-1',
        passportHash: 'a'.repeat(64),
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
        workspaceId: 'workspace-1',
        actionPassportId: 'row-1',
        actionId: 'action-1',
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
        actionPassportRowId: 'row-1',
        actionId: 'action-1',
        workspaceId: 'workspace-1',
        actionPassportHash: 'a'.repeat(64),
        passportHash: 'b'.repeat(64),
        revisionHash: 'b'.repeat(64),
        passport: { actionId: 'action-1', workspaceId: 'workspace-1' },
        actor: { source: 'server' },
        toolMetadata: { source: 'server' },
        workspacePolicy: { source: 'server' },
        trustedEvidenceFacts: [],
      }),
      findFeedback: async () => null,
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
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(verify).not.toHaveBeenCalled();
  });

  it('does not let the client act as a confused deputy across action IDs sharing a request key', async () => {
    const passports = new Map([
      [
        'action-1',
        {
          actionPassportRowId: 'row-1',
          actionId: 'action-1',
          workspaceId: 'workspace-1',
          actionPassportHash: 'a'.repeat(64),
          passportHash: 'a'.repeat(64),
          revisionHash: 'a'.repeat(64),
          passport: { actionId: 'action-1', workspaceId: 'workspace-1' },
          actor: { action: 'one' },
          toolMetadata: {},
          workspacePolicy: {},
          trustedEvidenceFacts: [],
        },
      ],
      [
        'action-2',
        {
          actionPassportRowId: 'row-2',
          actionId: 'action-2',
          workspaceId: 'workspace-1',
          actionPassportHash: 'b'.repeat(64),
          passportHash: 'b'.repeat(64),
          revisionHash: 'b'.repeat(64),
          passport: { actionId: 'action-2', workspaceId: 'workspace-1' },
          actor: { action: 'two' },
          toolMetadata: {},
          workspacePolicy: {},
          trustedEvidenceFacts: [],
        },
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
          workspaceId: 'workspace-1',
          actionPassportId,
          requestId: 'request-shared',
          idempotencyKey: 'idem-shared',
        }),
      });

    const first = await handler(request('action-1'));
    const second = await handler(request('action-2'));

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({
      feedback: { passportHash: 'a'.repeat(64) },
    });
    expect(await second.json()).toMatchObject({
      feedback: { passportHash: 'b'.repeat(64) },
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
