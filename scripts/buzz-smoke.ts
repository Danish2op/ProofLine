import type { BuzzCapabilities } from '../packages/buzz-adapter/src/protocol-capabilities.js';

const source =
  'NIP-11 relay information document (read-only GET with Accept: application/nostr+json)';
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
    fail(`BUZZ_RELAY_URL is invalid: ${message(error)}`);
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

  const supportedNips = readSupportedNips(document);
  if (!supportedNips) {
    fail(
      'NIP-11 response is missing a numeric supported_nips array; capabilities cannot be verified.',
    );
    return;
  }

  const capabilities: BuzzCapabilities = {
    relayUrl: probeUrl.toString(),
    publishEvents: supportedNips.includes(1),
    queryEvents: supportedNips.includes(1),
    subscribeEvents: supportedNips.includes(1),
    reactions: supportedNips.includes(25),
    threads: supportedNips.includes(10),
    channelReferences: supportedNips.includes(29),
    source,
    verifiedAt: new Date().toISOString(),
  };

  const unavailable = requiredNips.filter(
    (nip) => !supportedNips.includes(nip),
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
  if (url.protocol === 'ws:') url.protocol = 'http:';
  if (url.protocol === 'wss:') url.protocol = 'https:';
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('expected an http(s) or ws(s) URL');
  }
  return url;
}

function readSupportedNips(document: unknown): number[] | null {
  if (typeof document !== 'object' || document === null) return null;
  const supportedNips = (document as Record<string, unknown>).supported_nips;
  return Array.isArray(supportedNips) && supportedNips.every(Number.isInteger)
    ? supportedNips
    : null;
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
