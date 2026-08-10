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
