import { describe, expect, it } from 'vitest';
import { createReceipt } from '../../../packages/execution/src/receipts.ts';

describe('createReceipt', () => {
  it('redacts credential-shaped provider metadata and hashes the redacted receipt', () => {
    const receipt = createReceipt({
      actionId: 'action-1',
      workspaceId: 'workspace-1',
      passportHash: 'a'.repeat(64),
      executionAttempt: 1,
      providerRequestId: 'sandbox-1',
      outcome: 'succeeded',
      sideEffects: ['deployed:staging'],
      rollbackReference: 'rollback://1',
      providerMetadata: { provider: 'offline', accessToken: 'secret-value' },
      occurredAt: '2026-08-11T12:00:00.000Z',
    });
    expect(receipt.providerMetadata).toEqual({
      provider: 'offline',
      accessToken: '[REDACTED]',
    });
    expect(receipt.receiptHash).toMatch(/^[0-9a-f]{64}$/);
  });
});
