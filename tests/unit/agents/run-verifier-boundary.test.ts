import { describe, expect, it, vi } from 'vitest';

import { createRunVerifierHandler } from '../../../supabase/functions/run-verifier/index.ts';

describe('run-verifier boundary', () => {
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
});
