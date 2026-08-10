import type { VerifiedBuzzEvent } from './event-codec.js';

export type ApprovalDecision = 'approved' | 'rejected' | 'request_changes';

export interface ApprovalObservation {
  decision: ApprovalDecision;
  eventId: string;
  proposalEventId: string;
  reviewerPubkey: string;
  workspaceId: string;
  channelId: string;
}

export interface ApprovalParseError {
  code:
    | 'invalid_event'
    | 'wrong_event_kind'
    | 'missing_proposal_reference'
    | 'wrong_channel'
    | 'unknown_reviewer'
    | 'self_approval'
    | 'unrecognized_decision';
  message: string;
  retryable: false;
}

export interface ApprovalParserContext {
  proposalEventId: string;
  workspaceId: string;
  channelId: string;
  reviewerIdentities: ReadonlyMap<string, { active: boolean }>;
  proposal: {
    workspaceId: string;
    channelId: string;
    proposerPubkey: string;
  } | null;
}

export function parseApprovalEvent(
  event: VerifiedBuzzEvent | { code: string },
  context: ApprovalParserContext,
): ApprovalObservation | ApprovalParseError {
  if ('code' in event) {
    return error(
      'invalid_event',
      'Buzz event must verify before approval parsing.',
    );
  }
  if (!context.proposal) {
    return error(
      'missing_proposal_reference',
      'Referenced proposal is not stored.',
    );
  }
  if (
    context.proposal.workspaceId !== context.workspaceId ||
    context.proposal.channelId !== context.channelId
  ) {
    return error(
      'wrong_channel',
      'Referenced proposal does not prove this channel.',
    );
  }
  if (!referencesProposal(event, context.proposalEventId)) {
    return error(
      'missing_proposal_reference',
      'Approval event does not reference the exact proposal.',
    );
  }
  if (!matchesChannelWhenPresent(event, context.channelId)) {
    return error(
      'wrong_channel',
      'Buzz event channel does not match the proposal.',
    );
  }
  if (context.reviewerIdentities.get(event.pubkey)?.active !== true) {
    return error(
      'unknown_reviewer',
      'Buzz signer is not an authorized reviewer.',
    );
  }
  if (event.pubkey === context.proposal.proposerPubkey) {
    return error(
      'self_approval',
      'Proposal proposer cannot approve their own proposal.',
    );
  }

  const decision = decisionFor(event);
  if (!decision) {
    return error(
      'unrecognized_decision',
      'Buzz event does not express a supported approval decision.',
    );
  }

  return {
    decision,
    eventId: event.id,
    proposalEventId: context.proposalEventId,
    reviewerPubkey: event.pubkey,
    workspaceId: context.workspaceId,
    channelId: context.channelId,
  };
}

function referencesProposal(
  event: VerifiedBuzzEvent,
  proposalEventId: string,
): boolean {
  return event.tags.some((tag) => tag[0] === 'e' && tag[1] === proposalEventId);
}

function matchesChannelWhenPresent(
  event: VerifiedBuzzEvent,
  channelId: string,
): boolean {
  return event.tags
    .filter((tag) => tag[0] === 'h')
    .every((tag) => tag[1] === channelId);
}

function decisionFor(event: VerifiedBuzzEvent): ApprovalDecision | null {
  if (event.kind === 7) {
    if (['+', '✅', '👍'].includes(event.content)) return 'approved';
    if (['-', '❌', '👎'].includes(event.content)) return 'rejected';
    return null;
  }
  if (event.kind !== 9) return null;

  const content = parseMessageContent(event.content);
  return content?.proofline?.decision ?? null;
}

function parseMessageContent(
  content: string,
): { proofline?: { decision?: ApprovalDecision } } | null {
  try {
    const parsed: unknown = JSON.parse(content);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const proofline = (parsed as Record<string, unknown>).proofline;
    if (typeof proofline !== 'object' || proofline === null) return null;
    const decision = (proofline as Record<string, unknown>).decision;
    return decision === 'approved' ||
      decision === 'rejected' ||
      decision === 'request_changes'
      ? { proofline: { decision } }
      : null;
  } catch {
    return null;
  }
}

function error(
  code: ApprovalParseError['code'],
  message: string,
): ApprovalParseError {
  return { code, message, retryable: false };
}
