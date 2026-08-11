import { describe, expect, it } from 'vitest';

import {
  createVerifiedBuzzProposal,
  recordExpectedVerifiedBuzzProposal,
} from '../../../scripts/verify-supabase-db.js';

describe('live Supabase verified Buzz proposal probe', () => {
  it('records the second proposal with its migration-0011 passport hash', async () => {
    const passportHash = 'b'.repeat(64);
    const proposal = createVerifiedBuzzProposal({
      eventNibble: '6',
      signerNibble: '1',
      channelId: 'proofline-rpc-probe',
      passportHash,
    });
    const calls: Array<{ sql: string; values: unknown[] }> = [];
    const client = {
      async query(sql: string, values: unknown[]) {
        calls.push({ sql, values });
        return { rows: [{ result: 'stored' }] };
      },
    };

    await recordExpectedVerifiedBuzzProposal(client, {
      workspaceId: 'workspace-2',
      actionPassportId: 'passport-2',
      proposal,
      expectedResult: 'stored',
    });

    expect(JSON.parse(String(proposal.content))).toEqual({
      proofline: {
        type: 'proposal',
        passportHash,
      },
    });
    expect(calls).toEqual([
      {
        sql: expect.stringContaining('record_verified_buzz_proposal'),
        values: ['workspace-2', 'passport-2', JSON.stringify(proposal)],
      },
    ]);
  });

  it('fails the executable probe when proposal persistence returns the wrong result', async () => {
    const client = {
      async query() {
        return { rows: [{ result: 'rejected' }] };
      },
    };

    await expect(
      recordExpectedVerifiedBuzzProposal(client, {
        workspaceId: 'workspace-2',
        actionPassportId: 'passport-2',
        proposal: createVerifiedBuzzProposal({
          eventNibble: '6',
          signerNibble: '1',
          channelId: 'proofline-rpc-probe',
          passportHash: 'b'.repeat(64),
        }),
        expectedResult: 'stored',
      }),
    ).rejects.toThrow(/expected verified Buzz proposal RPC result/i);
  });
});
