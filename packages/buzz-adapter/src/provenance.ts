import { verifyEvent, type VerifiedBuzzEvent } from './event-codec.js';

export type BuzzFailureCode =
  | 'network_timeout'
  | 'relay_unavailable'
  | 'invalid_signature'
  | 'unauthorized_signer'
  | 'malformed_event'
  | 'policy_denied';

export function isRetryableBuzzFailure(code: BuzzFailureCode): boolean {
  return code === 'network_timeout' || code === 'relay_unavailable';
}

export interface BuzzProvenanceRpc {
  call(name: string, args: Record<string, unknown>): Promise<string>;
}

export class DatabaseProvenanceWriter {
  constructor(private readonly rpc: BuzzProvenanceRpc) {}

  async recordProposal(input: {
    event: VerifiedBuzzEvent;
    workspaceId: string;
    actionPassportId: string;
    relayUrl: string;
  }): Promise<string> {
    return this.rpc.call('record_verified_buzz_proposal', {
      target_workspace_id: input.workspaceId,
      target_action_passport_id: input.actionPassportId,
      source_relay_url: input.relayUrl,
      source_raw_event_json: verifiedRawEvent(input.event),
    });
  }

  async recordAndApply(input: {
    event: VerifiedBuzzEvent;
    workspaceId: string;
    approvedAt: string;
    expiresAt: string;
    relayUrl: string;
  }): Promise<string> {
    const rawEvent = verifiedRawEvent(input.event);
    const verification = verifyEvent(rawEvent);
    if (
      'code' in verification ||
      verification.rawHash !== input.event.rawHash
    ) {
      throw new Error(
        'Provenance RPC requires a cryptographically verified Buzz event.',
      );
    }

    return this.rpc.call('apply_verified_buzz_approval', {
      target_workspace_id: input.workspaceId,
      source_approved_at: input.approvedAt,
      source_expires_at: input.expiresAt,
      source_relay_url: input.relayUrl,
      source_raw_event_json: rawEvent,
    });
  }
}

function verifiedRawEvent(event: VerifiedBuzzEvent) {
  const rawEvent = {
    id: event.id,
    pubkey: event.pubkey,
    created_at: event.createdAt,
    kind: event.kind,
    tags: event.tags,
    content: event.content,
    sig: event.sig,
  };
  const verification = verifyEvent(rawEvent);
  if ('code' in verification || verification.rawHash !== event.rawHash) {
    throw new Error(
      'Provenance RPC requires a cryptographically verified Buzz event.',
    );
  }
  return rawEvent;
}
