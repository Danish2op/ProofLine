import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';

import type { EventId, Pubkey } from '@proofline/domain';

export type UnknownBuzzEvent = unknown;
export const maxBuzzEventContentBytes = 16_384;

export interface VerifiedBuzzEvent {
  id: EventId;
  pubkey: Pubkey;
  createdAt: number;
  kind: number;
  tags: readonly (readonly string[])[];
  content: string;
  sig: string;
  rawHash: string;
}

export interface BuzzAdapterError {
  code:
    | 'malformed_event'
    | 'content_too_large'
    | 'invalid_event_id'
    | 'invalid_signature';
  message: string;
  retryable: false;
}

export function verifyEvent(
  input: UnknownBuzzEvent,
): VerifiedBuzzEvent | BuzzAdapterError {
  if (!isBuzzEvent(input)) {
    return error('malformed_event', 'Buzz event envelope is malformed.');
  }
  if (
    new TextEncoder().encode(input.content).byteLength >
    maxBuzzEventContentBytes
  ) {
    return error(
      'content_too_large',
      'Buzz event content exceeds the maximum size.',
    );
  }

  const rawHash = eventHash(input);
  if (input.id !== rawHash) {
    return error(
      'invalid_event_id',
      'Buzz event ID does not match its content.',
    );
  }
  if (
    !schnorr.verify(
      hexToBytes(input.sig),
      hexToBytes(rawHash),
      hexToBytes(input.pubkey),
    )
  ) {
    return error('invalid_signature', 'Buzz event signature is invalid.');
  }

  return {
    id: input.id as EventId,
    pubkey: input.pubkey as Pubkey,
    createdAt: input.created_at,
    kind: input.kind,
    tags: input.tags,
    content: input.content,
    sig: input.sig,
    rawHash,
  };
}

function eventHash(event: BuzzEventEnvelope): string {
  return createHash('sha256')
    .update(
      JSON.stringify([
        0,
        event.pubkey,
        event.created_at,
        event.kind,
        event.tags,
        event.content,
      ]),
    )
    .digest('hex');
}

function isBuzzEvent(value: unknown): value is BuzzEventEnvelope {
  if (!isRecord(value)) return false;
  return (
    isHex(value.id, 64) &&
    isHex(value.pubkey, 64) &&
    isNonNegativeSafeInteger(value.created_at) &&
    isNonNegativeSafeInteger(value.kind) &&
    Array.isArray(value.tags) &&
    value.tags.every(isStringArray) &&
    typeof value.content === 'string' &&
    isHex(value.sig, 128)
  );
}

function error(
  code: BuzzAdapterError['code'],
  message: string,
): BuzzAdapterError {
  return { code, message, retryable: false };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHex(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((tag) => typeof tag === 'string');
}

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{2}/g)?.map((octet) => Number.parseInt(octet, 16)) ?? [],
  );
}

interface BuzzEventEnvelope {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
}
