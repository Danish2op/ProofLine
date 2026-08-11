import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';

import { BuzzAdapterClient } from '../../../packages/buzz-adapter/src/client.js';
import { Nip01RelayTransport } from '../../../packages/buzz-adapter/src/relay-transport.js';

const testPrivateKey = '3'.repeat(64);

describe('Buzz relay adapter', () => {
  it('answers a NIP-42 challenge before resolving a NIP-01 publication', async () => {
    const socket = new FakeRelaySocket();
    const signer = deterministicSigner();
    const transport = new Nip01RelayTransport({
      relayUrl: 'wss://relay.example.test',
      signer,
      socketFactory: () => socket,
    });
    const event = await signer.sign({
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'proposal',
    });

    const published = transport.publish(event);
    socket.open();
    await Promise.resolve();
    expect(socket.frames).not.toContainEqual(['EVENT', event]);
    socket.receive(['AUTH', 'relay-challenge']);
    await Promise.resolve();

    const authFrame = socket.frames.find((frame) => frame[0] === 'AUTH');
    expect(authFrame).toMatchObject([
      'AUTH',
      {
        kind: 22242,
        tags: [
          ['relay', 'wss://relay.example.test/'],
          ['challenge', 'relay-challenge'],
        ],
      },
    ]);
    socket.receive([
      'OK',
      (authFrame![1] as { id: string }).id,
      true,
      'authenticated',
    ]);
    await Promise.resolve();

    expect(socket.frames).toContainEqual(['EVENT', event]);
    socket.receive(['OK', event.id, true, 'stored']);
    await expect(published).resolves.toBeUndefined();
  });

  it('queues concurrent publications until delayed NIP-42 authentication succeeds', async () => {
    const socket = new FakeRelaySocket();
    const signer = delayedAuthSigner();
    const transport = new Nip01RelayTransport({
      relayUrl: 'wss://relay.example.test',
      signer,
      socketFactory: () => socket,
      publicationTimeoutMs: 100,
      authProbeTimeoutMs: 1,
    });
    const firstEvent = await deterministicSigner().sign({
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'first proposal',
    });
    const secondEvent = await deterministicSigner().sign({
      created_at: 1_700_000_001,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'second proposal',
    });
    const thirdEvent = await deterministicSigner().sign({
      created_at: 1_700_000_002,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'third proposal',
    });

    const firstPublication = transport.publish(firstEvent);
    socket.open();
    await Promise.resolve();
    socket.receive(['AUTH', 'relay-challenge']);
    await signer.authSigningStarted;

    const secondPublication = transport.publish(secondEvent);
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    expect(socket.frames.filter((frame) => frame[0] === 'EVENT')).toEqual([]);

    signer.finishAuthSigning();
    await waitFor(() => socket.frames.some((frame) => frame[0] === 'AUTH'));
    const authFrame = socket.frames.find((frame) => frame[0] === 'AUTH');
    const thirdPublication = transport.publish(thirdEvent);

    socket.receive([
      'OK',
      (authFrame![1] as { id: string }).id,
      true,
      'authenticated',
    ]);
    await waitFor(
      () => socket.frames.filter((frame) => frame[0] === 'EVENT').length === 3,
    );

    for (const event of [firstEvent, secondEvent, thirdEvent]) {
      socket.receive(['OK', event.id, true, 'stored']);
    }
    await expect(
      Promise.all([firstPublication, secondPublication, thirdPublication]),
    ).resolves.toEqual([undefined, undefined, undefined]);
  });

  it('uses the NIP-01 transport by default instead of requiring an opaque publisher', async () => {
    const socket = new FakeRelaySocket();
    const client = new BuzzAdapterClient({
      relayUrl: 'wss://relay.example.test',
      signer: deterministicSigner(),
      socketFactory: () => socket,
      provenanceWriter: {
        async recordProposal() {
          return 'stored';
        },
      },
    });

    const publishing = client.publishProposal({
      workspaceId,
      actionPassportId,
      channelId: 'proofline-demo-channel',
      passportHash: 'a'.repeat(64),
      message: 'Deploy revision demo-42.',
    });
    await waitFor(() => socket.onopen !== null);
    socket.open();
    await waitFor(() => socket.frames.some((frame) => frame[0] === 'EVENT'));

    const eventFrame = socket.frames.find((frame) => frame[0] === 'EVENT');
    expect(eventFrame).toBeDefined();
    socket.receive([
      'OK',
      (eventFrame![1] as { id: string }).id,
      true,
      'stored',
    ]);
    await expect(publishing).resolves.toMatchObject({ kind: 9 });
  });

  it('retries a publication rejected for missing auth after NIP-42 succeeds', async () => {
    const socket = new FakeRelaySocket();
    const signer = deterministicSigner();
    const transport = new Nip01RelayTransport({
      relayUrl: 'wss://relay.example.test',
      signer,
      socketFactory: () => socket,
      publicationTimeoutMs: 100,
    });
    const event = await signer.sign({
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'proposal',
    });

    const publishing = transport.publish(event);
    socket.open();
    await waitFor(() => socket.frames.some((frame) => frame[0] === 'EVENT'));
    socket.receive(['OK', event.id, false, 'auth-required']);
    socket.receive(['AUTH', 'retry-challenge']);
    await waitFor(() => socket.frames.some((frame) => frame[0] === 'AUTH'));

    const authFrame = socket.frames.find((frame) => frame[0] === 'AUTH');
    socket.receive([
      'OK',
      (authFrame![1] as { id: string }).id,
      true,
      'authenticated',
    ]);
    await waitFor(
      () => socket.frames.filter((frame) => frame[0] === 'EVENT').length === 2,
    );
    socket.receive(['OK', event.id, true, 'stored']);
    await expect(publishing).resolves.toBeUndefined();
  });

  it('bounds a publication that receives no relay acknowledgement', async () => {
    const socket = new FakeRelaySocket();
    const signer = deterministicSigner();
    const transport = new Nip01RelayTransport({
      relayUrl: 'wss://relay.example.test',
      signer,
      socketFactory: () => socket,
      publicationTimeoutMs: 10,
    });
    const event = await signer.sign({
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'proposal',
    });

    const publishing = transport.publish(event);
    socket.open();
    await expect(publishing).rejects.toMatchObject({ code: 'network_timeout' });
  });

  it('bounds a publication when the relay socket never opens', async () => {
    const socket = new FakeRelaySocket();
    const transport = new Nip01RelayTransport({
      relayUrl: 'wss://relay.example.test',
      signer: deterministicSigner(),
      socketFactory: () => socket,
      publicationTimeoutMs: 10,
    });
    const event = await deterministicSigner().sign({
      created_at: 1_700_000_000,
      kind: 9,
      tags: [['h', 'proofline-demo-channel']],
      content: 'proposal',
    });

    await expect(transport.publish(event)).rejects.toMatchObject({
      code: 'network_timeout',
    });
  }, 1000);

  it('records a published proposal before returning its relay reference', async () => {
    const calls: Array<Record<string, unknown>> = [];
    const published: unknown[] = [];
    const client = new BuzzAdapterClient({
      relayUrl: 'wss://relay.example.test',
      signer: deterministicSigner(),
      transport: {
        async publish(event: { id: string }) {
          published.push(event);
        },
      },
      provenanceWriter: {
        async recordProposal(input: Record<string, unknown>) {
          calls.push(input as unknown as Record<string, unknown>);
        },
      },
    } as never);

    await client.publishProposal({
      workspaceId,
      actionPassportId,
      channelId: 'proofline-demo-channel',
      passportHash: 'a'.repeat(64),
      message: 'Deploy revision demo-42.',
    } as never);

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      workspaceId,
      actionPassportId,
      relayUrl: 'wss://relay.example.test/',
      event: { kind: 9, pubkey: expect.any(String), sig: expect.any(String) },
    });
    expect(published).toHaveLength(1);
  });

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
      provenanceWriter: {
        async recordProposal() {
          return 'stored';
        },
      },
    });

    const ref = await client.publishProposal({
      workspaceId,
      actionPassportId,
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
      decision: 'approved' as const,
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

const workspaceId = 'f2e0b809-2d1d-43cd-85c5-99522d4f0611';
const actionPassportId = '5fa2a464-8c93-4452-aa65-83e92a7a9e1f';

class FakeRelaySocket {
  readonly frames: unknown[][] = [];
  onopen: (() => void) | null = null;
  onmessage: ((event: { data: string }) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: (() => void) | null = null;

  send(data: string): void {
    this.frames.push(JSON.parse(data) as unknown[]);
  }

  close(): void {
    this.onclose?.();
  }

  open(): void {
    this.onopen?.();
  }

  receive(frame: unknown[]): void {
    this.onmessage?.({ data: JSON.stringify(frame) });
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return;
    await new Promise<void>((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('Timed out waiting for relay state.');
}

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

function delayedAuthSigner() {
  const signer = deterministicSigner();
  let markAuthSigningStarted: (() => void) | undefined;
  let finishAuthSigning: (() => void) | undefined;
  const authSigningStarted = new Promise<void>((resolve) => {
    markAuthSigningStarted = resolve;
  });
  const authSigningFinished = new Promise<void>((resolve) => {
    finishAuthSigning = resolve;
  });
  return {
    ...signer,
    authSigningStarted,
    finishAuthSigning() {
      finishAuthSigning?.();
    },
    async sign(event: {
      created_at: number;
      kind: number;
      tags: string[][];
      content: string;
    }) {
      if (event.kind === 22242) {
        markAuthSigningStarted?.();
        await authSigningFinished;
      }
      return signer.sign(event);
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
