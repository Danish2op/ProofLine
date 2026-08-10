export type JsonSafetyCode =
  'invalid_unicode' | 'non_deterministic_value' | 'too_large';

export interface JsonSafetyIssue {
  code: JsonSafetyCode;
  message: string;
  path: string;
}

export interface JsonSafetyOptions {
  maxArrayLength?: number;
  maxDepth?: number;
  maxObjectProperties?: number;
  maxStringLength?: number;
  requireNfc?: boolean;
}

/**
 * Checks that a value is representable as deterministic JSON without applying
 * JSON.stringify's lossy coercions. Domain callers can additionally require
 * NFC and apply input-size limits before a value is hashed.
 */
export function findJsonSafetyIssue(
  value: unknown,
  options: JsonSafetyOptions = {},
): JsonSafetyIssue | null {
  return inspect(value, options, '', 0, new Set<object>());
}

function inspect(
  value: unknown,
  options: JsonSafetyOptions,
  path: string,
  depth: number,
  ancestors: Set<object>,
): JsonSafetyIssue | null {
  if (options.maxDepth !== undefined && depth > options.maxDepth) {
    return issue('too_large', 'JSON value exceeds its maximum depth.', path);
  }
  if (value === null || typeof value === 'boolean') return null;

  if (typeof value === 'string') {
    if (hasUnpairedSurrogate(value)) {
      return issue(
        'invalid_unicode',
        'Strings cannot contain unpaired surrogate code units.',
        path,
      );
    }
    if (options.requireNfc && value.normalize('NFC') !== value) {
      return issue(
        'invalid_unicode',
        'Strings must use NFC Unicode normalization.',
        path,
      );
    }
    if (
      options.maxStringLength !== undefined &&
      value.length > options.maxStringLength
    ) {
      return issue(
        'too_large',
        'JSON string exceeds its maximum length.',
        path,
      );
    }
    return null;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value)
      ? null
      : issue('non_deterministic_value', 'JSON numbers must be finite.', path);
  }

  if (typeof value !== 'object') {
    return issue(
      'non_deterministic_value',
      `Values of type ${typeof value} are not JSON-safe.`,
      path,
    );
  }

  if (ancestors.has(value)) {
    return issue(
      'non_deterministic_value',
      'JSON values cannot be cyclic.',
      path,
    );
  }
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      return inspectArray(value, options, path, depth, ancestors);
    }
    return inspectObject(value, options, path, depth, ancestors);
  } finally {
    ancestors.delete(value);
  }
}

function inspectArray(
  value: unknown[],
  options: JsonSafetyOptions,
  path: string,
  depth: number,
  ancestors: Set<object>,
): JsonSafetyIssue | null {
  if (
    options.maxArrayLength !== undefined &&
    value.length > options.maxArrayLength
  ) {
    return issue('too_large', 'JSON array exceeds its maximum length.', path);
  }

  for (const key of Reflect.ownKeys(value)) {
    if (typeof key === 'symbol' || (key !== 'length' && !isArrayIndex(key))) {
      return issue(
        'non_deterministic_value',
        'JSON arrays cannot have non-index properties.',
        path,
      );
    }
  }

  for (let index = 0; index < value.length; index += 1) {
    if (!Object.hasOwn(value, index)) {
      return issue(
        'non_deterministic_value',
        'JSON arrays cannot contain holes.',
        joinPath(path, index),
      );
    }
    const nestedIssue = inspect(
      value[index],
      options,
      joinPath(path, index),
      depth + 1,
      ancestors,
    );
    if (nestedIssue) return nestedIssue;
  }
  return null;
}

function inspectObject(
  value: object,
  options: JsonSafetyOptions,
  path: string,
  depth: number,
  ancestors: Set<object>,
): JsonSafetyIssue | null {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    return issue(
      'non_deterministic_value',
      'JSON objects must be plain objects.',
      path,
    );
  }

  const keys = Reflect.ownKeys(value);
  if (
    options.maxObjectProperties !== undefined &&
    keys.length > options.maxObjectProperties
  ) {
    return issue(
      'too_large',
      'JSON object exceeds its maximum property count.',
      path,
    );
  }

  for (const key of keys) {
    if (typeof key !== 'string') {
      return issue(
        'non_deterministic_value',
        'JSON objects cannot have symbol properties.',
        path,
      );
    }
    if (hasUnpairedSurrogate(key)) {
      return issue(
        'invalid_unicode',
        'JSON object keys cannot contain unpaired surrogate code units.',
        path,
      );
    }
    if (options.requireNfc && key.normalize('NFC') !== key) {
      return issue(
        'invalid_unicode',
        'JSON object keys must use NFC Unicode normalization.',
        path,
      );
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      return issue(
        'non_deterministic_value',
        'JSON objects must use enumerable data properties.',
        joinPath(path, key),
      );
    }
    const nestedIssue = inspect(
      descriptor.value,
      options,
      joinPath(path, key),
      depth + 1,
      ancestors,
    );
    if (nestedIssue) return nestedIssue;
  }
  return null;
}

function issue(
  code: JsonSafetyCode,
  message: string,
  path: string,
): JsonSafetyIssue {
  return { code, message, path };
}

function isArrayIndex(key: string): boolean {
  const index = Number(key);
  return Number.isInteger(index) && index >= 0 && String(index) === key;
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

function joinPath(path: string, key: string | number): string {
  return path === '' ? String(key) : `${path}.${key}`;
}
