import { createHash } from 'node:crypto';

import { schnorr } from '@noble/curves/secp256k1.js';
import { describe, expect, it } from 'vitest';

import { parseApprovalEvent } from '../../../packages/buzz-adapter/src/approval-parser.js';
import { verifyEvent } from '../../../packages/buzz-adapter/src/event-codec.js';

const testPrivateKey = '2'.repeat(64);
const proposalEventId = 'a'.repeat(64);
const workspaceId = 'f2e0b809-2d1d-43cd-85c5-99522d4f0611';
const channelId = 'proofline-demo-channel';

describe('Buzz approval parsing', () => {
  it('accepts an authorized NIP-25 approval that references only the stored proposal event', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [['e', proposalEventId]],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toEqual({
      decision: 'approved',
      eventId: expect.any(String),
      proposalEventId,
      reviewerPubkey,
      workspaceId,
      channelId,
    });
  });

  it('maps an authorized negative NIP-25 reaction to rejection', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [['e', proposalEventId]],
        content: '-',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ decision: 'rejected' });
  });

  it('rejects a reaction that claims a channel other than the stored proposal channel', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [
          ['e', proposalEventId],
          ['h', 'other-channel'],
        ],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ code: 'wrong_channel', retryable: false });
  });

  it('rejects a validly signed approval from a public key outside the server reviewer set', () => {
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [['e', proposalEventId]],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([['d'.repeat(64), { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ code: 'unknown_reviewer', retryable: false });
  });

  it('rejects an active reviewer who is also the stored proposal proposer', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [['e', proposalEventId]],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: reviewerPubkey },
      }),
    ).toMatchObject({ code: 'self_approval', retryable: false });
  });

  it('rejects a reviewer identity that the server has revoked', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [['e', proposalEventId]],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: false }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ code: 'unknown_reviewer', retryable: false });
  });

  it('maps a thread reply with structured request-changes content', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 9,
        tags: [['e', proposalEventId, '', 'reply']],
        content: '{"proofline":{"decision":"request_changes"}}',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ decision: 'request_changes' });
  });

  it('uses the last e tag as the NIP-25 proposal target', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 7,
        tags: [
          ['e', 'b'.repeat(64)],
          ['e', proposalEventId],
        ],
        content: '+',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ decision: 'approved' });
    expect(
      parseApprovalEvent(verified, {
        proposalEventId: 'b'.repeat(64),
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ code: 'missing_proposal_reference' });
  });

  it('fails closed when a message decision has malformed JSON content', () => {
    const reviewerPubkey = bytesToHex(
      schnorr.getPublicKey(hexToBytes(testPrivateKey)),
    );
    const verified = verifyEvent(
      signedEvent({
        kind: 9,
        tags: [['e', proposalEventId, '', 'reply']],
        content: '{not-json',
      }),
    );

    expect(
      parseApprovalEvent(verified, {
        proposalEventId,
        workspaceId,
        channelId,
        reviewerIdentities: new Map([[reviewerPubkey, { active: true }]]),
        proposal: { workspaceId, channelId, proposerPubkey: 'e'.repeat(64) },
      }),
    ).toMatchObject({ code: 'unrecognized_decision', retryable: false });
  });
});

function signedEvent(input: {
  kind: number;
  tags: string[][];
  content: string;
}) {
  const pubkey = bytesToHex(schnorr.getPublicKey(hexToBytes(testPrivateKey)));
  const created_at = 1_700_000_001;
  const id = eventId({ pubkey, created_at, ...input });
  return {
    id,
    pubkey,
    created_at,
    ...input,
    sig: bytesToHex(schnorr.sign(hexToBytes(id), hexToBytes(testPrivateKey))),
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
