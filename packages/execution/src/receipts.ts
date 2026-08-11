import { hashCanonicalJson } from '@proofline/canonical';

export interface ReceiptInput {
  actionId: string;
  workspaceId: string;
  passportHash: string;
  executionAttempt: number;
  providerRequestId: string;
  outcome: 'succeeded' | 'failed';
  sideEffects: string[];
  rollbackReference: string | null;
  providerMetadata: Record<string, unknown>;
  occurredAt: string;
}

export interface ExecutionReceipt extends ReceiptInput {
  receiptHash: string;
}

export function createReceipt(input: ReceiptInput): ExecutionReceipt {
  const redacted = redact(input.providerMetadata);
  const base = { ...input, providerMetadata: redacted };
  return { ...base, receiptHash: hashCanonicalJson(base) };
}

function redact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) =>
      /token|secret|password|key/i.test(key)
        ? [key, '[REDACTED]']
        : [key, item],
    ),
  );
}
