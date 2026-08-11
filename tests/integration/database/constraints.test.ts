import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import {
  allMigrations,
  migration,
  migrationNames,
  seed,
  tenantTables,
} from './migration-test-helpers.js';

describe('Proofline database constraints', () => {
  it('ships the required ordered migration artifacts and persistence contract', () => {
    for (const name of migrationNames) {
      expect(
        existsSync(join(process.cwd(), 'supabase', 'migrations', name)),
      ).toBe(true);
    }
    expect(
      existsSync(
        join(
          process.cwd(),
          'packages',
          'domain',
          'src',
          'persistence-types.ts',
        ),
      ),
    ).toBe(true);
  });

  it('creates all tenant tables with a non-null workspace boundary', () => {
    const schema = migration('0001_initial_schema.sql');

    expect(schema).toContain('create table public.workspaces');
    for (const table of tenantTables.filter(
      (table) => table !== 'workspaces',
    )) {
      expect(schema).toMatch(
        new RegExp(
          `create table public\\.${table} \\([^;]*workspace_id uuid not null`,
        ),
      );
    }
  });

  it('rejects duplicate action identifiers and idempotency keys per workspace', () => {
    const constraints = allMigrations();

    expect(constraints).toContain(
      'constraint action_passports_workspace_action_key unique (workspace_id, action_id)',
    );
    expect(constraints).toContain(
      'constraint action_passports_workspace_idempotency_key unique (workspace_id, idempotency_key)',
    );
    expect(constraints).toContain(
      "constraint action_passports_passport_hash_format check (passport_hash ~ '^[0-9a-f]{64}$')",
    );
  });

  it('rejects direct inserts at APPROVED, EXECUTING, and SUCCEEDED', () => {
    const hardening = migration('0004_task_5_hardening.sql');

    expect(hardening).toContain(
      "if tg_op = 'insert' and new.status <> 'draft' then",
    );
    expect(hardening).toContain(
      "raise exception 'new action passports must start in draft'",
    );
    expect(hardening).toContain(
      'create trigger action_passports_guard_write before insert or update on public.action_passports',
    );
  });

  it('permits only DRAFT inserts and enforces lifecycle transitions inside Postgres', () => {
    const constraints = allMigrations();

    expect(constraints).toContain(
      'create function public.is_valid_action_transition',
    );
    expect(constraints).toContain(
      'create or replace function public.guard_action_passport_write',
    );
    expect(constraints).toContain(
      "raise exception 'action passport fields are immutable after creation'",
    );
    expect(constraints).toContain(
      "raise exception 'invalid action lifecycle transition from % to %'",
    );
    expect(constraints).toContain("new.status <> 'draft'");
  });

  it('requires an unexpired approval when execution starts but not when it completes', () => {
    const hardening = migration('0005_task_5_review_hardening.sql');

    expect(hardening).toContain("new.status in ('approved', 'executing')");
    expect(hardening).not.toContain(
      "new.status in ('approved', 'executing', 'succeeded')",
    );
    expect(hardening).toContain(
      "raise exception 'approved action requires an unexpired approval'",
    );
  });

  it('rejects expired or structurally invalid approvals before they can be applied', () => {
    const constraints = allMigrations();

    expect(constraints).toContain(
      'constraint approval_events_expiry_after_approval check (expires_at > approved_at)',
    );
    expect(constraints).toContain(
      'create function public.guard_approval_event',
    );
    expect(constraints).toContain(
      "raise exception 'approval event is expired at insertion time'",
    );
    expect(constraints).toContain(
      'create trigger approval_events_guard_expiry before insert or update on public.approval_events',
    );
  });

  it('uses restrictive foreign keys for tenant aggregates', () => {
    const schema = migration('0001_initial_schema.sql');

    expect(schema).toContain(
      'references public.workspaces(id) on delete restrict',
    );
    expect(schema).toContain(
      'references public.action_passports(workspace_id, id) on delete restrict',
    );
    expect(schema).toContain('references auth.users(id) on delete restrict');
    expect(schema).toContain(
      'references public.demo_runs(workspace_id, id) on delete cascade',
    );
    expect(
      schema.replace(
        'references public.demo_runs(workspace_id, id) on delete cascade',
        '',
      ),
    ).not.toContain('on delete cascade');
  });

  it('provides an idempotent, ordered cleanup path for populated demo runs', () => {
    const hardening = migration('0005_task_5_review_hardening.sql');

    expect(hardening).toContain(
      'create or replace function public.cleanup_demo_run',
    );
    expect(hardening).toContain('delete from public.execution_receipts');
    expect(hardening).toContain('delete from public.execution_attempts');
    expect(hardening).toContain('delete from public.action_revisions');
    expect(hardening).toContain('delete from public.action_passports');
    expect(hardening).toContain('delete from public.demo_runs');
    expect(hardening).toContain(
      "raise exception 'demo run cleanup requires service_role'",
    );
  });

  it('adds indexes for tenant queries, Buzz deduplication, and outbox claims', () => {
    const constraints = migration('0003_indexes_constraints.sql');

    for (const index of [
      'action_passports_workspace_created_at_idx on public.action_passports (workspace_id, created_at desc)',
      'action_passports_workspace_status_idx on public.action_passports (workspace_id, status)',
      'action_passports_workspace_idempotency_idx on public.action_passports (workspace_id, idempotency_key)',
      'action_passports_workspace_passport_hash_idx on public.action_passports (workspace_id, passport_hash)',
      'buzz_events_workspace_event_id_idx on public.buzz_events (workspace_id, buzz_event_id)',
      'outbox_jobs_claim_idx on public.outbox_jobs (available_at, locked_at, locked_by)',
    ]) {
      expect(constraints).toContain(`create index ${index}`);
    }
  });

  it('ships a forward-only lifecycle command transaction with locking, versions, replay receipts, and audit output', () => {
    const lifecycle = allMigrations();

    expect(lifecycle).toContain(
      'alter table public.action_passports add column if not exists version bigint not null default 0',
    );
    expect(lifecycle).toContain(
      'create table if not exists public.lifecycle_command_receipts',
    );
    expect(lifecycle).toContain(
      'constraint lifecycle_command_receipts_workspace_command_key unique (workspace_id, action_passport_id, command_id)',
    );
    expect(lifecycle).toContain(
      'create or replace function public.transition_action(',
    );
    expect(lifecycle).toContain('perform pg_advisory_xact_lock');
    expect(lifecycle).toContain('for update;');
    expect(lifecycle).toContain("'stale_version'");
    expect(lifecycle).toContain("'idempotency_conflict'");
    expect(lifecycle).toContain('insert into public.audit_events');
    expect(lifecycle).toContain('correlation_id, causation_id');
  });

  it('hardens lifecycle receipts against caller hash substitution and records rejected commands', () => {
    const lifecycle = allMigrations();

    expect(lifecycle).toContain('proofline_internal.sha256_json');
    expect(lifecycle).toContain('command_hash_mismatch');
    expect(lifecycle).toContain(
      'insert into public.lifecycle_command_receipts',
    );
    expect(lifecycle).toContain('invalid_transition');
    expect(lifecycle).toContain('stale_version');
    expect(lifecycle).toContain('idempotency_conflict');
    expect(lifecycle).toContain('source_approval_event_id');
  });

  it('hardens approval against caller provenance substitution and audit collisions', () => {
    const lifecycle = allMigrations();

    expect(lifecycle).toContain(
      'create or replace function public.approve_verified_action(',
    );
    expect(lifecycle).toContain('buzz_event_provenance');
    expect(lifecycle).toContain('signature_verified');
    expect(lifecycle).toContain('buzz_reviewer_identities');
    expect(lifecycle).toContain('proposal_event_id');
    expect(lifecycle).toContain('source_approval_raw_event_json');
    expect(lifecycle).toContain('approval_provenance_mismatch');
    expect(lifecycle).toContain('audit id collision');
    expect(lifecycle).toContain('source_expected_version is null');
  });

  it('parses standard Nostr approval content and retires the legacy approval RPC', () => {
    const lifecycle = allMigrations();

    expect(lifecycle).toContain("stored_raw_event_json->>'content'");
    expect(lifecycle).toContain("'{proofline,decision}'");
    expect(lifecycle).toContain('stored_event_kind = 7');
    expect(lifecycle).toContain('record_verified_buzz_approval_observation');
    expect(lifecycle).toContain(
      'revoke all on function public.apply_verified_buzz_approval',
    );
    expect(lifecycle).toContain('approval_observation_malformed');
  });

  it('keeps seed data visibly synthetic and free of credentials', () => {
    const fixture = seed();

    expect(fixture).toContain('synthetic');
    expect(fixture).toContain('example.invalid');
    expect(fixture).not.toMatch(
      /(?:service_role|supabase_service|sk-[a-z0-9]|ghp_[a-z0-9]|xox[baprs]-)/i,
    );
  });
});
