import { findJsonSafetyIssue } from './json-safe.js';

export class CanonicalizationError extends Error {
  override name = 'CanonicalizationError';
}

/** Serializes a JSON-safe value using RFC 8785-compatible JSON semantics. */
export function canonicalize(value: unknown): string {
  const issue = findJsonSafetyIssue(value);
  if (issue) throw new CanonicalizationError(issue.message);
  return serialize(value, new Set<object>());
}

function serialize(value: unknown, ancestors: Set<object>): string {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
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

    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .sort()
      .map(
        (key) => `${JSON.stringify(key)}:${serialize(record[key], ancestors)}`,
      )
      .join(',')}}`;
  } finally {
    ancestors.delete(value);
  }
}
