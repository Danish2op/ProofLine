import { describe, expect, it } from 'vitest';

import {
  EventProvenanceLayer,
  isRetryableBuzzFailure,
} from '../../../packages/buzz-adapter/src/provenance.js';

describe('Buzz event provenance', () => {
  it('records a replayed event ID as duplicate without applying a second approval transition', () => {
    const provenance = new EventProvenanceLayer();
    const observation = {
      decision: 'approve' as const,
      eventId: 'a'.repeat(64),
      proposalEventId: 'b'.repeat(64),
      reviewerPubkey: 'c'.repeat(64),
      workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
      channelId: 'proofline-demo-channel',
    };

    expect(provenance.recordApproval(observation, 'PENDING_APPROVAL')).toEqual({
      status: 'applied',
      nextStatus: 'APPROVED',
    });
    expect(provenance.recordApproval(observation, 'PENDING_APPROVAL')).toEqual({
      status: 'duplicate',
      nextStatus: null,
    });
  });

  it('records an out-of-order decision without replacing an already-applied approval transition', () => {
    const provenance = new EventProvenanceLayer();
    const approved = {
      decision: 'approve' as const,
      eventId: 'a'.repeat(64),
      proposalEventId: 'b'.repeat(64),
      reviewerPubkey: 'c'.repeat(64),
      workspaceId: 'f2e0b809-2d1d-43cd-85c5-99522d4f0611',
      channelId: 'proofline-demo-channel',
    };

    expect(provenance.recordApproval(approved, 'PENDING_APPROVAL')).toEqual({
      status: 'applied',
      nextStatus: 'APPROVED',
    });
    expect(
      provenance.recordApproval(
        { ...approved, eventId: 'd'.repeat(64), decision: 'reject' },
        'APPROVED',
      ),
    ).toEqual({ status: 'recorded_unapplied', nextStatus: null });
  });

  it('retries only explicitly transient relay failures', () => {
    expect(isRetryableBuzzFailure('network_timeout')).toBe(true);
    expect(isRetryableBuzzFailure('relay_unavailable')).toBe(true);
    expect(isRetryableBuzzFailure('invalid_signature')).toBe(false);
    expect(isRetryableBuzzFailure('unauthorized_signer')).toBe(false);
    expect(isRetryableBuzzFailure('malformed_event')).toBe(false);
    expect(isRetryableBuzzFailure('policy_denied')).toBe(false);
  });
});
