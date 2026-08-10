import { describe, expect, it } from 'vitest';

import {
  CanonicalizationError,
  canonicalize,
} from '../../../packages/canonical/src/canonicalize.js';
import { computePassportHash } from '../../../packages/canonical/src/hashing.js';
import { redactForDisplay } from '../../../packages/canonical/src/redaction.js';

describe('canonicalize', () => {
  it('produces the same canonical JSON regardless of object key order', () => {
    expect(
      canonicalize({
        target: 'staging',
        arguments: { release: 42, dryRun: false },
      }),
    ).toBe('{"arguments":{"dryRun":false,"release":42},"target":"staging"}');
  });

  it('normalizes equivalent Unicode strings before canonicalization', () => {
    expect(canonicalize({ label: 'Cafe\u0301' })).toBe(
      canonicalize({ label: 'Caf\u00e9' }),
    );
  });

  it('rejects object keys that collide after Unicode normalization', () => {
    expect(() =>
      canonicalize({ Café: 'decomposed', Café: 'precomposed' }),
    ).toThrow(CanonicalizationError);
  });

  it('sorts normalized object keys by Unicode code units, not locale rules', () => {
    expect(canonicalize({ ä: 1, z: 2 })).toBe('{"z":2,"\u00e4":1}');
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'rejects non-finite number %s rather than coercing it',
    (value) => {
      expect(() => canonicalize({ value })).toThrow(CanonicalizationError);
    },
  );

  it('rejects strings with unpaired surrogate code units', () => {
    expect(() => canonicalize({ value: String.fromCharCode(0xd800) })).toThrow(
      CanonicalizationError,
    );
  });
});

describe('computePassportHash', () => {
  it('returns the lowercase SHA-256 of canonical JSON independent of key order', () => {
    expect(computePassportHash({ target: 'staging' })).toBe(
      '295aff2366ab9f4c0e5ae73e0f49d22cb9a43287d277ab575544a8c28ec14079',
    );
    expect(
      computePassportHash({ arguments: { dryRun: false }, target: 'staging' }),
    ).toBe(
      computePassportHash({ target: 'staging', arguments: { dryRun: false } }),
    );
  });
});

describe('redactForDisplay', () => {
  it('replaces sensitive values with stable labels while retaining the protected payload hash', () => {
    const result = redactForDisplay({
      destination: 'staging',
      nested: { apiKey: 'live-key' },
      token: 'top-secret',
    });

    expect(result).toEqual({
      protectedPayloadHash:
        '82fa014bfcde1d589f799fe5da9c7c05acd70baa6af04c4d78c9615e24e4bef1',
      redacted: {
        destination: 'staging',
        nested: { apiKey: '[REDACTED:13705115bca8]' },
        token: '[REDACTED:190aec7389a3]',
      },
    });
  });
});
