export class CanonicalizationError extends Error {
  override name = 'CanonicalizationError';
}

/**
 * Serializes JSON-compatible values using the ordering and number semantics
 * required by RFC 8785. Strings are NFC-normalized before serialization so
 * equivalent Unicode spellings cannot create different action hashes.
 */
export function canonicalize(value: unknown): string {
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(normalizeString(value));
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
      if (!Number.isFinite(value)) {
        throw new CanonicalizationError(
          'Non-finite numbers cannot be represented in canonical JSON.',
        );
      }
      return JSON.stringify(value);
    case 'object':
      return serializeObject(value, ancestors);
    default:
      throw new CanonicalizationError(
        `Values of type ${typeof value} cannot be represented in canonical JSON.`,
      );
  }
}

function serializeObject(value: object, ancestors: Set<object>): string {
  if (ancestors.has(value)) {
    throw new CanonicalizationError('Cyclic values cannot be canonicalized.');
  }

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return `[${value.map((item) => serialize(item, ancestors)).join(',')}]`;
    }

    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new CanonicalizationError(
        'Only plain objects can be represented in canonical JSON.',
      );
    }

    const record = value as Record<string, unknown>;
    const normalizedEntries = Object.keys(record)
      .map((key) => ({ key, normalizedKey: normalizeString(key) }))
      .sort((left, right) =>
        left.normalizedKey < right.normalizedKey
          ? -1
          : left.normalizedKey > right.normalizedKey
            ? 1
            : 0,
      );

    for (let index = 1; index < normalizedEntries.length; index += 1) {
      if (
        normalizedEntries[index - 1].normalizedKey ===
        normalizedEntries[index].normalizedKey
      ) {
        throw new CanonicalizationError(
          'Object keys that collide after Unicode normalization cannot be canonicalized.',
        );
      }
    }

    return `{${normalizedEntries
      .map(
        ({ key, normalizedKey }) =>
          `${JSON.stringify(normalizedKey)}:${serialize(record[key], ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}

function normalizeString(value: string): string {
  if (hasUnpairedSurrogate(value)) {
    throw new CanonicalizationError(
      'Strings with unpaired surrogate code units cannot be canonicalized.',
    );
  }
  return value.normalize('NFC');
}

function hasUnpairedSurrogate(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index);
    if (codeUnit >= 0xd800 && codeUnit <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      index += 1;
    } else if (codeUnit >= 0xdc00 && codeUnit <= 0xdfff) {
      return true;
    }
  }
  return false;
}
