import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('@proofline/buzz-adapter package boundary', () => {
  it('builds and exposes the event verification API through its package export', () => {
    const build = spawnSync(
      'pnpm',
      ['--filter', '@proofline/buzz-adapter', 'run', 'build'],
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
        "import { verifyEvent } from '@proofline/buzz-adapter'; console.log(typeof verifyEvent)",
      ],
      {
        cwd: join(process.cwd(), 'packages', 'buzz-adapter'),
        encoding: 'utf8',
      },
    );

    expect(imported.status).toBe(0);
    expect(imported.stdout.trim()).toBe('function');
  }, 15_000);
});
