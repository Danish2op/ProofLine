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
