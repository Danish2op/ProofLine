import { describe, expect, it } from 'vitest';
import { IdempotencyStore } from '../../../packages/execution/src/idempotency.ts';

describe('IdempotencyStore', () => {
  it('distinguishes new, in-progress, success replay, and retryable failure', () => {
    const store = new IdempotencyStore();
    expect(store.begin('x')).toEqual({ kind: 'new' });
    expect(store.begin('x')).toEqual({ kind: 'in_progress' });
    store.failRetryably('x', 'timeout');
    expect(store.begin('x')).toEqual({
      kind: 'retryable_failure',
      error: 'timeout',
    });
    store.succeed('x', { receiptHash: 'r' });
    expect(store.begin('x')).toEqual({
      kind: 'already_succeeded',
      receipt: { receiptHash: 'r' },
    });
  });
});
