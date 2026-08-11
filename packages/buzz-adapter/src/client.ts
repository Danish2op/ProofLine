import {
  maxBuzzEventContentBytes,
  verifyEvent,
  type BuzzAdapterError,
  type VerifiedBuzzEvent,
} from './event-codec.js';
import type { ApprovalObservation } from './approval-parser.js';
import { Nip01RelayTransport, type RelaySocket } from './relay-transport.js';

export interface BuzzEventRef {
  eventId: string;
  relayUrl: string;
  pubkey: string;
  createdAt: number;
  kind: number;
  rawHash: string;
}

export interface BuzzProposalInput {
  workspaceId: string;
  actionPassportId: string;
  channelId: string;
  passportHash: string;
  message: string;
  replyToEventId?: string;
  recipientPubkeys?: readonly string[];
}

export interface BuzzVerificationInput extends BuzzProposalInput {
  proposalEventId: string;
}

export interface BuzzReceiptInput extends BuzzProposalInput {
  proposalEventId: string;
  receiptHash: string;
}

export interface BuzzSigner {
  pubkey: string;
  sign(event: BuzzUnsignedEvent): Promise<BuzzSignedEvent>;
}

export interface BuzzTransport {
  publish(event: BuzzSignedEvent): Promise<void>;
}

export interface BuzzApprovalReader {
  readApprovalForProposal(
    proposalEventId: string,
  ): Promise<ApprovalObservation>;
}

export interface BuzzProposalProvenanceWriter {
  recordProposal(input: {
    event: VerifiedBuzzEvent;
    workspaceId: string;
    actionPassportId: string;
    relayUrl: string;
  }): Promise<string>;
}

export interface BuzzUnsignedEvent {
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
}

export interface BuzzSignedEvent extends BuzzUnsignedEvent {
  id: string;
  pubkey: string;
  sig: string;
}

export class BuzzClientError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'invalid_signed_event',
    message: string,
  ) {
    super(message);
  }
}

export class BuzzAdapterClient {
  readonly relayUrl: string;
  private readonly transport: BuzzTransport;

  constructor(
    private readonly options: {
      relayUrl: string;
      signer: BuzzSigner;
      transport?: BuzzTransport;
      socketFactory?: (relayUrl: string) => RelaySocket;
      approvalReader?: BuzzApprovalReader;
      provenanceWriter?: BuzzProposalProvenanceWriter;
    },
  ) {
    this.relayUrl = normalizeRelayUrl(options.relayUrl);
    this.transport =
      options.transport ??
      new Nip01RelayTransport({
        relayUrl: this.relayUrl,
        signer: options.signer,
        socketFactory: options.socketFactory,
      });
  }

  publishProposal(input: BuzzProposalInput): Promise<BuzzEventRef> {
    return this.publishMessage('proposal', input);
  }

  publishVerification(input: BuzzVerificationInput): Promise<BuzzEventRef> {
    return this.publishMessage('verification', input, input.proposalEventId);
  }

  publishExecutionReceipt(input: BuzzReceiptInput): Promise<BuzzEventRef> {
    return this.publishMessage('receipt', input, input.proposalEventId, {
      receiptHash: input.receiptHash,
    });
  }

  async readApprovalForProposal(
    proposalEventId: string,
  ): Promise<ApprovalObservation> {
    if (!this.options.approvalReader) {
      throw new BuzzClientError(
        'invalid_input',
        'Buzz approval provenance reader is required.',
      );
    }
    return this.options.approvalReader.readApprovalForProposal(proposalEventId);
  }

  private async publishMessage(
    type: 'proposal' | 'verification' | 'receipt',
    input: BuzzProposalInput,
    proposalEventId?: string,
    additionalProoflineFields: Record<string, string> = {},
  ): Promise<BuzzEventRef> {
    assertPassportHash(input.passportHash);
    assertChannelId(input.channelId);
    const tags = buildTags(input, proposalEventId);
    const content = JSON.stringify({
      proofline: {
        schema: 'proofline.passport.v1',
        type,
        passportHash: input.passportHash,
        ...additionalProoflineFields,
      },
      message: input.message,
    });
    if (
      new TextEncoder().encode(content).byteLength > maxBuzzEventContentBytes
    ) {
      throw new BuzzClientError(
        'invalid_input',
        'Buzz event content exceeds the maximum size.',
      );
    }

    const signed = await this.options.signer.sign({
      created_at: Math.floor(Date.now() / 1_000),
      kind: 9,
      tags,
      content,
    });
    if (signed.pubkey !== this.options.signer.pubkey) {
      throw new BuzzClientError(
        'invalid_signed_event',
        'Signer returned an event for a different public key.',
      );
    }

    const verified = verifyEvent(signed);
    if (isAdapterError(verified)) {
      throw new BuzzClientError('invalid_signed_event', verified.message);
    }
    if (type === 'proposal') {
      if (!this.options.provenanceWriter) {
        throw new BuzzClientError(
          'invalid_input',
          'Buzz proposal provenance writer is required.',
        );
      }
      await this.options.provenanceWriter.recordProposal({
        event: verified,
        workspaceId: input.workspaceId,
        actionPassportId: input.actionPassportId,
        relayUrl: this.relayUrl,
      });
    }
    await this.transport.publish(signed);

    return {
      eventId: verified.id,
      relayUrl: this.relayUrl,
      pubkey: verified.pubkey,
      createdAt: verified.createdAt,
      kind: verified.kind,
      rawHash: verified.rawHash,
    };
  }
}

function buildTags(
  input: BuzzProposalInput,
  proposalEventId?: string,
): string[][] {
  const tags = [['h', input.channelId]];
  if (proposalEventId) tags.push(['e', proposalEventId, '', 'reply']);
  if (input.replyToEventId) tags.push(['e', input.replyToEventId, '', 'reply']);
  for (const pubkey of input.recipientPubkeys ?? []) tags.push(['p', pubkey]);
  return tags;
}

function normalizeRelayUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BuzzClientError('invalid_input', 'Buzz relay URL is invalid.');
  }
  if (
    (url.protocol !== 'ws:' && url.protocol !== 'wss:') ||
    url.username ||
    url.password
  ) {
    throw new BuzzClientError(
      'invalid_input',
      'Buzz relay URL is not allowed.',
    );
  }
  return url.toString();
}

function assertPassportHash(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) {
    throw new BuzzClientError('invalid_input', 'Passport hash is invalid.');
  }
}

function assertChannelId(value: string): void {
  if (value.length === 0 || value.length > 256) {
    throw new BuzzClientError('invalid_input', 'Buzz channel ID is invalid.');
  }
}

function isAdapterError(
  value: ReturnType<typeof verifyEvent>,
): value is BuzzAdapterError {
  return 'code' in value;
}
