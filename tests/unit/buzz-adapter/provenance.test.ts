import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';

import {
  DatabaseProvenanceWriter,
  isRetryableBuzzFailure,
} from '../../../packages/buzz-adapter/src/provenance.js';
import {
  verifyEvent,
  type VerifiedBuzzEvent,
} from '../../../packages/buzz-adapter/src/event-codec.js';

describe('Buzz event provenance', () => {
  it('records a verified proposal with its workspace, passport, channel, and proposer identity', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const writer = new DatabaseProvenanceWriter({
      async call(name, args) {
        calls.push({ name, args });
        return 'stored';
      },
    });
    const event = signedProposalEvent();

    await expect(
      (
        writer as DatabaseProvenanceWriter & {
          recordProposal(input: Record<string, unknown>): Promise<string>;
        }
      ).recordProposal({
        event,
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        actionPassportId: '5fa2a464-8c93-4452-aa65-83e92a7a9e1f',
        relayUrl: 'wss://relay.example.test/',
      }),
    ).resolves.toBe('stored');

    expect(calls[0]).toEqual({
      name: 'record_verified_buzz_proposal',
      args: {
        target_workspace_id: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        target_action_passport_id: '5fa2a464-8c93-4452-aa65-83e92a7a9e1f',
        source_relay_url: 'wss://relay.example.test/',
        source_raw_event_json: {
          id: event.id,
          pubkey: event.pubkey,
          created_at: event.createdAt,
          kind: 9,
          tags: event.tags,
          content: event.content,
          sig: event.sig,
        },
      },
    });
  });

  it('rejects a signed proposal whose passport hash differs from the stored passport', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const writer = new DatabaseProvenanceWriter(
      {
        async call(name, args) {
          calls.push({ name, args });
          return 'stored';
        },
      },
      {
        async readPassportHash() {
          return 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
        },
      },
    );

    await expect(
      writer.recordProposal({
        event: signedProposalEvent(),
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        actionPassportId: '5fa2a464-8c93-4452-aa65-83e92a7a9e1f',
        relayUrl: 'wss://relay.example.test/',
      }),
    ).rejects.toThrow('does not match the stored passport hash');
    expect(calls).toHaveLength(0);
  });

  it('retries only explicitly transient relay failures', () => {
    expect(isRetryableBuzzFailure('network_timeout')).toBe(true);
    expect(isRetryableBuzzFailure('relay_unavailable')).toBe(true);
    expect(isRetryableBuzzFailure('invalid_signature')).toBe(false);
    expect(isRetryableBuzzFailure('unauthorized_signer')).toBe(false);
    expect(isRetryableBuzzFailure('malformed_event')).toBe(false);
    expect(isRetryableBuzzFailure('policy_denied')).toBe(false);
  });

  it('records an approval observation without invoking the lifecycle-bypassing RPC', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const writer = new DatabaseProvenanceWriter({
      async call(name, args) {
        calls.push({ name, args });
        return 'applied';
      },
    });
    const event = signedVerifiedEvent();

    await expect(
      writer.recordAndApply({
        event,
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        actionPassportId: '6fa2a464-8c93-4452-aa65-83e92a7a9e1f',
        approvedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-10T01:00:00.000Z',
        relayUrl: 'wss://relay.example.test/',
      } as never),
    ).resolves.toBe('applied');

    expect(calls).toEqual([
      {
        name: 'record_verified_buzz_approval_observation',
        args: {
          target_workspace_id: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
          source_approved_at: '2026-08-10T00:00:00.000Z',
          source_expires_at: '2026-08-10T01:00:00.000Z',
          source_relay_url: 'wss://relay.example.test/',
          source_raw_event_json: {
            id: event.id,
            pubkey: event.pubkey,
            created_at: event.createdAt,
            kind: event.kind,
            tags: event.tags,
            content: event.content,
            sig: event.sig,
          },
        },
      },
    ]);
  });

  it('fails closed for a signed kind-9 event with the wrong content shape', async () => {
    const calls: string[] = [];
    const writer = new DatabaseProvenanceWriter({
      async call(name) {
        calls.push(name);
        return 'stored';
      },
    });
    const event = signedVerifiedEvent({
      kind: 9,
      tags: [['e', 'c'.repeat(64)]],
      content: '{"decision":"approved"}',
    });

    await expect(
      writer.recordAndApply({
        event,
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        approvedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-10T01:00:00.000Z',
        relayUrl: 'wss://relay.example.test/',
      }),
    ).rejects.toThrow('approval decision');
    expect(calls).toHaveLength(0);
  });

  it('records the approval expiry for a canonical kind-9 decision payload', async () => {
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const writer = new DatabaseProvenanceWriter({
      async call(name, args) {
        calls.push({ name, args });
        return 'stored';
      },
    });
    const event = signedVerifiedEvent({
      kind: 9,
      tags: [['e', 'c'.repeat(64)]],
      content: '{"proofline":{"decision":"approved"}}',
    });

    await expect(
      writer.recordAndApply({
        event,
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        approvedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-10T01:00:00.000Z',
        relayUrl: 'wss://relay.example.test/',
      }),
    ).resolves.toBe('stored');
    expect(calls[0]).toMatchObject({
      name: 'record_verified_buzz_approval_observation',
      args: {
        source_approved_at: '2026-08-10T00:00:00.000Z',
        source_expires_at: '2026-08-10T01:00:00.000Z',
      },
    });
  });

  it('rejects a caller-labeled verified event whose raw signature cannot verify', async () => {
    const writer = new DatabaseProvenanceWriter({
      async call() {
        return 'applied';
      },
    });

    await expect(
      writer.recordAndApply({
        event: {
          id: 'a'.repeat(64),
          pubkey: 'b'.repeat(64),
          createdAt: 1_700_000_000,
          kind: 7,
          tags: [['e', 'c'.repeat(64)]],
          content: '+',
          sig: 'd'.repeat(128),
          rawHash: 'a'.repeat(64),
        } as unknown as VerifiedBuzzEvent,
        workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
        approvedAt: '2026-08-10T00:00:00.000Z',
        expiresAt: '2026-08-10T01:00:00.000Z',
        relayUrl: 'wss://relay.example.test/',
      }),
    ).rejects.toThrow('cryptographically verified');
  });
});

function signedVerifiedEvent(
  overrides: Partial<{
    kind: number;
    tags: string[][];
    content: string;
  }> = {},
): VerifiedBuzzEvent {
  const privateKey = '4'.repeat(64);
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
  const createdAt = 1_700_000_000;
  const kind = overrides.kind ?? 7;
  const tags = overrides.tags ?? [['e', 'c'.repeat(64)]];
  const content = overrides.content ?? '+';
  const id = createHash('sha256')
    .update(JSON.stringify([0, pubkey, createdAt, kind, tags, content]))
    .digest('hex');
  const verified = verifyEvent({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKey))),
  });
  if ('code' in verified) throw new Error(verified.message);
  return verified;
}

function signedProposalEvent(): VerifiedBuzzEvent {
  const privateKey = '5'.repeat(64);
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(privateKey)));
  const createdAt = 1_700_000_001;
  const kind = 9;
  const tags = [['h', 'proofline-demo-channel']];
  const content =
    '{"proofline":{"schema":"proofline.passport.v1","type":"proposal","passportHash":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"}}';
  const id = createHash('sha256')
    .update(JSON.stringify([0, pubkey, createdAt, kind, tags, content]))
    .digest('hex');
  const verified = verifyEvent({
    id,
    pubkey,
    created_at: createdAt,
    kind,
    tags,
    content,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(privateKey))),
  });
  if ('code' in verified) throw new Error(verified.message);
  return verified;
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
