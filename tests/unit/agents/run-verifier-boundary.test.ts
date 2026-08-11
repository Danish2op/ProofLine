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
        body: JSON.stringify({ workspaceId: 'workspace-1', verification: {} }),
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
      verify: async () => ({ decision: 'approve', feedback }),
      captureFeedback,
    });

    const response = await handler(
      new Request('http://localhost', {
        method: 'POST',
        body: JSON.stringify({ workspaceId: 'workspace-1', verification: {} }),
      }),
    );

    expect(await response.json()).toEqual({ decision: 'approve', feedback });
    expect(captureFeedback).toHaveBeenCalledWith(feedback);
  });

  it('loads and binds the server passport before verification, then deduplicates byte-identical feedback', async () => {
    const serverPassport = {
      actionId: 'action-1',
      workspaceId: 'workspace-1',
      passportHash: 'a'.repeat(64),
      passport: { actionId: 'action-1', workspaceId: 'workspace-1' },
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
          verification: { passportHash: 'forged' },
        }),
      });

    const first = await handler(request());
    const second = await handler(request());

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(verify).toHaveBeenCalledWith(
      expect.objectContaining({
        actionPassportId: 'action-1',
        workspaceId: 'workspace-1',
        passportHash: 'a'.repeat(64),
        passport: serverPassport.passport,
      }),
    );
    expect(captureFeedback).toHaveBeenCalledTimes(1);
    expect(findFeedback).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId: 'workspace-1',
        actorId: 'user-1',
        requestId: 'request-1',
        idempotencyKey: 'idem-1',
      }),
    );
  });
});
