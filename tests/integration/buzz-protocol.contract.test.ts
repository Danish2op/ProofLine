import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

import {
  buzzContractFixtures,
  parseRecordedBuzzEvent,
} from '../../packages/buzz-adapter/src/fixtures.js';
import { deriveBuzzCapabilities } from '../../packages/buzz-adapter/src/protocol-capabilities.js';

describe('recorded Buzz protocol fixtures', () => {
  it('accepts valid NIP-29 replies, NIP-25 reactions, duplicate events, out-of-order events, and unknown signers', () => {
    const acceptedFixtures = buzzContractFixtures.filter(
      (fixture) => fixture.expectedParse === 'accept',
    );

    for (const fixture of acceptedFixtures) {
      expect(parseRecordedBuzzEvent(fixture.event)).toEqual({
        ok: true,
        event: fixture.event,
      });
    }
  });

  it('rejects a malformed event before any trust or approval interpretation', () => {
    const malformed = buzzContractFixtures.find(
      (fixture) => fixture.name === 'malformed-event',
    );

    expect(malformed).toBeDefined();
    expect(parseRecordedBuzzEvent(malformed!.event)).toEqual({
      ok: false,
      reason: 'event.id must be a 64-character lowercase hexadecimal string',
    });
  });

  it('derives required transport capabilities while leaving optional capabilities false', () => {
    expect(
      deriveBuzzCapabilities(
        'https://relay.example.test/',
        { supported_nips: [1] },
        '2026-08-10T00:00:00.000Z',
      ),
    ).toEqual({
      relayUrl: 'https://relay.example.test/',
      publishEvents: true,
      queryEvents: true,
      subscribeEvents: true,
      reactions: false,
      threads: false,
      channelReferences: false,
      source:
        'NIP-11 relay information document (read-only GET with Accept: application/nostr+json)',
      verifiedAt: '2026-08-10T00:00:00.000Z',
    });
  });

  it('fails clearly without BUZZ_RELAY_URL and makes no network request', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/buzz-smoke.ts'],
      {
        cwd: process.cwd(),
        env: { ...process.env, BUZZ_RELAY_URL: '' },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('BUZZ_RELAY_URL is required');
  });

  it('rejects relay URLs with userinfo without echoing credentials', () => {
    const result = spawnSync(
      process.execPath,
      ['--experimental-strip-types', 'scripts/buzz-smoke.ts'],
      {
        cwd: process.cwd(),
        env: {
          ...process.env,
          BUZZ_RELAY_URL: 'https://relay-user:relay-password@example.test',
        },
        encoding: 'utf8',
      },
    );

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('BUZZ_RELAY_URL must not include userinfo');
    expect(`${result.stdout}${result.stderr}`).not.toContain('relay-password');
  });
});
