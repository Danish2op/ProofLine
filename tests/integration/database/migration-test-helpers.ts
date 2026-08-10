import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const migrationNames = [
  '0001_initial_schema.sql',
  '0002_rls_policies.sql',
  '0003_indexes_constraints.sql',
  '0004_task_5_hardening.sql',
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
