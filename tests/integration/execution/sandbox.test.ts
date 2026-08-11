import { describe, expect, it } from 'vitest';
import { SandboxProvider } from '../../../packages/execution/src/providers/sandbox.ts';

describe('SandboxProvider', () => {
  it('returns deterministic side effects without touching external infrastructure', async () => {
    const result = await new SandboxProvider().execute({
      passport: { actionId: 'action-1', target: 'sandbox://staging' } as never,
      passportHash: 'a'.repeat(64),
    });
    expect(result).toMatchObject({
      outcome: 'succeeded',
      sideEffects: ['deployed:sandbox://staging'],
    });
  });
});
