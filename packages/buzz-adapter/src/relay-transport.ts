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

export class Nip01RelayTransport implements BuzzTransport {
  private readonly relayUrl: string;
  private readonly publicationTimeoutMs: number;
  private readonly authProbeTimeoutMs: number;
  private socket: RelaySocket | null = null;
  private connecting: Promise<RelaySocket> | null = null;
  private authenticated = false;
  private authEventId: string | null = null;
  private readonly pending = new Map<
    string,
    {
      event: BuzzSignedEvent;
      resolve: () => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
      probeTimer: ReturnType<typeof setTimeout> | null;
      awaitingAuth: boolean;
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
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        const pending = this.pending.get(event.id);
        if (!pending) return;
        this.pending.delete(event.id);
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
        probeTimer: null,
        awaitingAuth: false,
        sent: false,
      });
      const pending = this.pending.get(event.id);
      if (!pending) return;
      if (this.authenticated) {
        this.sendEvent(socket, pending);
      } else {
        pending.probeTimer = setTimeout(() => {
          if (this.pending.get(event.id) !== pending || this.authEventId)
            return;
          this.sendEvent(socket, pending);
        }, this.authProbeTimeoutMs);
      }
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
    this.authenticated = false;
    this.authEventId = null;
  }

  private connect(): Promise<RelaySocket> {
    if (this.socket) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<RelaySocket>((resolve, reject) => {
      const socket = this.createSocket();
      let opened = false;
      let settled = false;
      const connectionTimer = setTimeout(() => {
        if (settled) return;
        settled = true;
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
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimer);
        opened = true;
        this.socket = socket;
        this.authenticated = false;
        resolve(socket);
      };
      socket.onmessage = (event) => {
        void this.handleFrame(event.data);
      };
      socket.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(connectionTimer);
        this.connecting = null;
        reject(
          new RelayTransportError(
            'relay_unavailable',
            'Relay connection failed.',
          ),
        );
      };
      socket.onclose = () => {
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
        const error = new RelayTransportError(
          'relay_unavailable',
          'Relay connection closed.',
        );
        this.rejectAll(error);
        this.socket = null;
        this.connecting = null;
        this.authenticated = false;
        this.authEventId = null;
      };
    });
    return this.connecting;
  }

  private async handleFrame(data: string): Promise<void> {
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
      for (const pending of this.pending.values()) {
        if (!pending.sent) {
          pending.awaitingAuth = true;
          if (pending.probeTimer) clearTimeout(pending.probeTimer);
          pending.probeTimer = null;
        }
      }
      await this.answerChallenge(frame[1]);
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
          this.rejectAll(
            new RelayTransportError(
              'relay_rejected',
              String(frame[3] ?? 'Relay authentication rejected.'),
            ),
          );
          return;
        }
        this.authenticated = true;
        for (const pending of this.pending.values()) {
          if (!pending.awaitingAuth) continue;
          pending.awaitingAuth = false;
          if (this.socket) this.sendEvent(this.socket, pending);
        }
        return;
      }

      const pending = this.pending.get(frame[1]);
      if (!pending) return;
      if (frame[2]) {
        this.pending.delete(frame[1]);
        clearTimeout(pending.timer);
        pending.resolve();
      } else if (isAuthRequired(String(frame[3] ?? ''))) {
        pending.sent = false;
        pending.awaitingAuth = true;
      } else {
        this.pending.delete(frame[1]);
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

  private async answerChallenge(challenge: string): Promise<void> {
    const auth = await this.options.signer.sign({
      created_at: Math.floor(Date.now() / 1_000),
      kind: 22242,
      tags: [
        ['relay', this.relayUrl],
        ['challenge', challenge],
      ],
      content: '',
    });
    this.authEventId = auth.id;
    this.socket?.send(JSON.stringify(['AUTH', auth]));
  }

  private createSocket(): RelaySocket {
    if (this.options.socketFactory)
      return this.options.socketFactory(this.relayUrl);
    return new WebSocket(this.relayUrl) as unknown as RelaySocket;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      if (pending.probeTimer) clearTimeout(pending.probeTimer);
      pending.reject(error);
    }
    this.pending.clear();
  }

  private sendEvent(
    socket: RelaySocket,
    pending: {
      event: BuzzSignedEvent;
      probeTimer: ReturnType<typeof setTimeout> | null;
      sent: boolean;
    },
  ): void {
    if (pending.probeTimer) clearTimeout(pending.probeTimer);
    pending.probeTimer = null;
    pending.sent = true;
    socket.send(JSON.stringify(['EVENT', pending.event]));
  }
}

function isAuthRequired(reason: string): boolean {
  return /auth[-_ ]?required|authentication required/i.test(reason);
}
