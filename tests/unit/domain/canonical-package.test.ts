import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('@proofline/canonical package', () => {
  it('builds and resolves its public JSON-safety export by package name', () => {
    const build = spawnSync(
      'pnpm',
      ['--filter', '@proofline/canonical', 'run', 'build'],
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
        "import { findJsonSafetyIssue } from '@proofline/canonical'; console.log(typeof findJsonSafetyIssue);",
      ],
      { cwd: join(process.cwd(), 'packages', 'domain'), encoding: 'utf8' },
    );

    expect(imported.status).toBe(0);
    expect(imported.stdout.trim()).toBe('function');
  });
});
