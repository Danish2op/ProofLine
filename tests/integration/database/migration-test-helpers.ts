import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationNames = [
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
] as const;

export const tenantTables = [
  'workspaces',
  'workspace_members',
  'agents',
  'tool_definitions',
  'policies',
  'action_passports',
  'action_revisions',
  'evidence_items',
  'approval_events',
  'execution_attempts',
  'execution_receipts',
  'buzz_events',
  'audit_events',
  'outbox_jobs',
  'demo_runs',
] as const;

export function migration(name: (typeof migrationNames)[number]): string {
  const path = join(process.cwd(), 'supabase', 'migrations', name);
  return existsSync(path) ? normalizeSql(readFileSync(path, 'utf8')) : '';
}

export function allMigrations(): string {
  return migrationNames.map(migration).join('\n');
}

export function seed(): string {
  const path = join(process.cwd(), 'supabase', 'seed.sql');
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

export function normalizeSql(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
