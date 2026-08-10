import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';

import { BuzzAdapterClient } from '../../../packages/buzz-adapter/src/client.js';

const testPrivateKey = '3'.repeat(64);

describe('Buzz relay adapter', () => {
  it('publishes a structured proposal through the supplied signer and transport', async () => {
    const published: unknown[] = [];
    const client = new BuzzAdapterClient({
      relayUrl: 'wss://relay.example.test',
      signer: deterministicSigner(),
      transport: {
        async publish(event) {
          published.push(event);
        },
      },
    });

    const ref = await client.publishProposal({
      channelId: 'proofline-demo-channel',
      passportHash: 'a'.repeat(64),
      message: 'Deploy revision demo-42.',
    });

    expect(ref).toMatchObject({
      relayUrl: 'wss://relay.example.test/',
      pubkey: bytesToHex(schnorr.getPublicKey(hexToBytes(testPrivateKey))),
      kind: 9,
      rawHash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: JSON.stringify({
        proofline: {
          schema: 'proofline.passport.v1',
          type: 'proposal',
          passportHash: 'a'.repeat(64),
        },
        message: 'Deploy revision demo-42.',
      }),
    });
  });

  it('reads an approval only from the supplied provenance reader', async () => {
    const approval = {
      decision: 'approve' as const,
      eventId: 'a'.repeat(64),
      proposalEventId: 'b'.repeat(64),
      reviewerPubkey: 'c'.repeat(64),
      workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
      channelId: 'proofline-demo-channel',
    };
    const client = new BuzzAdapterClient({
      relayUrl: 'wss://relay.example.test',
      signer: deterministicSigner(),
      transport: { async publish() {} },
      approvalReader: {
        async readApprovalForProposal() {
          return approval;
        },
      },
    });

    await expect(
      client.readApprovalForProposal(approval.proposalEventId),
    ).resolves.toEqual(approval);
  });

  const relayUrl = process.env.BUZZ_RELAY_URL;
  const channelId = process.env.BUZZ_DEMO_CHANNEL;
  it.skipIf(!relayUrl || !channelId)(
    'does not attempt authenticated publication without an explicitly configured signing identity and membership',
    () => {
      // Live publication deliberately remains skipped: this test has no signing
      // identity or channel membership, so it cannot honestly claim success.
    },
  );
});

function deterministicSigner() {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(testPrivateKey)));
  return {
    pubkey,
    async sign(event: {
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    }) {
      const id = eventId({ pubkey, ...event });
      return {
        ...event,
        id,
        pubkey,
        sig: bytesToHex(
          schnorr.sign(hexToBytes(id), hexToBytes(testPrivateKey)),
        ),
      };
    },
  };
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
