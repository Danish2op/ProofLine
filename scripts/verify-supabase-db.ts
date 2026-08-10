import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { Client } from 'pg';

const migrationNames = [
  '0001_initial_schema.sql',
  '0002_rls_policies.sql',
  '0003_indexes_constraints.sql',
  '0004_task_5_hardening.sql',
  '0005_task_5_review_hardening.sql',
  '0006_pgcrypto_compatibility.sql',
] as const;

const dbUrl = process.env.SUPABASE_DB_URL;
const shouldApply = process.argv.includes('--apply');

if (!dbUrl) {
  console.log(
    'SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.',
  );
  process.exit(0);
}

if (
  shouldApply &&
  process.env.SUPABASE_DB_VERIFY_DISPOSABLE !== 'I_UNDERSTAND'
) {
  console.error(
    'REFUSED: --apply requires SUPABASE_DB_VERIFY_DISPOSABLE=I_UNDERSTAND.',
  );
  process.exit(1);
}

const client = new Client({ connectionString: dbUrl });

try {
  await client.connect();
  if (shouldApply) await applyMigrations(client);

  await client.query('BEGIN');
  try {
    await verifyLiveDatabase(client);
  } finally {
    await client.query('ROLLBACK');
  }

  console.log(
    'PASS: live Supabase lifecycle, grant, and cross-tenant RLS probes passed.',
  );
} finally {
  await client.end();
}

async function applyMigrations(client: Client): Promise<void> {
  for (const name of migrationNames) {
    const sql = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', name),
      'utf8',
    );
    await client.query(sql);
  }
  console.log(
    'Applied Proofline migrations to the supplied disposable database.',
  );
}

async function verifyLiveDatabase(client: Client): Promise<void> {
  await verifyPgcryptoCompatibility(client);
  const workspaceA = randomUUID();
  const workspaceB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();
  const contextA = await createWorkspaceProbeFixture(
    client,
    workspaceA,
    userA,
    'a',
  );
  const contextB = await createWorkspaceProbeFixture(
    client,
    workspaceB,
    userB,
    'b',
  );
  await client.query(
    insertPassportSql(),
    passportValues(contextB, workspaceB, 'DRAFT'),
  );

  await runAsAuthenticated(client, userA, async () => {
    const hidden = await client.query<{ id: string }>(
      'select id from public.action_passports where workspace_id = $1',
      [workspaceB],
    );
    assert.equal(
      hidden.rowCount,
      0,
      'workspace A user can infer workspace B rows',
    );

    await expectFailure(
      client,
      'update public.action_passports set status = $1 where workspace_id = $2',
      ['BLOCKED', workspaceB],
      'permission denied',
    );

    for (const status of ['APPROVED', 'EXECUTING', 'SUCCEEDED']) {
      await expectFailure(
        client,
        insertPassportSql(),
        passportValues(contextA, workspaceA, status),
        'new action passports must start in draft',
      );
    }

    const draft = await client.query(
      insertPassportSql(),
      passportValues(contextA, workspaceA, 'DRAFT'),
    );
    assert.equal(draft.rowCount, 1, 'DRAFT passport insert was rejected');
  });

  await runAsServiceRole(client, async () => {
    await verifyExecutionExpiry(client, contextA, workspaceA);
    await verifyPopulatedDemoCleanup(client, contextA, workspaceA);
  });
}

async function verifyPgcryptoCompatibility(client: Client): Promise<void> {
  const result = await client.query<{ hash: string }>(
    'select proofline_internal.sha256_json(\'{"synthetic":true}\'::jsonb) as hash',
  );
  const hash = result.rows[0]?.hash;
  assert.match(
    hash ?? '',
    /^[0-9a-f]{64}$/,
    'pgcrypto compatibility wrapper did not return a SHA-256 hash',
  );
}

async function verifyExecutionExpiry(
  client: Client,
  context: ProbeContext,
  workspaceId: string,
): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `${insertPassportSql()} returning id`,
    passportValues(context, workspaceId, 'DRAFT', null, true),
  );
  const actionPassportId = inserted.rows[0]?.id;
  assert.ok(actionPassportId, 'expiry probe passport was not created');

  await client.query(
    'update public.action_passports set status = $1 where id = $2',
    ['PENDING_APPROVAL', actionPassportId],
  );
  await client.query(
    `update public.action_passports
       set status = 'APPROVED', approved_at = current_timestamp,
           approval_expires_at = current_timestamp + interval '1 hour'
     where id = $1`,
    [actionPassportId],
  );
  await client.query(
    `update public.action_passports
       set approval_expires_at = current_timestamp - interval '1 second'
     where id = $1`,
    [actionPassportId],
  );
  await expectFailure(
    client,
    'update public.action_passports set status = $1 where id = $2',
    ['EXECUTING', actionPassportId],
    'approved action requires an unexpired approval',
  );
  await client.query(
    `update public.action_passports
       set approval_expires_at = current_timestamp + interval '1 hour'
     where id = $1`,
    [actionPassportId],
  );
  await client.query(
    'update public.action_passports set status = $1 where id = $2',
    ['EXECUTING', actionPassportId],
  );
  await client.query(
    `update public.action_passports
       set approval_expires_at = current_timestamp - interval '1 second'
     where id = $1`,
    [actionPassportId],
  );
  const completion = await client.query(
    'update public.action_passports set status = $1 where id = $2',
    ['SUCCEEDED', actionPassportId],
  );
  assert.equal(
    completion.rowCount,
    1,
    'completion after execution was rejected',
  );
}

async function verifyPopulatedDemoCleanup(
  client: Client,
  context: ProbeContext,
  workspaceId: string,
): Promise<void> {
  const demoRunId = randomUUID();
  await client.query(
    'insert into public.demo_runs (id, workspace_id, label, reset_key) values ($1, $2, $3, $4)',
    [
      demoRunId,
      workspaceId,
      'Synthetic populated cleanup probe',
      `cleanup-${demoRunId}`,
    ],
  );
  const inserted = await client.query<{ id: string }>(
    `${insertPassportSql()} returning id`,
    passportValues(context, workspaceId, 'DRAFT', demoRunId),
  );
  const actionPassportId = inserted.rows[0]?.id;
  assert.ok(actionPassportId, 'demo cleanup passport was not created');

  const executionAttemptId = randomUUID();
  await client.query(
    'insert into public.action_revisions (workspace_id, action_passport_id, revision_number, passport_hash, payload_json) values ($1, $2, 1, $3, $4::jsonb)',
    [
      workspaceId,
      actionPassportId,
      'd'.repeat(64),
      JSON.stringify({ synthetic: true }),
    ],
  );
  await client.query(
    "insert into public.evidence_items (workspace_id, action_passport_id, evidence_id, source, content_hash, collected_at, expires_at) values ($1, $2, $3, $4, $5, current_timestamp, current_timestamp + interval '1 hour')",
    [
      workspaceId,
      actionPassportId,
      `evidence-${demoRunId}`,
      'synthetic',
      'e'.repeat(64),
    ],
  );
  await client.query(
    "insert into public.approval_events (workspace_id, action_passport_id, event_id, decision, actor_pubkey, approved_at, expires_at, raw_event_json) values ($1, $2, $3, $4, $5, current_timestamp, current_timestamp + interval '1 hour', $6::jsonb)",
    [
      workspaceId,
      actionPassportId,
      `approval-${demoRunId}`,
      'approved',
      'f'.repeat(64),
      JSON.stringify({ synthetic: true }),
    ],
  );
  await client.query(
    'insert into public.execution_attempts (id, workspace_id, action_passport_id, attempt_number) values ($1, $2, $3, 1)',
    [executionAttemptId, workspaceId, actionPassportId],
  );
  await client.query(
    'insert into public.execution_receipts (workspace_id, execution_attempt_id, receipt_hash, receipt_json) values ($1, $2, $3, $4::jsonb)',
    [
      workspaceId,
      executionAttemptId,
      '1'.repeat(64),
      JSON.stringify({ synthetic: true }),
    ],
  );
  await client.query(
    'insert into public.buzz_events (workspace_id, action_passport_id, buzz_event_id, event_kind, signer_pubkey, raw_event_json) values ($1, $2, $3, $4, $5, $6::jsonb)',
    [
      workspaceId,
      actionPassportId,
      `buzz-${demoRunId}`,
      'synthetic',
      '2'.repeat(64),
      JSON.stringify({ synthetic: true }),
    ],
  );
  await client.query(
    'insert into public.outbox_jobs (workspace_id, action_passport_id, job_type, payload_json) values ($1, $2, $3, $4::jsonb)',
    [
      workspaceId,
      actionPassportId,
      'synthetic.cleanup',
      JSON.stringify({ synthetic: true }),
    ],
  );

  await client.query('select public.cleanup_demo_run($1)', [demoRunId]);
  await client.query('select public.cleanup_demo_run($1)', [demoRunId]);

  const remaining = await client.query<{ remaining: string }>(
    `select count(*)::text as remaining from public.demo_runs where id = $1
     union all select count(*)::text from public.action_passports where id = $2
     union all select count(*)::text from public.action_revisions where action_passport_id = $2
     union all select count(*)::text from public.evidence_items where action_passport_id = $2
     union all select count(*)::text from public.approval_events where action_passport_id = $2
     union all select count(*)::text from public.execution_attempts where action_passport_id = $2
     union all select count(*)::text from public.buzz_events where action_passport_id = $2
     union all select count(*)::text from public.outbox_jobs where action_passport_id = $2`,
    [demoRunId, actionPassportId],
  );
  for (const row of remaining.rows) {
    assert.equal(row.remaining, '0', 'demo cleanup left a dependent row');
  }
}

async function createWorkspaceProbeFixture(
  client: Client,
  workspaceId: string,
  userId: string,
  suffix: string,
): Promise<ProbeContext> {
  await client.query(
    `insert into auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      $1,
      coalesce((select instance_id from auth.users limit 1), '00000000-0000-0000-0000-000000000000'),
      'authenticated', 'authenticated', $2, 'not-a-real-password', now(), '{}'::jsonb, '{}'::jsonb, now(), now()
    )`,
    [userId, `proofline-${suffix}-${userId}@example.invalid`],
  );
  await client.query(
    'insert into public.workspaces (id, slug, name, is_synthetic) values ($1, $2, $3, true)',
    [
      workspaceId,
      `probe-${suffix}-${workspaceId.slice(0, 8)}`,
      'Synthetic live RLS probe',
    ],
  );
  await client.query(
    'insert into public.workspace_members (workspace_id, user_id, role) values ($1, $2, $3)',
    [workspaceId, userId, 'proposer'],
  );

  const agentId = randomUUID();
  const toolDefinitionId = randomUUID();
  const policyId = randomUUID();
  await client.query(
    'insert into public.agents (id, workspace_id, pubkey, display_name) values ($1, $2, $3, $4)',
    [
      agentId,
      workspaceId,
      'a'.repeat(63) + suffix,
      `synthetic-live-probe-${suffix}@example.invalid`,
    ],
  );
  await client.query(
    'insert into public.tool_definitions (id, workspace_id, name, definition_hash, metadata_json) values ($1, $2, $3, $4, $5::jsonb)',
    [
      toolDefinitionId,
      workspaceId,
      'sandbox.deploy',
      'b'.repeat(64),
      JSON.stringify({ synthetic: true }),
    ],
  );
  await client.query(
    'insert into public.policies (id, workspace_id, version, document_json, snapshot_hash) values ($1, $2, $3, $4::jsonb, $5)',
    [
      policyId,
      workspaceId,
      'live-probe',
      JSON.stringify({ synthetic: true }),
      'c'.repeat(64),
    ],
  );
  return { agentId, toolDefinitionId, policyId };
}

async function runAsAuthenticated(
  client: Client,
  userId: string,
  operation: () => Promise<void>,
): Promise<void> {
  await client.query('set local role authenticated');
  await client.query("select set_config('request.jwt.claim.sub', $1, true)", [
    userId,
  ]);
  await client.query(
    "select set_config('request.jwt.claim.role', 'authenticated', true)",
  );
  try {
    await operation();
  } finally {
    await client.query('reset role');
  }
}

async function runAsServiceRole(
  client: Client,
  operation: () => Promise<void>,
): Promise<void> {
  await client.query('set local role service_role');
  await client.query(
    "select set_config('request.jwt.claim.role', 'service_role', true)",
  );
  try {
    await operation();
  } finally {
    await client.query('reset role');
  }
}

async function expectFailure(
  client: Client,
  sql: string,
  values: unknown[],
  expectedMessage: string,
): Promise<void> {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, values);
    assert.fail(`Expected query to fail with ${expectedMessage}.`);
  } catch (error) {
    const message =
      error instanceof Error ? error.message.toLowerCase() : String(error);
    assert.match(message, new RegExp(expectedMessage));
  } finally {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  }
}

function insertPassportSql(): string {
  return `insert into public.action_passports (
    workspace_id, action_id, passport_hash, status, agent_id, tool_definition_id,
    policy_id, demo_run_id, target, environment, normalized_arguments, idempotency_key, approval_required
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)`;
}

function passportValues(
  context: ProbeContext,
  workspaceId: string,
  status: string,
  demoRunId: string | null = null,
  approvalRequired = false,
): unknown[] {
  return [
    workspaceId,
    randomUUID(),
    randomUUID().replaceAll('-', '').padEnd(64, 'a'),
    status,
    context.agentId,
    context.toolDefinitionId,
    context.policyId,
    demoRunId,
    'sandbox://synthetic-live-probe.example.invalid/staging',
    'staging',
    JSON.stringify({ synthetic: true }),
    `live-probe-${randomUUID()}`,
    approvalRequired,
  ];
}

interface ProbeContext {
  agentId: string;
  toolDefinitionId: string;
  policyId: string;
}
