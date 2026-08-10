import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';

import { verifyEvent } from '../../../packages/buzz-adapter/src/event-codec.js';

const encoder = new TextEncoder();
const testPrivateKey = '1'.repeat(64);

describe('Buzz event verification', () => {
  it('accepts a signed Nostr event and preserves its computed raw hash', () => {
    const event = signedEvent({
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content:
        '{"proofline":{"schema":"proofline.passport.v1","passportHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"},"message":"Deploy revision demo-42"}',
    });

    expect(verifyEvent(event)).toMatchObject({
      id: event.id,
      pubkey: event.pubkey,
      rawHash: event.id,
      kind: 9,
    });
  });

  it('rejects a signed event whose content exceeds the adapter limit', () => {
    const event = signedEvent({
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'x'.repeat(16_385),
    });

    expect(verifyEvent(event)).toMatchObject({
      code: 'content_too_large',
      retryable: false,
    });
  });

  it('rejects an event whose signature does not authenticate its event hash', () => {
    const event = signedEvent({
      kind: 7,
      tags: [['e', 'a'.repeat(64)]],
      content: '+',
    });

    expect(verifyEvent({ ...event, sig: '0'.repeat(128) })).toMatchObject({
      code: 'invalid_signature',
      retryable: false,
    });
  });
});

function signedEvent(input: {
  kind: number;
  tags: string[][];
  content: string;
}) {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(testPrivateKey)));
  const created_at = 1_700_000_000;
  const id = eventId({ pubkey, created_at, ...input });
  const sig = bytesToHex(
    schnorr.sign(hexToBytes(id), hexToBytes(testPrivateKey)),
  );
  return { id, pubkey, created_at, ...input, sig };
}

function eventId(event: {
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}): string {
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

function hexToBytes(hex: string): Uint8Array {
  return Uint8Array.from(
    hex.match(/.{2}/g)?.map((octet) => Number.parseInt(octet, 16)) ?? [],
  );
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join(
    '',
  );
}
