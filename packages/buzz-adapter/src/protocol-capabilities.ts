/**
 * A recorded capability assessment for one relay. Values are observations from
 * a read-only probe, not guarantees that a future authenticated request will
 * be authorized.
 */
export interface BuzzCapabilities {
  relayUrl: string;
  publishEvents: boolean;
  queryEvents: boolean;
  subscribeEvents: boolean;
  reactions: boolean;
  threads: boolean;
  channelReferences: boolean;
  source: string;
  verifiedAt: string;
}

export const buzzCapabilitySource =
  'NIP-11 relay information document (read-only GET with Accept: application/nostr+json)';

/**
 * Converts a NIP-11 advertisement into the capability record consumed by the
 * future adapter. NIP-01 is required transport; the remaining flags are
 * optional and intentionally remain false when not advertised.
 */
export function deriveBuzzCapabilities(
  relayUrl: string,
  document: unknown,
  verifiedAt: string,
): BuzzCapabilities {
  const supportedNips = readSupportedNips(document);
  if (!supportedNips) {
    throw new Error(
      'NIP-11 response is missing a numeric supported_nips array; capabilities cannot be verified.',
    );
  }

  return {
    relayUrl,
    publishEvents: supportedNips.includes(1),
    queryEvents: supportedNips.includes(1),
    subscribeEvents: supportedNips.includes(1),
    reactions: supportedNips.includes(25),
    threads: supportedNips.includes(10),
    channelReferences: supportedNips.includes(29),
    source: buzzCapabilitySource,
    verifiedAt,
  };
}

function readSupportedNips(document: unknown): number[] | null {
  if (typeof document !== 'object' || document === null) return null;
  const supportedNips = (document as Record<string, unknown>).supported_nips;
  return Array.isArray(supportedNips) && supportedNips.every(Number.isInteger)
    ? supportedNips
    : null;
}
