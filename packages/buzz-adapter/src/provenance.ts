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

export interface BuzzPassportHashReader {
  readPassportHash(
    workspaceId: string,
    actionPassportId: string,
  ): Promise<string | null>;
}

export class DatabaseProvenanceWriter {
  constructor(
    private readonly rpc: BuzzProvenanceRpc,
    private readonly passportHashReader?: BuzzPassportHashReader,
  ) {}

  async recordProposal(input: {
    event: VerifiedBuzzEvent;
    workspaceId: string;
    actionPassportId: string;
    relayUrl: string;
  }): Promise<string> {
    const rawEvent = verifiedRawEvent(input.event);
    if (this.passportHashReader) {
      const signedPassportHash = passportHashFromEvent(rawEvent);
      const storedPassportHash = await this.passportHashReader.readPassportHash(
        input.workspaceId,
        input.actionPassportId,
      );
      if (!signedPassportHash || signedPassportHash !== storedPassportHash) {
        throw new Error(
          'Signed proposal does not match the stored passport hash.',
        );
      }
    }
    return this.rpc.call('record_verified_buzz_proposal', {
      target_workspace_id: input.workspaceId,
      target_action_passport_id: input.actionPassportId,
      source_relay_url: input.relayUrl,
      source_raw_event_json: rawEvent,
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
    if (approvalDecision(rawEvent) !== 'approved') {
      throw new Error(
        'Verified Buzz event has no supported approval decision.',
      );
    }
    const approvedAt = Date.parse(input.approvedAt);
    const expiresAt = Date.parse(input.expiresAt);
    if (
      !Number.isFinite(approvedAt) ||
      !Number.isFinite(expiresAt) ||
      expiresAt <= approvedAt
    ) {
      throw new Error('Verified Buzz approval decision has invalid expiry.');
    }

    return this.rpc.call('record_verified_buzz_approval_observation', {
      target_workspace_id: input.workspaceId,
      source_approved_at: input.approvedAt,
      source_expires_at: input.expiresAt,
      source_relay_url: input.relayUrl,
      source_raw_event_json: rawEvent,
    });
  }
}

function approvalDecision(
  event: ReturnType<typeof verifiedRawEvent>,
): 'approved' | 'rejected' | 'request_changes' | null {
  if (event.kind === 7) {
    if (['+', '✅', '👍'].includes(event.content)) return 'approved';
    if (['-', '❌', '👎'].includes(event.content)) return 'rejected';
    return null;
  }
  if (event.kind !== 9) return null;
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const proofline = (parsed as Record<string, unknown>).proofline;
    if (typeof proofline !== 'object' || proofline === null) return null;
    const decision = (proofline as Record<string, unknown>).decision;
    return decision === 'approved' ||
      decision === 'rejected' ||
      decision === 'request_changes'
      ? decision
      : null;
  } catch {
    return null;
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

function passportHashFromEvent(event: { content: string }): string | null {
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const proofline = (parsed as Record<string, unknown>).proofline;
    if (typeof proofline !== 'object' || proofline === null) return null;
    const passportHash = (proofline as Record<string, unknown>).passportHash;
    return typeof passportHash === 'string' &&
      /^[0-9a-f]{64}$/.test(passportHash)
      ? passportHash
      : null;
  } catch {
    return null;
  }
}
