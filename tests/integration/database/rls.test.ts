import { describe, expect, it } from 'vitest';

import { migration, tenantTables } from './migration-test-helpers.js';

describe('Proofline tenant isolation and audit RLS', () => {
  it('enables and forces RLS on every tenant table', () => {
    const policies = migration('0002_rls_policies.sql');

    for (const table of tenantTables) {
      expect(policies).toContain(
        `alter table public.${table} enable row level security`,
      );
      expect(policies).toContain(
        `alter table public.${table} force row level security`,
      );
    }
  });

  it('evaluates tenant access through auth.uid membership rather than application input', () => {
    const policies = migration('0002_rls_policies.sql');

    expect(policies).toContain('create function public.is_workspace_member');
    expect(policies).toContain('auth.uid()');
    expect(policies).toContain("status = 'active'");
    expect(policies).toContain(
      'using (public.is_workspace_member(workspace_id))',
    );
    expect(policies).toContain(
      'with check (public.is_workspace_member(workspace_id))',
    );
  });

  it('cannot grant anonymous tenant reads or writes', () => {
    const policies = migration('0002_rls_policies.sql');

    for (const table of tenantTables) {
      expect(policies).toContain(
        `revoke all on table public.${table} from anon`,
      );
    }
    expect(policies).not.toMatch(/create policy[^;]+to anon/i);
  });

  it('grants only the authenticated Data API privileges backed by tenant RLS', () => {
    const hardening = migration('0004_task_5_hardening.sql');

    expect(hardening).toContain(
      'grant usage on schema public to authenticated',
    );
    expect(hardening).toContain(
      'grant select on table public.workspaces, public.workspace_members, public.agents, public.tool_definitions, public.policies, public.action_passports, public.action_revisions, public.evidence_items, public.approval_events, public.execution_attempts, public.execution_receipts, public.buzz_events, public.audit_events, public.outbox_jobs, public.demo_runs to authenticated',
    );
    expect(hardening).toContain(
      'grant insert on table public.action_passports, public.approval_events, public.demo_runs to authenticated',
    );
    expect(hardening).toContain(
      'grant execute on function public.is_workspace_member(uuid, text[]) to authenticated',
    );
    expect(hardening).not.toContain(
      'grant update on table public.action_passports to authenticated',
    );
    expect(hardening).not.toContain(
      'grant delete on table public.action_passports to authenticated',
    );
  });

  it('grants worker operations only to the service role', () => {
    const hardening = migration('0004_task_5_hardening.sql');

    expect(hardening).toContain('grant usage on schema public to service_role');
    expect(hardening).toContain(
      'grant select, insert, update, delete on table public.workspaces, public.workspace_members, public.agents, public.tool_definitions, public.policies, public.action_passports, public.action_revisions, public.evidence_items, public.approval_events, public.execution_attempts, public.execution_receipts, public.buzz_events, public.audit_events, public.outbox_jobs, public.demo_runs to service_role',
    );
    expect(hardening).toContain(
      'grant execute on function public.is_workspace_member(uuid, text[]) to service_role',
    );
  });

  it('hardens SECURITY DEFINER helpers with a trusted search path', () => {
    const hardening = migration('0005_task_5_review_hardening.sql');

    expect(hardening).toContain(
      'create or replace function public.is_workspace_member',
    );
    expect(hardening).toContain(
      'create or replace function public.record_action_passport_audit',
    );
    expect(hardening).toContain('security definer');
    expect(hardening).toContain('set search_path = pg_catalog, pg_temp');
    expect(hardening).toContain('auth.uid()');
    expect(hardening).toContain('public.workspace_members');
    expect(hardening).toContain('proofline_internal.sha256_json');
  });

  it('resolves pgcrypto hashing through the installed extension schema', () => {
    const hardening = migration('0006_pgcrypto_compatibility.sql');

    expect(hardening).toContain(
      'create schema if not exists proofline_internal',
    );
    expect(hardening).toContain(
      'create or replace function proofline_internal.sha256_json',
    );
    expect(hardening).toContain("where extension.extname = 'pgcrypto'");
    expect(hardening).toContain('pg_catalog.format');
    expect(hardening).toContain('pg_catalog.to_regprocedure');
    expect(hardening).toContain('set search_path = pg_catalog, pg_temp');
    expect(hardening).not.toContain('public.digest');
    expect(hardening).toContain(
      'create or replace function public.record_action_passport_audit',
    );
  });

  it('uses explicit service-role policies for worker-only aggregate writes', () => {
    const policies = migration('0002_rls_policies.sql');

    expect(policies).toContain(
      "to service_role using (auth.role() = 'service_role')",
    );
    for (const table of [
      'action_passports',
      'execution_attempts',
      'execution_receipts',
      'buzz_events',
      'outbox_jobs',
    ]) {
      expect(policies).toContain(`on public.${table}`);
    }
  });

  it('prevents direct audit mutations and writes audit rows from action triggers', () => {
    const policies = migration('0002_rls_policies.sql');
    const constraints = migration('0003_indexes_constraints.sql');

    expect(policies).toContain(
      'create policy audit_events_member_read on public.audit_events',
    );
    expect(policies).not.toContain('audit_events_member_write');
    expect(constraints).toContain(
      'create function public.reject_audit_event_mutation',
    );
    expect(constraints).toContain(
      "raise exception 'audit events are append-only'",
    );
    expect(constraints).toContain(
      'create trigger audit_events_reject_mutation before update or delete on public.audit_events',
    );
    expect(constraints).toContain(
      'create function public.record_action_passport_audit',
    );
    expect(constraints).toContain(
      'create trigger action_passports_audit after insert or update on public.action_passports',
    );
  });
});
