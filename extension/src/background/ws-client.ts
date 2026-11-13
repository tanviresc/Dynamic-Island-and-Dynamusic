import {
  ContractEvent,
  WsClientMessage,
  WsServerMessage,
} from "../types";

export type ConnectionStatus =
  | "disconnected"
  | "connecting"
  | "connected"
  | "auth_failed";

export interface BufferedEvent {
  event: ContractEvent;
  queuedAt: number;
}

export const MAX_OFFLINE_BUFFER_SIZE = 50;
export const MAX_BUFFER_AGE_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Pure function: calculates next backoff with exponential increase + jitter.
 * Clamped between 1000ms and 30000ms.
 */
export function calculateBackoffMs(
  attempt: number,
  baseMs = 1000,
  maxMs = 30000,
  randomJitter = Math.random()
): number {
  const exp = Math.min(maxMs, baseMs * Math.pow(2, attempt));
  // Apply +/- 20% jitter
  const jitterRange = exp * 0.2;
  const jitter = (randomJitter * 2 - 1) * jitterRange;
  return Math.min(maxMs, Math.max(baseMs, Math.round(exp + jitter)));
}

/**
 * Pure function: prunes an offline event buffer by age and max size.
 */
export function pruneOfflineBuffer(
  buffer: BufferedEvent[],
  now: number,
  maxAgeMs = MAX_BUFFER_AGE_MS,
  maxSize = MAX_OFFLINE_BUFFER_SIZE
): BufferedEvent[] {
  // Drop items older than maxAgeMs
  const valid = buffer.filter((item) => now - item.queuedAt <= maxAgeMs);
  // Keep only up to maxSize most recent
  if (valid.length > maxSize) {
    return valid.slice(valid.length - maxSize);
  }
  return valid;
}

export interface WsClientCallbacks {
  onStatusChange?: (status: ConnectionStatus) => void;
  onCommand?: (
    command: Extract<WsServerMessage, { type: "command" }>
  ) => void;
  onAck?: (ack: Extract<WsServerMessage, { type: "ack" }>) => void;
}

export class WsClient {
  private port: number;
  private token: string;
  private callbacks: WsClientCallbacks;

  private ws: WebSocket | null = null;
  private status: ConnectionStatus = "disconnected";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private offlineBuffer: BufferedEvent[] = [];

  constructor(
    port: number,
    token: string,
    callbacks: WsClientCallbacks = {}
  ) {
    this.port = port;
    this.token = token;
    this.callbacks = callbacks;
  }

  public getStatus(): ConnectionStatus {
    return this.status;
  }

  public updateConfig(port: number, token: string): void {
    const changed = this.port !== port || this.token !== token;
    this.port = port;
    this.token = token;
    if (changed && (this.status === "connected" || this.status === "connecting")) {
      this.disconnect();
      this.connect();
    }
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    if (!this.token) {
      this.setStatus("disconnected");
      return;
    }

    this.setStatus("connecting");
    const url = `ws://127.0.0.1:${this.port}/v1/ws`;

    try {
      this.ws = new WebSocket(url);
    } catch {
      this.onConnectionFailed();
      return;
    }

    this.ws.onopen = () => {
      this.onOpen();
    };

    this.ws.onmessage = (event) => {
      this.onMessage(event.data);
    };

    this.ws.onclose = (event) => {
      this.onClose(event.code);
    };

    this.ws.onerror = () => {
      // Handled by onclose
    };
  }

  private onOpen(): void {
    // Send hello handshake
    const hello: WsClientMessage = {
      type: "hello",
      token: this.token,
      client: "chrome-extension",
      clientVersion: "0.1.0",
      browser: "chrome",
    };
    this.sendRaw(hello);
  }

  private onMessage(raw: any): void {
    if (typeof raw !== "string") return;
    try {
      const msg: WsServerMessage = JSON.parse(raw);
      switch (msg.type) {
        case "welcome": {
          this.setStatus("connected");
          this.reconnectAttempt = 0;
          this.startPing();
          this.flushOfflineBuffer();
          break;
        }
        case "ack": {
          this.callbacks.onAck?.(msg);
          break;
        }
        case "command": {
          this.callbacks.onCommand?.(msg);
          break;
        }
        case "pong": {
          // Pong received
          break;
        }
        case "error": {
          console.warn("[Island WS] Server error:", msg.reason);
          break;
        }
      }
    } catch (e) {
      console.error("[Island WS] Parse error:", e);
    }
  }

  private onClose(code: number): void {
    this.stopPing();
    this.ws = null;

    if (code === 4001 || code === 4002) {
      // Bad token or auth failed
      this.setStatus("auth_failed");
    } else {
      this.setStatus("disconnected");
      this.scheduleReconnect();
    }
  }

  private onConnectionFailed(): void {
    this.setStatus("disconnected");
    this.scheduleReconnect();
  }

  private scheduleReconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
    }
    const delay = calculateBackoffMs(this.reconnectAttempt);
    this.reconnectAttempt += 1;
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }

  private setStatus(status: ConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.callbacks.onStatusChange?.(status);
    }
  }

  private startPing(): void {
    this.stopPing();
    // Ping every 20s per §1.10.1
    this.pingInterval = setInterval(() => {
      if (this.status === "connected") {
        this.sendRaw({ type: "ping", t: Date.now() });
      }
    }, 20000);
  }

  private stopPing(): void {
    if (this.pingInterval) {
      clearInterval(this.pingInterval);
      this.pingInterval = null;
    }
  }

  public sendEvent(event: ContractEvent): void {
    if (this.status === "connected") {
      this.sendRaw({ type: "event", event });
    } else {
      // Buffer offline
      const now = Date.now();
      this.offlineBuffer.push({ event, queuedAt: now });
      this.offlineBuffer = pruneOfflineBuffer(this.offlineBuffer, now);
    }
  }

  public sendFocusReport(report: Extract<WsClientMessage, { type: "focus" }>): void {
    if (this.status === "connected") {
      this.sendRaw(report);
    }
  }

  public sendCommandResult(requestId: string, ok: boolean, error?: string): void {
    if (this.status === "connected") {
      this.sendRaw({
        type: "commandResult",
        requestId,
        ok,
        error,
      });
    }
  }

  private flushOfflineBuffer(): void {
    if (this.status !== "connected") return;
    const now = Date.now();
    this.offlineBuffer = pruneOfflineBuffer(this.offlineBuffer, now);
    while (this.offlineBuffer.length > 0) {
      const item = this.offlineBuffer.shift();
      if (item) {
        this.sendRaw({ type: "event", event: item.event });
      }
    }
  }

  private sendRaw(msg: WsClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  public disconnect(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    this.stopPing();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.setStatus("disconnected");
  }
}
