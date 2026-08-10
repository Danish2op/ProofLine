import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('policy package boundary', () => {
  it('builds and resolves policy and domain APIs through workspace package names', () => {
    for (const packageName of [
      '@proofline/canonical',
      '@proofline/domain',
      '@proofline/policy-engine',
    ]) {
      const build = spawnSync(
        'pnpm',
        ['--filter', packageName, 'run', 'build'],
        {
          cwd: process.cwd(),
          encoding: 'utf8',
          shell: process.platform === 'win32',
        },
      );

      expect(build.status).toBe(0);
    }

    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { evaluatePolicy } from '@proofline/policy-engine'; import { validatePassport } from '@proofline/domain'; console.log(`${typeof evaluatePolicy}:${typeof validatePassport}`);",
      ],
      {
        cwd: join(process.cwd(), 'packages', 'policy-engine'),
        encoding: 'utf8',
      },
    );

    expect(imported.status).toBe(0);
    expect(imported.stdout.trim()).toBe('function:function');
  }, 15_000);
});
