/**
 * Manages Mobile Mode ("phone" vs "pc_remote"), LAN host pairing,
 * real-time WebSocket /ws/remote sync with 3s ping/pong heartbeat &
 * exponential backoff, and strict remote authority to PC Dynamusic.
 */
import { create } from "zustand";
import type { Track } from "../types";
import { registerRemoteCommandDispatcher } from "../lib/remoteDispatch";

export type MobileMode = "phone" | "pc_remote";
export type RemoteConnectionStatus = "connected" | "reconnecting" | "offline";

export interface RemotePCPlayerState {
  track: Track | null;
  trackId?: string | null;
  playing: boolean;
  isPlaying?: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: string;
  playingFrom?: string | null;
  serverTimestamp?: number;
  /** Dedicated user-queued tracks taking strict priority over contextQueue. */
  priorityQueue?: Track[];
  /** Active playlist/album/search context queue. */
  contextQueue?: Track[];
  contextIndex?: number;
  /** Backwards-compatible unified queue slice. */
  queue?: Track[];
  index?: number;
  queueOffset?: number;
  autoplayCount?: number;
}

interface MobileModeState {
  mode: MobileMode;
  isMobileDevice: boolean;
  pcConnected: boolean;
  desktopOnline: boolean;
  connectionStatus: RemoteConnectionStatus;
  pcHost: string;
  pcState: RemotePCPlayerState | null;
  setMode: (mode: MobileMode) => void;
  setPcHost: (hostOrUrl: string) => void;
  setIsMobileDevice: (isMobile: boolean) => void;
  setPcState: (state: RemotePCPlayerState | null) => void;
  setDesktopOnline: (online: boolean) => void;
  setConnectionStatus: (status: RemoteConnectionStatus) => void;
  sendPcCommand: (command: string, payload?: unknown) => Promise<void>;
  reconnectNow: () => void;
}

const PC_HOST_KEY = "dynamusic:pc_host";
const MOBILE_MODE_KEY = "dynamusic:mobile_mode";

export function isTauriDesktop(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export function isPcRemoteMode(): boolean {
  if (typeof window === "undefined" || isTauriDesktop()) return false;
  try {
    return localStorage.getItem(MOBILE_MODE_KEY) === "pc_remote";
  } catch {
    return false;
  }
}

export function isCapacitorNative(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  try {
    return Boolean(cap?.isNativePlatform?.());
  } catch {
    return false;
  }
}

export function normalizeHostInput(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  try {
    if (trimmed.includes("://")) {
      return new URL(trimmed).hostname;
    }
  } catch {
    /* fallback below */
  }
  return trimmed.replace(/:\d+.*$/, "").replace(/\/+.*$/, "").trim();
}

export function getBackendHost(): string {
  if (typeof window !== "undefined" && window.location) {
    const host = window.location.hostname;
    const proto = String(window.location.protocol || "");
    if (
      host &&
      host !== "localhost" &&
      host !== "127.0.0.1" &&
      !proto.startsWith("tauri") &&
      !proto.startsWith("capacitor")
    ) {
      try {
        localStorage.setItem(PC_HOST_KEY, host);
      } catch {
        /* ignore */
      }
      return host;
    }
  }
  try {
    const saved = normalizeHostInput(localStorage.getItem(PC_HOST_KEY) || "");
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  return "127.0.0.1";
}

export function getBackendBaseUrl(): string {
  return `http://${getBackendHost()}:47822`;
}

export function getInterpolatedPcPosition(pcState: RemotePCPlayerState | null): number {
  if (!pcState) return 0;
  const base = Number.isFinite(pcState.position) ? pcState.position : 0;
  const playing = pcState.playing ?? pcState.isPlaying ?? false;
  const ts = pcState.serverTimestamp;
  const dur = pcState.duration || pcState.track?.duration || 0;
  if (!playing || typeof ts !== "number" || !Number.isFinite(ts)) {
    return dur > 0 ? Math.min(dur, Math.max(0, base)) : Math.max(0, base);
  }
  const elapsed = Math.max(0, Math.min(10, (Date.now() - ts) / 1000));
  const est = base + elapsed;
  return dur > 0 ? Math.min(dur, Math.max(0, est)) : Math.max(0, est);
}

function checkIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  if (isTauriDesktop()) return false;
  if (isCapacitorNative()) return true;
  const ua = navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isLanHost =
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1";
  const isNarrow = window.innerWidth <= 840;
  const isTouch = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0;
  return isMobileUA || isLanHost || (isTouch && isNarrow) || isNarrow;
}

function silenceLocalAudioElements(): void {
  if (typeof document === "undefined") return;
  try {
    document.querySelectorAll("audio").forEach((a) => {
      try {
        a.muted = true;
        a.pause();
      } catch {
        /* ignore */
      }
    });
  } catch {
    /* ignore */
  }
}

let remoteWs: WebSocket | null = null;
let wsReconnectFn: (() => void) | null = null;

export const useMobileMode = create<MobileModeState>((set, get) => ({
  mode: "phone",
  isMobileDevice: checkIsMobile(),
  pcConnected: false,
  desktopOnline: false,
  connectionStatus: "offline",
  pcHost: getBackendHost(),
  pcState: null,

  setMode: (mode) => {
    try {
      localStorage.setItem(MOBILE_MODE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
    // Strict authority: mute & pause any local phone audio immediately on pc_remote switch
    if (mode === "pc_remote" && !isTauriDesktop()) {
      silenceLocalAudioElements();
      if (isCapacitorNative()) {
        try {
          const cap = (window as unknown as {
            Capacitor?: { Plugins?: { MediaKeepalive?: { nativeStop?: () => Promise<void> } } };
          }).Capacitor;
          void cap?.Plugins?.MediaKeepalive?.nativeStop?.();
        } catch {
          /* ignore */
        }
      }
      void import("./player").then((p) => {
        if (p.usePlayer.getState().playing) {
          p.usePlayer.setState({ playing: false });
        }
      });
      get().reconnectNow();
    } else if (mode === "phone" && typeof document !== "undefined") {
      try {
        document.querySelectorAll("audio").forEach((a) => {
          a.muted = false;
        });
      } catch {
        /* ignore */
      }
    }
  },

  setPcHost: (hostOrUrl) => {
    const clean = normalizeHostInput(hostOrUrl) || "127.0.0.1";
    try {
      localStorage.setItem(PC_HOST_KEY, clean);
    } catch {
      /* ignore */
    }
    set({ pcHost: clean, connectionStatus: "reconnecting", pcConnected: false, desktopOnline: false });
    if (typeof window !== "undefined") {
      window.dispatchEvent(new CustomEvent("dynamusic:backend-host-changed"));
    }
    get().reconnectNow();
  },

  setIsMobileDevice: (isMobileDevice) => set({ isMobileDevice }),

  setPcState: (pcState) =>
    set({
      pcState,
      pcConnected: true,
      desktopOnline: true,
      connectionStatus: "connected",
    }),

  setDesktopOnline: (desktopOnline) => set({ desktopOnline }),

  setConnectionStatus: (connectionStatus) =>
    set((prev) => ({
      connectionStatus,
      pcConnected: connectionStatus === "connected",
      desktopOnline: connectionStatus === "connected" ? prev.desktopOnline : false,
    })),

  reconnectNow: () => {
    wsReconnectFn?.();
  },

  sendPcCommand: async (command, payload) => {
    const msg = JSON.stringify({ type: "command", command, payload });
    if (remoteWs && remoteWs.readyState === WebSocket.OPEN) {
      try {
        remoteWs.send(msg);
        return;
      } catch {
        /* fall through to HTTP */
      }
    }
    try {
      const host = getBackendHost();
      const res = await fetch(`http://${host}:47822/player/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, payload }),
      });
      if (!res.ok) {
        set({ connectionStatus: "reconnecting", pcConnected: false });
      }
    } catch {
      set({ connectionStatus: "reconnecting", pcConnected: false });
      get().reconnectNow();
    }
  },
}));

// Register synchronous dispatcher so player.ts never awaits dynamic import per click
registerRemoteCommandDispatcher((command, payload) => {
  void useMobileMode.getState().sendPcCommand(command, payload);
});

// Hydrate saved mode + initialize resilient WebSocket /ws/remote sync for mobile/browser clients
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem(MOBILE_MODE_KEY) as MobileMode | null;
    if (saved === "phone" || saved === "pc_remote") {
      useMobileMode.setState({ mode: saved });
      if (saved === "pc_remote" && !isTauriDesktop()) {
        silenceLocalAudioElements();
      }
    }
  } catch {
    /* ignore */
  }

  if (!isTauriDesktop()) {
    let attempt = 0;
    let retryTimer: number | null = null;
    let staleTimer: number | null = null;
    let destroyed = false;

    const clearTimers = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
      if (staleTimer !== null) {
        window.clearTimeout(staleTimer);
        staleTimer = null;
      }
    };

    const bumpStaleWatchdog = () => {
      if (staleTimer !== null) window.clearTimeout(staleTimer);
      // Server pings every 3s; if 9s pass with zero frames/pings, force reconnect
      staleTimer = window.setTimeout(() => {
        try {
          remoteWs?.close();
        } catch {
          /* ignore */
        }
      }, 9000);
    };

    const connectWs = () => {
      if (destroyed) return;
      clearTimers();
      if (remoteWs) {
        try {
          remoteWs.onopen = null;
          remoteWs.onmessage = null;
          remoteWs.onclose = null;
          remoteWs.onerror = null;
          remoteWs.close();
        } catch {
          /* ignore */
        }
        remoteWs = null;
      }

      const host = getBackendHost();
      const unconfiguredNative =
        isCapacitorNative() && (host === "127.0.0.1" || host === "localhost");
      if (unconfiguredNative) {
        useMobileMode.getState().setConnectionStatus("offline");
        return;
      }
      const wsUrl = `ws://${host}:47822/ws/remote?role=client`;
      useMobileMode.getState().setConnectionStatus(attempt === 0 ? "reconnecting" : "offline");

      try {
        const ws = new WebSocket(wsUrl);
        remoteWs = ws;

        ws.onopen = () => {
          attempt = 0;
          useMobileMode.getState().setConnectionStatus("connected");
          bumpStaleWatchdog();
          try {
            ws.send(JSON.stringify({ type: "request_state" }));
          } catch {
            /* ignore */
          }
        };

        ws.onmessage = (ev) => {
          bumpStaleWatchdog();
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              ts?: number;
              online?: boolean;
              state?: RemotePCPlayerState;
            };
            if (msg.type === "ping") {
              try {
                ws.send(JSON.stringify({ type: "pong", ts: msg.ts ?? Date.now() }));
              } catch {
                /* ignore */
              }
              return;
            }
            if (msg.type === "desktop_status") {
              useMobileMode.getState().setDesktopOnline(Boolean(msg.online));
              return;
            }
            if (msg.type === "state" && msg.state) {
              useMobileMode.getState().setPcState(msg.state);
            }
          } catch {
            /* ignore */
          }
        };

        const scheduleRetry = () => {
          if (destroyed) return;
          clearTimers();
          if (remoteWs === ws) remoteWs = null;
          const delay = Math.min(8000, Math.round(500 * Math.pow(1.75, attempt)));
          attempt += 1;
          useMobileMode.getState().setConnectionStatus(attempt > 2 ? "offline" : "reconnecting");
          retryTimer = window.setTimeout(connectWs, delay);
        };

        ws.onclose = scheduleRetry;
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        const delay = Math.min(8000, Math.round(500 * Math.pow(1.75, attempt)));
        attempt += 1;
        retryTimer = window.setTimeout(connectWs, delay);
      }
    };

    wsReconnectFn = () => {
      attempt = 0;
      connectWs();
    };

    connectWs();

    // Immediate wake reconnect when phone unlocks or returns to foreground / network reconnects
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible") {
        if (!remoteWs || remoteWs.readyState !== WebSocket.OPEN) {
          attempt = 0;
          connectWs();
        } else {
          try {
            remoteWs.send(JSON.stringify({ type: "request_state" }));
          } catch {
            connectWs();
          }
        }
      }
    });

    window.addEventListener("online", () => {
      attempt = 0;
      connectWs();
    });

    if (isCapacitorNative()) {
      try {
        const cap = (window as unknown as {
          Capacitor?: {
            Plugins?: {
              MediaKeepalive?: {
                addListener?: (event: string, cb: () => void) => Promise<{ remove: () => Promise<void> }> | { remove: () => void };
              };
            };
          };
        }).Capacitor;
        void cap?.Plugins?.MediaKeepalive?.addListener?.("appResume", () => {
          useMobileMode.getState().reconnectNow();
        });
      } catch {
        /* ignore */
      }
    }

    const onResize = () => {
      useMobileMode.getState().setIsMobileDevice(checkIsMobile());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
  }
}
