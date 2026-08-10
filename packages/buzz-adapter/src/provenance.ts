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

  async recordAndApply(input: {
    event: VerifiedBuzzEvent;
    workspaceId: string;
    actionPassportId: string;
    approvedAt: string;
    expiresAt: string;
    relayUrl: string;
  }): Promise<string> {
    const rawEvent = {
      id: input.event.id,
      pubkey: input.event.pubkey,
      created_at: input.event.createdAt,
      kind: input.event.kind,
      tags: input.event.tags,
      content: input.event.content,
      sig: input.event.sig,
    };
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
      target_action_passport_id: input.actionPassportId,
      source_approved_at: input.approvedAt,
      source_expires_at: input.expiresAt,
      source_relay_url: input.relayUrl,
      source_raw_event_json: rawEvent,
    });
  }
}
