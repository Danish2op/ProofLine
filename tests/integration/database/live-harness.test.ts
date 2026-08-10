import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

describe('live Supabase verification harness', () => {
  it('skips without SUPABASE_DB_URL instead of requiring a committed credential', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/verify-supabase-db.ts'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: { ...process.env, SUPABASE_DB_URL: '' },
      },
    );

    expect(result.status).toBe(0);
    expect(result.stdout).toContain(
      'SKIPPED: set SUPABASE_DB_URL to run live Supabase database probes.',
    );
  });
});
