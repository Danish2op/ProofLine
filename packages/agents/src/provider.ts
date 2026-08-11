import type {
  OptionalProviderResult,
  OptionalProviderRun,
} from './result-types.js';

/**
 * Runs an optional provider only for non-authoritative assistance. Its output is
 * deliberately ignored until a caller parses it into its own typed display data;
 * the deterministic fallback remains the sole proposal/verifier authority.
 */
export async function runWithOptionalProvider<T>(
  input: OptionalProviderRun<T>,
): Promise<OptionalProviderResult<T>> {
  if (input.provider === undefined) return { value: await input.fallback() };

  const attempts = Math.max(1, Math.min(3, input.retries + 1));
  const timeoutMs = Math.max(1, Math.min(5_000, input.timeoutMs));
  let timeout = false;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const output = await withinTimeout(input.provider.run(), timeoutMs);
      if (input.parse !== undefined && input.parse(output) === null) {
        throw new Error(
          'Optional provider output did not match its typed schema.',
        );
      }
      return { value: await input.fallback() };
    } catch (error) {
      timeout = error instanceof ProviderTimeoutError;
    }
  }
  return {
    value: await input.fallback(),
    providerFailure: {
      code: timeout ? 'provider_timeout' : 'provider_failure',
      attempts,
    },
  };
}

class ProviderTimeoutError extends Error {}

async function withinTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new ProviderTimeoutError()), timeoutMs);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
