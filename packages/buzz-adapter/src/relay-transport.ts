import type { BuzzSignedEvent, BuzzSigner, BuzzTransport } from './client.js';

export interface RelaySocket {
  onopen: (() => void) | null;
  onmessage: ((event: { data: string }) => void) | null;
  onerror: (() => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

export class RelayTransportError extends Error {
  constructor(
    readonly code:
      | 'relay_unavailable'
      | 'relay_rejected'
      | 'malformed_frame'
      | 'network_timeout',
    message: string,
  ) {
    super(message);
  }
}

type RelayAuthenticationState =
  | 'probing'
  | 'unauthenticated'
  | 'awaiting_challenge'
  | 'authenticating'
  | 'authenticated'
  | 'failed';

export class Nip01RelayTransport implements BuzzTransport {
  private readonly relayUrl: string;
  private readonly publicationTimeoutMs: number;
  private readonly authProbeTimeoutMs: number;
  private socket: RelaySocket | null = null;
  private connecting: Promise<RelaySocket> | null = null;
  private connectionGeneration = 0;
  private authState: RelayAuthenticationState = 'probing';
  private authFailure: Error | null = null;
  private authPromise: Promise<void> = Promise.resolve();
  private resolveAuth: (() => void) | null = null;
  private rejectAuth: ((error: Error) => void) | null = null;
  private authProbeTimer: ReturnType<typeof setTimeout> | null = null;
  private authEventId: string | null = null;
  private readonly authQueue = new Set<string>();
  private readonly pending = new Map<
    string,
    {
      event: BuzzSignedEvent;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      sent: boolean;
    }
  >();

  constructor(
    private readonly options: {
      relayUrl: string;
      signer: BuzzSigner;
      socketFactory?: (relayUrl: string) => RelaySocket;
      publicationTimeoutMs?: number;
      authProbeTimeoutMs?: number;
    },
  ) {
    this.relayUrl = new URL(options.relayUrl).toString();
    this.publicationTimeoutMs = options.publicationTimeoutMs ?? 10_000;
    this.authProbeTimeoutMs = options.authProbeTimeoutMs ?? 25;
  }

  async publish(event: BuzzSignedEvent): Promise<void> {
    const socket = await this.connect();
    if (this.authState === 'failed') {
      throw (
        this.authFailure ??
        new RelayTransportError(
          'relay_rejected',
          'Relay authentication failed.',
        )
      );
    }
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(event.id);
        if (!pending) return;
        this.pending.delete(event.id);
        this.authQueue.delete(event.id);
        pending.reject(
          new RelayTransportError(
            'network_timeout',
            'Relay publication acknowledgement timed out.',
          ),
        );
      }, this.publicationTimeoutMs);
      this.pending.set(event.id, {
        event,
        resolve,
        reject,
        timer,
        sent: false,
      });
      const pending = this.pending.get(event.id);
      if (!pending) return;
      this.queueForAuthentication(socket, event.id, pending);
    });
  }

  close(): void {
    const socket = this.socket;
    this.connectionGeneration += 1;
    this.socket = null;
    this.connecting = null;
    const error = new RelayTransportError(
      'relay_unavailable',
      'Relay connection closed.',
    );
    this.rejectAll(error);
    this.stopAuthentication(error);
    socket?.close();
  }

  private connect(): Promise<RelaySocket> {
    if (this.socket) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<RelaySocket>((resolve, reject) => {
      const socket = this.createSocket();
      const connectionGeneration = ++this.connectionGeneration;
      let opened = false;
      let settled = false;
      const connectionTimer = setTimeout(() => {
        if (settled || this.connectionGeneration !== connectionGeneration)
          return;
        settled = true;
        this.connectionGeneration += 1;
        this.connecting = null;
        socket.close();
        reject(
          new RelayTransportError(
            'network_timeout',
            'Relay connection timed out.',
          ),
        );
      }, this.publicationTimeoutMs);
      socket.onopen = () => {
        if (settled || this.connectionGeneration !== connectionGeneration)
          return;
        settled = true;
        clearTimeout(connectionTimer);
        opened = true;
        this.socket = socket;
        this.startAuthenticationProbe(socket, connectionGeneration);
        resolve(socket);
      };
      socket.onmessage = (event) => {
        void this.handleFrame(event.data, socket, connectionGeneration);
      };
      socket.onerror = () => {
        if (settled || this.connectionGeneration !== connectionGeneration)
          return;
        settled = true;
        clearTimeout(connectionTimer);
        this.connectionGeneration += 1;
        this.connecting = null;
        reject(
          new RelayTransportError(
            'relay_unavailable',
            'Relay connection failed.',
          ),
        );
      };
      socket.onclose = () => {
        if (this.connectionGeneration !== connectionGeneration) return;
        if (!opened && !settled) {
          settled = true;
          clearTimeout(connectionTimer);
          this.connecting = null;
          reject(
            new RelayTransportError(
              'relay_unavailable',
              'Relay connection closed before opening.',
            ),
          );
        }
        this.connectionGeneration += 1;
        const error = new RelayTransportError(
          'relay_unavailable',
          'Relay connection closed.',
        );
        this.rejectAll(error);
        this.socket = null;
        this.connecting = null;
        this.stopAuthentication(error);
      };
    });
    return this.connecting;
  }

  private async handleFrame(
    data: string,
    socket: RelaySocket,
    connectionGeneration: number,
  ): Promise<void> {
    if (!this.isCurrentConnection(socket, connectionGeneration)) return;
    let frame: unknown;
    try {
      frame = JSON.parse(data);
    } catch {
      this.rejectAll(
        new RelayTransportError(
          'malformed_frame',
          'Relay sent malformed JSON.',
        ),
      );
      return;
    }
    if (!Array.isArray(frame) || typeof frame[0] !== 'string') {
      this.rejectAll(
        new RelayTransportError(
          'malformed_frame',
          'Relay sent an invalid frame.',
        ),
      );
      return;
    }
    if (frame[0] === 'AUTH' && typeof frame[1] === 'string') {
      this.beginAuthentication(frame[1], socket, connectionGeneration);
      return;
    }
    if (
      frame[0] === 'OK' &&
      typeof frame[1] === 'string' &&
      typeof frame[2] === 'boolean'
    ) {
      if (frame[1] === this.authEventId) {
        this.authEventId = null;
        if (!frame[2]) {
          this.failAuthentication(
            new RelayTransportError(
              'relay_rejected',
              String(frame[3] ?? 'Relay authentication rejected.'),
            ),
          );
          return;
        }
        this.authState = 'authenticated';
        this.resolveAuthentication();
        return;
      }

      const pending = this.pending.get(frame[1]);
      if (!pending) return;
      if (frame[2]) {
        this.pending.delete(frame[1]);
        this.authQueue.delete(frame[1]);
        clearTimeout(pending.timer);
        pending.resolve();
      } else if (isAuthRequired(String(frame[3] ?? ''))) {
        pending.sent = false;
        this.awaitAuthenticationChallenge();
        this.queueForAuthentication(this.socket, frame[1], pending);
      } else {
        this.pending.delete(frame[1]);
        this.authQueue.delete(frame[1]);
        clearTimeout(pending.timer);
        pending.reject(
          new RelayTransportError(
            'relay_rejected',
            String(frame[3] ?? 'Relay rejected event.'),
          ),
        );
      }
    }
  }

  private async answerChallenge(
    challenge: string,
    socket: RelaySocket,
    connectionGeneration: number,
  ): Promise<void> {
    const auth = await this.options.signer.sign({
      created_at: Math.floor(Date.now() / 1_000),
      kind: 22242,
      tags: [
        ['relay', this.relayUrl],
        ['challenge', challenge],
      ],
      content: '',
    });
    if (!this.isCurrentConnection(socket, connectionGeneration)) return;
    this.authEventId = auth.id;
    socket.send(JSON.stringify(['AUTH', auth]));
  }

  private startAuthenticationProbe(
    socket: RelaySocket,
    connectionGeneration: number,
  ): void {
    this.clearAuthenticationProbe();
    this.authState = 'probing';
    this.authFailure = null;
    this.authEventId = null;
    this.authQueue.clear();
    this.createAuthenticationPromise();
    this.authProbeTimer = setTimeout(() => {
      if (!this.isCurrentConnection(socket, connectionGeneration)) return;
      if (this.authState !== 'probing') return;
      this.authState = 'unauthenticated';
      this.resolveAuthentication();
    }, this.authProbeTimeoutMs);
  }

  private beginAuthentication(
    challenge: string,
    socket: RelaySocket,
    connectionGeneration: number,
  ): void {
    if (
      this.authState === 'authenticated' ||
      this.authState === 'authenticating' ||
      this.authState === 'failed'
    ) {
      return;
    }
    this.clearAuthenticationProbe();
    if (this.authState === 'unauthenticated') {
      this.createAuthenticationPromise();
    }
    this.authState = 'authenticating';
    for (const [eventId, pending] of this.pending) {
      if (!pending.sent) this.authQueue.add(eventId);
    }
    void this.answerChallenge(challenge, socket, connectionGeneration).catch(
      (error: unknown) => {
        if (!this.isCurrentConnection(socket, connectionGeneration)) return;
        this.failAuthentication(
          error instanceof Error
            ? error
            : new RelayTransportError(
                'relay_rejected',
                'Relay authentication signing failed.',
              ),
        );
      },
    );
  }

  private awaitAuthenticationChallenge(): void {
    if (
      this.authState === 'authenticated' ||
      this.authState === 'authenticating' ||
      this.authState === 'awaiting_challenge' ||
      this.authState === 'failed'
    ) {
      return;
    }
    this.clearAuthenticationProbe();
    this.authState = 'awaiting_challenge';
    this.createAuthenticationPromise();
  }

  private queueForAuthentication(
    socket: RelaySocket | null,
    eventId: string,
    pending: {
      event: BuzzSignedEvent;
      sent: boolean;
    },
  ): void {
    if (!socket || this.authState === 'failed') return;
    if (
      this.authState === 'authenticated' ||
      this.authState === 'unauthenticated'
    ) {
      this.sendEvent(socket, pending);
      return;
    }
    this.authQueue.add(eventId);
    const authPromise = this.authPromise;
    void authPromise
      .then(() => {
        if (this.authPromise === authPromise) this.flushAuthenticationQueue();
      })
      .catch(() => {});
  }

  private createAuthenticationPromise(): void {
    this.authPromise = new Promise<void>((resolve, reject) => {
      this.resolveAuth = resolve;
      this.rejectAuth = reject;
    });
    void this.authPromise.catch(() => {});
  }

  private resolveAuthentication(): void {
    this.resolveAuth?.();
    this.resolveAuth = null;
    this.rejectAuth = null;
  }

  private failAuthentication(error: Error): void {
    this.clearAuthenticationProbe();
    this.authState = 'failed';
    this.authFailure = error;
    this.rejectAuth?.(error);
    this.resolveAuth = null;
    this.rejectAuth = null;
    this.rejectAll(error);
  }

  private stopAuthentication(error: Error): void {
    this.clearAuthenticationProbe();
    this.authState = 'probing';
    this.authFailure = null;
    this.authEventId = null;
    this.authQueue.clear();
    this.rejectAuth?.(error);
    this.resolveAuth = null;
    this.rejectAuth = null;
  }

  private clearAuthenticationProbe(): void {
    if (this.authProbeTimer) clearTimeout(this.authProbeTimer);
    this.authProbeTimer = null;
  }

  private flushAuthenticationQueue(): void {
    const socket = this.socket;
    if (!socket) return;
    for (const eventId of this.authQueue) {
      const pending = this.pending.get(eventId);
      if (pending) this.sendEvent(socket, pending);
    }
  }

  private createSocket(): RelaySocket {
    if (this.options.socketFactory)
      return this.options.socketFactory(this.relayUrl);
    return new WebSocket(this.relayUrl) as unknown as RelaySocket;
  }

  private isCurrentConnection(
    socket: RelaySocket,
    connectionGeneration: number,
  ): boolean {
    return (
      this.connectionGeneration === connectionGeneration &&
      this.socket === socket
    );
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
    this.authQueue.clear();
  }

  private sendEvent(
    socket: RelaySocket,
    pending: {
      event: BuzzSignedEvent;
      sent: boolean;
    },
  ): void {
    pending.sent = true;
    this.authQueue.delete(pending.event.id);
    socket.send(JSON.stringify(['EVENT', pending.event]));
  }
}

function isAuthRequired(reason: string): boolean {
  return /auth[-_ ]?required|authentication required/i.test(reason);
}
