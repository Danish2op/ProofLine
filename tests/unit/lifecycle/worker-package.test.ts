import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

describe('@proofline/worker package boundary', () => {
  it('declares the domain dependency and builds a directly importable package', () => {
    const build = spawnSync(
      'pnpm',
      ['--filter', '@proofline/worker', 'run', 'build'],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        shell: process.platform === 'win32',
        timeout: 20000,
      },
    );

    expect(build.status, `${build.stdout}\n${build.stderr}`).toBe(0);
    expect(build.error).toBeUndefined();

    const imported = spawnSync(
      process.execPath,
      [
        '--input-type=module',
        '--eval',
        "import { LifecycleCommandService } from '@proofline/worker'; console.log(typeof LifecycleCommandService);",
      ],
      {
        cwd: join(process.cwd(), 'apps', 'worker'),
        encoding: 'utf8',
        shell: false,
        timeout: 10000,
      },
    );

    expect(imported.status, `${imported.stdout}\n${imported.stderr}`).toBe(0);
    expect(imported.error).toBeUndefined();
    expect(imported.stdout.trim()).toBe('function');
  });
});
