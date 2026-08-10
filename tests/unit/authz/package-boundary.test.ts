import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

describe('web/authz package boundary', () => {
  it('builds the web package and resolves authz through its built package export', () => {
    const build = spawnSync(
      'pnpm',
      ['--filter', '@proofline/web', 'run', 'build'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
      },
    );

    expect(build.status).toBe(0);

    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { can } from '@proofline/authz'; console.log(typeof can)",
      ],
      {
        cwd: `${process.cwd()}/apps/web`,
        encoding: 'utf8',
      },
    );

    expect(imported.status).toBe(0);
    expect(imported.stdout.trim()).toBe('function');
  }, 15_000);
});
