import {
  deriveBuzzCapabilities,
  type BuzzCapabilities,
} from '../packages/buzz-adapter/src/protocol-capabilities.ts';

const requiredNips = [1];

async function main(): Promise<void> {
  const relayUrl = process.env.BUZZ_RELAY_URL;
  if (!relayUrl) {
    fail(
      'BUZZ_RELAY_URL is required; refusing to probe a relay without an explicit disposable test-community URL.',
    );
    return;
  }

  let probeUrl: URL;
  try {
    probeUrl = toHttpUrl(relayUrl);
  } catch (error) {
    fail(
      error instanceof Error && error.message === 'userinfo is not permitted'
        ? 'BUZZ_RELAY_URL must not include userinfo.'
        : 'BUZZ_RELAY_URL must be a valid http(s) or ws(s) URL without userinfo.',
    );
    return;
  }

  let response: Response;
  let document: unknown;
  try {
    response = await fetch(probeUrl, {
      headers: { Accept: 'application/nostr+json' },
      redirect: 'error',
    });
    document = await response.json();
  } catch (error) {
    fail(
      `Read-only NIP-11 probe failed for ${probeUrl.origin}: ${message(error)}`,
    );
    return;
  }

  if (!response.ok) {
    fail(
      `Read-only NIP-11 probe returned HTTP ${response.status} for ${probeUrl.origin}.`,
    );
    return;
  }

  let capabilities: BuzzCapabilities;
  try {
    capabilities = deriveBuzzCapabilities(
      probeUrl.toString(),
      document,
      new Date().toISOString(),
    );
  } catch (error) {
    fail(message(error));
    return;
  }

  const unavailable = requiredNips.filter(
    (nip) => nip !== 1 || !capabilities.publishEvents,
  );
  if (unavailable.length > 0) {
    console.error(
      JSON.stringify({
        capabilities,
        responseShape: describeJsonShape(document),
      }),
    );
    fail(
      `Required NIP capability is unavailable: ${unavailable.map((nip) => `NIP-${nip}`).join(', ')}.`,
    );
    return;
  }

  console.log(
    JSON.stringify({
      capabilities,
      responseShape: describeJsonShape(document),
    }),
  );
}

function toHttpUrl(relayUrl: string): URL {
  const url = new URL(relayUrl);
  if (url.username || url.password) {
    throw new Error('userinfo is not permitted');
  }
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('expected an http(s) or ws(s) URL');
  }
  return url;
}

function describeJsonShape(value: unknown): unknown {
  if (Array.isArray(value)) {
    return {
      type: 'array',
      itemShapes: [
        ...new Set(
          value.map((item) => JSON.stringify(describeJsonShape(item))),
        ),
      ].map(JSON.parse),
    };
  }
  if (typeof value === 'object' && value !== null) {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, describeJsonShape(item)]),
    );
  }
  return typeof value;
}

function fail(reason: string): void {
  console.error(reason);
  process.exitCode = 1;
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

void main();
