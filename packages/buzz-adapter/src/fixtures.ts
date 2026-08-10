export type RecordedBuzzEvent = {
  id: string;
  pubkey: string;
  created_at: number;
  kind: number;
  tags: string[][];
  content: string;
  sig: string;
};

export type BuzzContractFixture = {
  name:
    | 'human-proposal-reply'
    | 'verifier-reply'
    | 'human-approval-reaction'
    | 'human-rejection-reaction'
    | 'duplicate-event'
    | 'out-of-order-event'
    | 'malformed-event'
    | 'unknown-signer';
  event: unknown;
  expectedParse: 'accept' | 'reject';
  note: string;
};

type ParseResult =
  { ok: true; event: RecordedBuzzEvent } | { ok: false; reason: string };

const channelId = '2f4e8f9d-3ab1-4f6d-9b1f-9d9d1d2d3d4d';
const humanPubkey = 'a'.repeat(64);
const verifierPubkey = 'b'.repeat(64);
const unknownPubkey = 'f'.repeat(64);
const signature = 'c'.repeat(128);

const proposalReply: RecordedBuzzEvent = {
  id: '1'.repeat(64),
  pubkey: humanPubkey,
  created_at: 1_700_000_100,
  kind: 9,
  tags: [
    ['h', channelId],
    ['e', '0'.repeat(64), '', 'reply'],
  ],
  content: 'Synthetic proposal: deploy revision demo-42 to staging.',
  sig: signature,
};

export const buzzContractFixtures: readonly BuzzContractFixture[] = [
  {
    name: 'human-proposal-reply',
    event: proposalReply,
    expectedParse: 'accept',
    note: 'Synthetic NIP-29 kind:9 reply with a channel reference and NIP-10 reply marker.',
  },
  {
    name: 'verifier-reply',
    event: {
      id: '2'.repeat(64),
      pubkey: verifierPubkey,
      created_at: 1_700_000_101,
      kind: 9,
      tags: [
        ['h', channelId],
        ['e', proposalReply.id, '', 'reply'],
      ],
      content:
        'Synthetic verifier reply: evidence and policy snapshot reviewed.',
      sig: signature,
    },
    expectedParse: 'accept',
    note: 'Synthetic verifier response; it is not a native Buzz approval record.',
  },
  {
    name: 'human-approval-reaction',
    event: {
      id: '3'.repeat(64),
      pubkey: humanPubkey,
      created_at: 1_700_000_102,
      kind: 7,
      tags: [
        ['h', channelId],
        ['e', proposalReply.id],
      ],
      content: '✅',
      sig: signature,
    },
    expectedParse: 'accept',
    note: 'Synthetic NIP-25 reaction; Proofline assigns any approval meaning later.',
  },
  {
    name: 'human-rejection-reaction',
    event: {
      id: '4'.repeat(64),
      pubkey: humanPubkey,
      created_at: 1_700_000_103,
      kind: 7,
      tags: [
        ['h', channelId],
        ['e', proposalReply.id],
      ],
      content: '❌',
      sig: signature,
    },
    expectedParse: 'accept',
    note: 'Synthetic NIP-25 reaction; Proofline assigns any rejection meaning later.',
  },
  {
    name: 'duplicate-event',
    event: proposalReply,
    expectedParse: 'accept',
    note: 'The same event ID is valid input; later event processing must deduplicate by ID.',
  },
  {
    name: 'out-of-order-event',
    event: {
      id: '5'.repeat(64),
      pubkey: verifierPubkey,
      created_at: 1_700_000_001,
      kind: 9,
      tags: [
        ['h', channelId],
        ['e', proposalReply.id, '', 'reply'],
      ],
      content: 'Synthetic delayed delivery with an earlier event timestamp.',
      sig: signature,
    },
    expectedParse: 'accept',
    note: 'Transport arrival order is not proof of event creation order.',
  },
  {
    name: 'malformed-event',
    event: {
      ...proposalReply,
      id: 'not-an-event-id',
    },
    expectedParse: 'reject',
    note: 'Invalid IDs are rejected before any business interpretation.',
  },
  {
    name: 'unknown-signer',
    event: {
      id: '6'.repeat(64),
      pubkey: unknownPubkey,
      created_at: 1_700_000_104,
      kind: 9,
      tags: [['h', channelId]],
      content:
        'Synthetic message from a structurally valid but untrusted signer.',
      sig: signature,
    },
    expectedParse: 'accept',
    note: 'Parsing is not trust evaluation; Proofline authorization remains a later boundary.',
  },
];

export function parseRecordedBuzzEvent(input: unknown): ParseResult {
  if (!isObject(input)) return invalid('event must be an object');
  if (!isHex(input.id, 64)) {
    return invalid(
      'event.id must be a 64-character lowercase hexadecimal string',
    );
  }
  if (!isHex(input.pubkey, 64)) {
    return invalid(
      'event.pubkey must be a 64-character lowercase hexadecimal string',
    );
  }
  if (!isNonNegativeSafeInteger(input.created_at)) {
    return invalid('event.created_at must be a non-negative safe integer');
  }
  if (!isNonNegativeSafeInteger(input.kind)) {
    return invalid('event.kind must be a non-negative safe integer');
  }
  if (!Array.isArray(input.tags) || !input.tags.every(isStringArray)) {
    return invalid('event.tags must be an array of string arrays');
  }
  if (typeof input.content !== 'string')
    return invalid('event.content must be a string');
  if (!isHex(input.sig, 128)) {
    return invalid(
      'event.sig must be a 128-character lowercase hexadecimal string',
    );
  }

  return {
    ok: true,
    event: {
      id: input.id,
      pubkey: input.pubkey,
      created_at: input.created_at,
      kind: input.kind,
      tags: input.tags,
      content: input.content,
      sig: input.sig,
    },
  };
}

function invalid(reason: string): ParseResult {
  return { ok: false, reason };
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isHex(value: unknown, length: number): value is string {
  return (
    typeof value === 'string' && new RegExp(`^[0-9a-f]{${length}}$`).test(value)
  );
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((item) => typeof item === 'string')
  );
}

function isNonNegativeSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
