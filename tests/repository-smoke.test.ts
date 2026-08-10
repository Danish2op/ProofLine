import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const root = join(import.meta.dirname, '..');

const workspacePackages = [
  'domain',
  'canonical',
  'policy-engine',
  'buzz-adapter',
  'agents',
  'execution',
  'authz',
];

const applications = ['web', 'worker'];

const requiredEnvironmentNames = [
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'BUZZ_RELAY_URL',
  'BUZZ_DEMO_CHANNEL',
  'BUZZ_AGENT_PRIVATE_KEY',
  'BUZZ_VERIFIER_PRIVATE_KEY',
  'BUZZ_HUMAN_PUBLIC_KEY',
  'DEMO_MODE',
  'APP_ORIGIN',
];

describe('repository bootstrap', () => {
  it('resolves every declared workspace package and application', () => {
    for (const packageName of workspacePackages) {
      expect(
        existsSync(join(root, 'packages', packageName, 'package.json')),
      ).toBe(true);
    }

    for (const applicationName of applications) {
      expect(
        existsSync(join(root, 'apps', applicationName, 'package.json')),
      ).toBe(true);
    }
  });

  it('defines the required root scripts', () => {
    const packageJson = JSON.parse(
      readFileSync(join(root, 'package.json'), 'utf8'),
    ) as {
      scripts?: Record<string, string>;
    };

    for (const scriptName of [
      'lint',
      'typecheck',
      'test',
      'test:e2e',
      'build',
      'format:check',
    ]) {
      expect(packageJson.scripts?.[scriptName]).toEqual(expect.any(String));
    }
  });

  it('enables strict TypeScript and declares environment names without values', () => {
    const tsconfig = JSON.parse(
      readFileSync(join(root, 'tsconfig.base.json'), 'utf8'),
    ) as {
      compilerOptions?: { strict?: boolean; noImplicitAny?: boolean };
    };
    expect(tsconfig.compilerOptions?.strict).toBe(true);
    expect(tsconfig.compilerOptions?.noImplicitAny).toBe(true);

    const envExample = readFileSync(join(root, '.env.example'), 'utf8');
    for (const environmentName of requiredEnvironmentNames) {
      expect(envExample).toMatch(new RegExp(`^${environmentName}=\\s*$`, 'm'));
    }
  });
});
