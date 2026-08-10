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
    readonly code: 'relay_unavailable' | 'relay_rejected' | 'malformed_frame',
    message: string,
  ) {
    super(message);
  }
}

export class Nip01RelayTransport implements BuzzTransport {
  private readonly relayUrl: string;
  private socket: RelaySocket | null = null;
  private connecting: Promise<RelaySocket> | null = null;
  private readonly pending = new Map<
    string,
    { resolve: () => void; reject: (error: Error) => void }
  >();

  constructor(
    private readonly options: {
      relayUrl: string;
      signer: BuzzSigner;
      socketFactory?: (relayUrl: string) => RelaySocket;
    },
  ) {
    this.relayUrl = new URL(options.relayUrl).toString();
  }

  async publish(event: BuzzSignedEvent): Promise<void> {
    const socket = await this.connect();
    await new Promise<void>((resolve, reject) => {
      this.pending.set(event.id, { resolve, reject });
      socket.send(JSON.stringify(['EVENT', event]));
    });
  }

  close(): void {
    this.socket?.close();
    this.socket = null;
    this.connecting = null;
  }

  private connect(): Promise<RelaySocket> {
    if (this.socket) return Promise.resolve(this.socket);
    if (this.connecting) return this.connecting;

    this.connecting = new Promise<RelaySocket>((resolve, reject) => {
      const socket = this.createSocket();
      socket.onopen = () => {
        this.socket = socket;
        resolve(socket);
      };
      socket.onmessage = (event) => {
        void this.handleFrame(event.data);
      };
      socket.onerror = () => {
        reject(
          new RelayTransportError(
            'relay_unavailable',
            'Relay connection failed.',
          ),
        );
      };
      socket.onclose = () => {
        const error = new RelayTransportError(
          'relay_unavailable',
          'Relay connection closed.',
        );
        for (const pending of this.pending.values()) pending.reject(error);
        this.pending.clear();
        this.socket = null;
        this.connecting = null;
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
      await this.answerChallenge(frame[1]);
      return;
    }
    if (
      frame[0] === 'OK' &&
      typeof frame[1] === 'string' &&
      typeof frame[2] === 'boolean'
    ) {
      const pending = this.pending.get(frame[1]);
      if (!pending) return;
      this.pending.delete(frame[1]);
      if (frame[2]) pending.resolve();
      else
        pending.reject(
          new RelayTransportError(
            'relay_rejected',
            String(frame[3] ?? 'Relay rejected event.'),
          ),
        );
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
    this.socket?.send(JSON.stringify(['AUTH', auth]));
  }

  private createSocket(): RelaySocket {
    if (this.options.socketFactory)
      return this.options.socketFactory(this.relayUrl);
    return new WebSocket(this.relayUrl) as unknown as RelaySocket;
  }

  private rejectAll(error: Error): void {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }
}
