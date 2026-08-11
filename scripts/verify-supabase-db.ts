import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { Client } from 'pg';

const migrationNames = [
  '0001_initial_schema.sql',
  '0002_rls_policies.sql',
  '0003_indexes_constraints.sql',
  '0004_task_5_hardening.sql',
  '0005_task_5_review_hardening.sql',
  '0006_pgcrypto_compatibility.sql',
  '0007_task_6_authz_hardening.sql',
  '0008_task_7_buzz_provenance.sql',
  '0009_task_7_verified_buzz_approval.sql',
  '0010_task_7_proposal_binding_and_request_changes.sql',
  '0011_task_7_signed_passport_binding.sql',
  '0012_task_8_lifecycle_commands.sql',
  '0013_task_8_lifecycle_hardening.sql',
  '0014_task_8_lifecycle_provenance_hardening.sql',
  '0015_task_8_approval_observation_retirement.sql',
  '0016_task_8_rejection_audit_collision_hardening.sql',
  '0017_task_8_rejection_audit_identity_hardening.sql',
] as const;

interface SupabaseDbVerificationOptions {
  dbUrl?: string;
  shouldApply?: boolean;
  disposableConfirmation?: string;
  createClient?: (connectionString: string) => Client;
  log?: (message: string) => void;
  logError?: (message: string) => void;
}

export async function runSupabaseDbVerification(
  options: SupabaseDbVerificationOptions = {},
): Promise<number> {
  const dbUrl = options.dbUrl ?? process.env.SUPABASE_DB_URL;
  const shouldApply = options.shouldApply ?? process.argv.includes('--apply');
  const disposableConfirmation =
    options.disposableConfirmation ?? process.env.SUPABASE_DB_VERIFY_DISPOSABLE;
  const createClient =
    options.createClient ??
    ((connectionString: string) => new Client({ connectionString }));
  const log = options.log ?? console.log;
  const logError = options.logError ?? console.error;

  if (!dbUrl) {
    log('SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.');
    return 0;
  }

  if (shouldApply && disposableConfirmation !== 'I_UNDERSTAND') {
    logError(
      'REFUSED: --apply requires SUPABASE_DB_VERIFY_DISPOSABLE=I_UNDERSTAND.',
    );
    return 1;
  }

  const client = createClient(dbUrl);

  try {
    await client.connect();
    if (shouldApply) await applyMigrations(client);

    await client.query('BEGIN');
    try {
      await verifyLiveDatabase(client);
    } finally {
      await client.query('ROLLBACK');
    }

    log(
      'PASS: live Supabase lifecycle, grant, and cross-tenant RLS probes passed.',
    );
    return 0;
  } finally {
    await client.end();
  }
}

const invokedPath = process.argv[1];
if (invokedPath && import.meta.url === pathToFileURL(invokedPath).href) {
  process.exitCode = await runSupabaseDbVerification();
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
  await assertTask8LifecycleContract(client);
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
  await verifyRejectionAuditContract(client, contextA, workspaceA);

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
    await verifyVerifiedBuzzApprovalRpc(client, contextA, workspaceA);
  });

  await runAsAuthenticated(client, userA, async () => {
    await expectFailure(
      client,
      "select public.approve_verified_action_v2($1, $2, 0, $3, $4, $5, $6, null, $7, current_timestamp, current_timestamp + interval '1 hour', $8, $9::jsonb)",
      [
        workspaceA,
        randomUUID(),
        randomUUID(),
        'a'.repeat(64),
        'probe-user',
        randomUUID(),
        'b'.repeat(64),
        'c'.repeat(64),
        JSON.stringify(validBuzzEvent('a', 'b')),
      ],
      'permission denied',
    );
  });
}

async function assertTask8LifecycleContract(client: Client): Promise<void> {
  const result = await client.query<{
    approval_rpc_present: boolean;
    observation_rpc_present: boolean;
    migration_0015_columns_present: boolean;
    migration_0016_rejection_audit_present: boolean;
    migration_0017_rejection_audit_identity_present: boolean;
  }>(
    `select
       to_regprocedure('public.approve_verified_action_v2(uuid,uuid,bigint,uuid,text,text,uuid,uuid,text,timestamptz,timestamptz,text,jsonb)') is not null as approval_rpc_present,
       to_regprocedure('public.record_verified_buzz_approval_observation(uuid,timestamptz,timestamptz,text,jsonb)') is not null as observation_rpc_present,
       exists (
         select 1 from information_schema.columns
         where table_schema = 'public'
           and table_name = 'buzz_event_provenance'
           and column_name in ('approval_approved_at', 'approval_expires_at')
         group by table_schema, table_name
         having count(*) = 2
       ) as migration_0015_columns_present,
       coalesce(
         pg_get_functiondef(
           to_regprocedure('proofline_internal.record_lifecycle_rejection(uuid,uuid,uuid,text,jsonb,text,text,uuid,uuid)')
         ) like '%lifecycle rejection idempotency conflict%'
         and pg_get_functiondef(
           to_regprocedure('proofline_internal.record_lifecycle_rejection(uuid,uuid,uuid,text,jsonb,text,text,uuid,uuid)')
         ) like '%lifecycle rejection audit collision%',
         false
       ) as migration_0016_rejection_audit_present,
       coalesce(
         pg_get_functiondef(
           to_regprocedure('proofline_internal.record_lifecycle_rejection(uuid,uuid,uuid,text,jsonb,text,text,uuid,uuid)')
         ) like '%existing_audit_aggregate_type is distinct from ''action_passport''%'
         and pg_get_functiondef(
           to_regprocedure('proofline_internal.record_lifecycle_rejection(uuid,uuid,uuid,text,jsonb,text,text,uuid,uuid)')
         ) like '%existing_audit_metadata is distinct from audit_metadata%',
         false
       ) as migration_0017_rejection_audit_identity_present`,
  );
  const contract = result.rows[0];
  if (
    !contract?.approval_rpc_present ||
    !contract.observation_rpc_present ||
    !contract.migration_0015_columns_present ||
    !contract.migration_0016_rejection_audit_present ||
    !contract.migration_0017_rejection_audit_identity_present
  ) {
    throw new Error(
      'Task 8 lifecycle contract is missing: migration 0015 and v2 approval/observation RPCs are required; migration 0016 rejection-audit contract and migration 0017 complete audit identity are required.',
    );
  }
}

export async function verifyRejectionAuditContract(
  client: Client,
  context: ProbeContext,
  workspaceId: string,
): Promise<void> {
  const inserted = await client.query<{ id: string }>(
    `${insertPassportSql()} returning id`,
    passportValues(context, workspaceId, 'DRAFT'),
  );
  const actionPassportId = inserted.rows[0]?.id;
  assert.ok(
    actionPassportId,
    'migration 0016 rejection-audit probe passport was not created',
  );

  const commandId = randomUUID();
  const commandHash = '8'.repeat(64);
  const correlationId = randomUUID();
  const result = {
    ok: false,
    code: 'stale_version',
    retryable: true,
  };
  const recordRejectionSql =
    'select proofline_internal.record_lifecycle_rejection($1, $2, $3, $4, $5::jsonb, $6, $7, $8, $9)';
  const values = [
    workspaceId,
    actionPassportId,
    commandId,
    commandHash,
    JSON.stringify(result),
    'system',
    'db-verifier',
    correlationId,
    null,
  ];

  const poisonedMetadata = JSON.stringify({
    commandId,
    commandHash,
    result,
    unexpectedIdentityField: true,
  });
  const auditIdSql = `(md5(
    ($1::uuid)::text || ':' || ($2::uuid)::text || ':' ||
    ($3::uuid)::text || ':' || $4::text || ':' || $5::jsonb::text ||
    ':rejected'
  ))::uuid`;
  await client.query(
    `insert into public.audit_events (
      id, workspace_id, actor_type, actor_id, event_type, aggregate_type,
      aggregate_id, metadata_json, occurred_at, correlation_id, causation_id
    ) values (
      ${auditIdSql}, $1, $6, $7, 'action_command.rejected',
      'unexpected_aggregate', $2, $10::jsonb, current_timestamp, $8, $9
    )`,
    [...values, poisonedMetadata],
  );
  await client.query('SAVEPOINT migration_0017_audit_identity_collision');
  let auditIdentityCollisionObserved = false;
  try {
    await client.query(recordRejectionSql, values);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('lifecycle rejection audit collision')) {
      throw error;
    }
    auditIdentityCollisionObserved = true;
  } finally {
    await client.query(
      'ROLLBACK TO SAVEPOINT migration_0017_audit_identity_collision',
    );
  }
  await client.query(
    `delete from public.audit_events where id = ${auditIdSql}`,
    values.slice(0, 5),
  );
  assert.equal(
    auditIdentityCollisionObserved,
    true,
    'Migration 0017 rejection-audit probe accepted a pre-existing audit with a different complete identity.',
  );

  await client.query(recordRejectionSql, values);
  await client.query(recordRejectionSql, values);

  await client.query('SAVEPOINT migration_0016_rejection_conflict');
  let conflictObserved = false;
  try {
    await client.query(recordRejectionSql, [
      ...values.slice(0, 3),
      '9'.repeat(64),
      JSON.stringify({ ...result, code: 'invalid_transition' }),
      ...values.slice(5),
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!message.includes('lifecycle rejection idempotency conflict')) {
      throw error;
    }
    conflictObserved = true;
  } finally {
    await client.query(
      'ROLLBACK TO SAVEPOINT migration_0016_rejection_conflict',
    );
  }
  assert.equal(
    conflictObserved,
    true,
    'Migration 0016 rejection-audit probe accepted a distinct command identity.',
  );

  const stored = await client.query<{
    command_hash: string;
    result_json: Record<string, unknown>;
    metadata_json: Record<string, unknown>;
  }>(
    `select receipt.command_hash, receipt.result_json, audit.metadata_json
     from public.lifecycle_command_receipts receipt
     join public.audit_events audit
       on audit.workspace_id = receipt.workspace_id
      and audit.aggregate_id = receipt.action_passport_id
      and audit.event_type = 'action_command.rejected'
      and audit.metadata_json->>'commandId' = receipt.command_id::text
     where receipt.workspace_id = $1
       and receipt.action_passport_id = $2
       and receipt.command_id = $3`,
    [workspaceId, actionPassportId, commandId],
  );
  assert.equal(stored.rowCount, 1, 'rejection audit identity was not unique');
  assert.equal(stored.rows[0]?.command_hash, commandHash);
  assert.deepEqual(stored.rows[0]?.result_json, result);
  assert.deepEqual(stored.rows[0]?.metadata_json, {
    commandId,
    commandHash,
    result,
  });
}

async function verifyVerifiedBuzzApprovalRpc(
  client: Client,
  context: ProbeContext,
  workspaceId: string,
): Promise<void> {
  const actionPassport = await client.query<{
    id: string;
    passport_hash: string;
  }>(
    `${insertPassportSql()} returning id, passport_hash`,
    passportValues(context, workspaceId, 'DRAFT', null, true),
  );
  const actionPassportId = actionPassport.rows[0]?.id;
  const actionPassportHash = actionPassport.rows[0]?.passport_hash;
  assert.ok(actionPassportId, 'Buzz RPC probe passport was not created');
  assert.ok(actionPassportHash, 'Buzz RPC probe passport hash was not created');
  await client.query(
    'update public.action_passports set status = $1 where id = $2',
    ['PENDING_APPROVAL', actionPassportId],
  );
  const secondPassport = await client.query<{
    id: string;
    passport_hash: string;
  }>(
    `${insertPassportSql()} returning id, passport_hash`,
    passportValues(context, workspaceId, 'DRAFT', null, true),
  );
  const secondActionPassportId = secondPassport.rows[0]?.id;
  const secondActionPassportHash = secondPassport.rows[0]?.passport_hash;
  assert.ok(
    secondActionPassportId,
    'second Buzz RPC probe passport was not created',
  );
  assert.ok(
    secondActionPassportHash,
    'second Buzz RPC probe passport hash was not created',
  );
  await client.query(
    'update public.action_passports set status = $1 where id = $2',
    ['PENDING_APPROVAL', secondActionPassportId],
  );

  const reviewerPubkey = '2'.repeat(64);
  const proposalEventId = '3'.repeat(64);
  const proposal = validBuzzEvent(
    '3',
    '1',
    [['h', 'proofline-rpc-probe']],
    9,
    `{"proofline":{"type":"proposal","passportHash":"${actionPassportHash}"}}`,
  );
  const mismatch = await client.query<{ result: string }>(
    "select public.record_verified_buzz_proposal($1, $2, 'wss://relay.example.test/', $3::jsonb) as result",
    [workspaceId, secondActionPassportId, JSON.stringify(proposal)],
  );
  assert.equal(mismatch.rows[0]?.result, 'rejected');
  const proposalStored = await client.query<{ result: string }>(
    "select public.record_verified_buzz_proposal($1, $2, 'wss://relay.example.test/', $3::jsonb) as result",
    [workspaceId, actionPassportId, JSON.stringify(proposal)],
  );
  assert.equal(proposalStored.rows[0]?.result, 'stored');
  await client.query(
    'insert into public.buzz_reviewer_identities (workspace_id, pubkey) values ($1, $2)',
    [workspaceId, reviewerPubkey],
  );

  const reaction = validBuzzEvent('4', '2', [['e', proposalEventId]]);
  const approvedAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const observation = await client.query<{ result: string }>(
    "select public.record_verified_buzz_approval_observation($1, $2, $3, 'wss://relay.example.test/', $4::jsonb) as result",
    [workspaceId, approvedAt, expiresAt, JSON.stringify(reaction)],
  );
  assert.equal(observation.rows[0]?.result, 'stored');
  const approvalCommandId = randomUUID();
  const approvalCorrelationId = randomUUID();
  const approvalHash = await lifecycleCommandHash(client, {
    workspaceId,
    actionPassportId,
    expectedVersion: 0,
    targetStatus: 'APPROVED',
    commandId: approvalCommandId,
    actorId: 'probe-user',
    correlationId: approvalCorrelationId,
    approvalEventId: String(reaction.id),
    approvedAt,
    expiresAt,
    approvalActorPubkey: reviewerPubkey,
    rawEvent: reaction,
  });
  const applied = await client.query<{ result: { ok: boolean } }>(
    'select public.approve_verified_action_v2($1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10, $11, $12::jsonb) as result',
    [
      workspaceId,
      actionPassportId,
      0,
      approvalCommandId,
      approvalHash,
      'probe-user',
      approvalCorrelationId,
      String(reaction.id),
      approvedAt,
      expiresAt,
      reviewerPubkey,
      JSON.stringify(reaction),
    ],
  );
  assert.equal(applied.rows[0]?.result.ok, true);
  const boundStatuses = await client.query<{ id: string; status: string }>(
    'select id, status from public.action_passports where id = any($1::uuid[])',
    [[actionPassportId, secondActionPassportId]],
  );
  assert.equal(
    boundStatuses.rows.find((row) => row.id === actionPassportId)?.status,
    'APPROVED',
  );
  assert.equal(
    boundStatuses.rows.find((row) => row.id === secondActionPassportId)?.status,
    'PENDING_APPROVAL',
  );

  const replay = await client.query<{ result: { replayed?: boolean } }>(
    'select public.approve_verified_action_v2($1, $2, $3, $4, $5, $6, $7, null, $8, $9, $10, $11, $12::jsonb) as result',
    [
      workspaceId,
      actionPassportId,
      0,
      approvalCommandId,
      approvalHash,
      'probe-user',
      approvalCorrelationId,
      String(reaction.id),
      approvedAt,
      expiresAt,
      reviewerPubkey,
      JSON.stringify(reaction),
    ],
  );
  assert.equal(replay.rows[0]?.result.replayed, true);

  const selfApproval = await client.query<{ result: string }>(
    "select public.record_verified_buzz_approval_observation($1, current_timestamp, current_timestamp + interval '1 hour', 'wss://relay.example.test/', $2::jsonb) as result",
    [
      workspaceId,
      JSON.stringify(validBuzzEvent('5', '1', [['e', proposalEventId]])),
    ],
  );
  assert.equal(selfApproval.rows[0]?.result, 'rejected');

  const changesProposal = createVerifiedBuzzProposal({
    eventNibble: '6',
    signerNibble: '1',
    channelId: 'proofline-rpc-probe',
    passportHash: secondActionPassportHash,
  });
  await recordExpectedVerifiedBuzzProposal(client, {
    workspaceId,
    actionPassportId: secondActionPassportId,
    proposal: changesProposal,
    expectedResult: 'stored',
  });
  const changesApproval = validBuzzEvent(
    '7',
    '2',
    [['e', '6'.repeat(64)]],
    9,
    '{"proofline":{"decision":"request_changes"}}',
  );
  const changesObservation = await client.query<{ result: string }>(
    "select public.record_verified_buzz_approval_observation($1, current_timestamp, current_timestamp + interval '1 hour', 'wss://relay.example.test/', $2::jsonb) as result",
    [workspaceId, JSON.stringify(changesApproval)],
  );
  assert.equal(changesObservation.rows[0]?.result, 'stored');
  const changesCommandId = randomUUID();
  const changesCorrelationId = randomUUID();
  const changesHash = await lifecycleCommandHash(client, {
    workspaceId,
    actionPassportId: secondActionPassportId,
    expectedVersion: 0,
    targetStatus: 'BLOCKED',
    commandId: changesCommandId,
    actorId: 'probe-user',
    correlationId: changesCorrelationId,
    rawEvent: {},
  });
  const changes = await client.query<{ result: { ok: boolean } }>(
    "select public.transition_action($1, $2, 0, $3, $4, $5, 'human', $6, $7, null, null, null, null, null, null) as result",
    [
      workspaceId,
      secondActionPassportId,
      'BLOCKED',
      changesCommandId,
      changesHash,
      'probe-user',
      changesCorrelationId,
    ],
  );
  assert.equal(changes.rows[0]?.result.ok, true);
  const changesStatus = await client.query<{ status: string }>(
    'select status from public.action_passports where id = $1',
    [secondActionPassportId],
  );
  assert.equal(changesStatus.rows[0]?.status, 'BLOCKED');
}

async function lifecycleCommandHash(
  client: Client,
  input: {
    workspaceId: string;
    actionPassportId: string;
    expectedVersion: number;
    targetStatus: string;
    commandId: string;
    actorId: string;
    correlationId: string;
    approvalEventId?: string;
    approvedAt?: string;
    expiresAt?: string;
    approvalActorPubkey?: string;
    rawEvent: Record<string, unknown>;
  },
): Promise<string> {
  const result = await client.query<{ hash: string }>(
    `select proofline_internal.sha256_json(jsonb_build_object(
      'workspaceId', $1::uuid,
      'actionPassportId', $2::uuid,
      'expectedVersion', $3,
      'targetStatus', $4,
      'commandId', $5::uuid,
      'actorType', 'human',
      'actorId', $6,
      'correlationId', $7::uuid,
      'causationId', null,
      'approvalEventId', $8,
      'approvedAt', $9::timestamptz,
      'expiresAt', $10::timestamptz,
      'approvalActorPubkey', $11,
      'approvalRawEvent', $12::jsonb
    )) as hash`,
    [
      input.workspaceId,
      input.actionPassportId,
      input.expectedVersion,
      input.targetStatus,
      input.commandId,
      input.actorId,
      input.correlationId,
      input.approvalEventId ?? null,
      input.approvedAt ?? null,
      input.expiresAt ?? null,
      input.approvalActorPubkey ?? null,
      JSON.stringify(input.rawEvent),
    ],
  );
  assert.match(result.rows[0]?.hash ?? '', /^[0-9a-f]{64}$/);
  return result.rows[0].hash;
}

interface ProbeQueryClient {
  query(
    sql: string,
    values: unknown[],
  ): Promise<{ rows: Array<{ result?: string }> }>;
}

export function createVerifiedBuzzProposal(input: {
  eventNibble: string;
  signerNibble: string;
  channelId: string;
  passportHash: string;
}): Record<string, unknown> {
  return validBuzzEvent(
    input.eventNibble,
    input.signerNibble,
    [['h', input.channelId]],
    9,
    JSON.stringify({
      proofline: {
        type: 'proposal',
        passportHash: input.passportHash,
      },
    }),
  );
}

export async function recordExpectedVerifiedBuzzProposal(
  client: ProbeQueryClient,
  input: {
    workspaceId: string;
    actionPassportId: string;
    proposal: Record<string, unknown>;
    expectedResult: 'stored' | 'rejected' | 'duplicate';
  },
): Promise<void> {
  const result = await client.query(
    "select public.record_verified_buzz_proposal($1, $2, 'wss://relay.example.test/', $3::jsonb) as result",
    [input.workspaceId, input.actionPassportId, JSON.stringify(input.proposal)],
  );
  assert.equal(
    result.rows[0]?.result,
    input.expectedResult,
    `Expected verified Buzz proposal RPC result ${input.expectedResult}.`,
  );
}

function validBuzzEvent(
  eventNibble: string,
  signerNibble: string,
  tags: string[][] = [],
  kind = 7,
  content = '+',
): Record<string, unknown> {
  return {
    id: eventNibble.repeat(64),
    pubkey: signerNibble.repeat(64),
    created_at: 1_700_000_000,
    kind,
    tags,
    content,
    sig: 'f'.repeat(128),
  };
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
