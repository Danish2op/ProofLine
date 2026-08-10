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
] as const;

const dbUrl = process.env.SUPABASE_DB_URL;

if (!dbUrl) {
  console.log(
    'SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.',
  );
  process.exit(0);
}

const client = new Client({ connectionString: dbUrl });

try {
  await client.connect();
  if (process.argv.includes('--apply')) await applyMigrations(client);

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
    policy_id, target, environment, normalized_arguments, idempotency_key, approval_required
  ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, false)`;
}

function passportValues(
  context: ProbeContext,
  workspaceId: string,
  status: string,
): unknown[] {
  return [
    workspaceId,
    randomUUID(),
    randomUUID().replaceAll('-', '').padEnd(64, 'a'),
    status,
    context.agentId,
    context.toolDefinitionId,
    context.policyId,
    'sandbox://synthetic-live-probe.example.invalid/staging',
    'staging',
    JSON.stringify({ synthetic: true }),
    `live-probe-${randomUUID()}`,
  ];
}

interface ProbeContext {
  agentId: string;
  toolDefinitionId: string;
  policyId: string;
}
