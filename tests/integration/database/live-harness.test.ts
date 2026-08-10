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

  it('refuses --apply before connecting unless disposal is explicitly confirmed', () => {
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/verify-supabase-db.ts',
        '--apply',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          SUPABASE_DB_URL: 'postgresql://localhost:6543/proofline',
          SUPABASE_DB_VERIFY_DISPOSABLE: '',
        },
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain(
      'REFUSED: --apply requires SUPABASE_DB_VERIFY_DISPOSABLE=I_UNDERSTAND.',
    );
    expect(result.stderr).not.toContain(
      'postgresql://localhost:6543/proofline',
    );
  });

  it('does not reveal the supplied database URL when apply is refused', () => {
    const databaseUrl =
      'postgresql://proofline:secret@localhost:6543/proofline';
    const result = spawnSync(
      process.execPath,
      [
        '--experimental-strip-types',
        'scripts/verify-supabase-db.ts',
        '--apply',
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        env: {
          ...process.env,
          SUPABASE_DB_URL: databaseUrl,
          SUPABASE_DB_VERIFY_DISPOSABLE: '',
        },
      },
    );

    expect(result.status).toBe(1);
    expect(`${result.stdout}${result.stderr}`).not.toContain(databaseUrl);
  });
});
