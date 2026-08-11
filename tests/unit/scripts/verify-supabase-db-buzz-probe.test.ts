import { describe, expect, it } from 'vitest';

import {
  createVerifiedBuzzProposal,
  recordExpectedVerifiedBuzzProposal,
  runSupabaseDbVerification,
  verifyRejectionAuditContract,
} from '../../../scripts/verify-supabase-db.js';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('live Supabase verified Buzz proposal probe', () => {
  it('fails a credentialed verification when the migration-0016 contract is stale', async () => {
    const output: string[] = [];
    const client = {
      async connect() {},
      async end() {},
      async query(sql: string) {
        if (sql.includes('approval_rpc_present')) {
          return {
            rows: [
              {
                approval_rpc_present: true,
                observation_rpc_present: true,
                migration_0015_columns_present: true,
                migration_0016_rejection_audit_present: false,
              },
            ],
          };
        }
        return { rows: [] };
      },
    };

    await expect(
      runSupabaseDbVerification({
        dbUrl: 'postgresql://credentialed.example.invalid/proofline',
        shouldApply: false,
        createClient: () => client as never,
        log: (message) => output.push(message),
      }),
    ).rejects.toThrow(/migration 0016 rejection-audit contract is required/i);
    expect(output).not.toContain(
      'SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.',
    );
    expect(output).not.toContain(
      'PASS: live Supabase lifecycle, grant, and cross-tenant RLS probes passed.',
    );
  });

  it('fails the executable rejection probe when a distinct command identity is accepted', async () => {
    const client = {
      async query(sql: string) {
        if (sql.includes('returning id')) {
          return {
            rows: [{ id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' }],
          };
        }
        return { rows: [] };
      },
    };

    await expect(
      verifyRejectionAuditContract(
        client as never,
        {
          agentId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          toolDefinitionId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
          policyId: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        },
        'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee',
      ),
    ).rejects.toThrow(
      /migration 0016 rejection-audit probe accepted a distinct command identity/i,
    );
  });

  it('tracks migrations through 0015 and uses observation plus v2 lifecycle RPCs', () => {
    const script = readFileSync(
      join(process.cwd(), 'scripts', 'verify-supabase-db.ts'),
      'utf8',
    );

    expect(script).toContain(
      "'0015_task_8_approval_observation_retirement.sql'",
    );
    expect(script).toContain(
      "'0016_task_8_rejection_audit_collision_hardening.sql'",
    );
    expect(script).toContain('record_verified_buzz_approval_observation');
    expect(script).toContain('approve_verified_action_v2');
    expect(script).not.toContain('apply_verified_buzz_approval(');
    expect(script).toContain('SKIPPED: set SUPABASE_DB_URL');
    expect(script).toContain('Task 8 lifecycle contract is missing');
  });

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
