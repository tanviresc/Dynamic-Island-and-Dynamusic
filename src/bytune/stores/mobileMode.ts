/**
 * Manages Mobile Mode ("phone" vs "pc_remote") and remote commands to PC Dynamusic.
 */
import { create } from "zustand";
import type { Track } from "../types";

export type MobileMode = "phone" | "pc_remote";

export interface RemotePCPlayerState {
  track: Track | null;
  playing: boolean;
  position: number;
  duration: number;
  volume: number;
  shuffle: boolean;
  repeat: string;
}

interface MobileModeState {
  mode: MobileMode;
  isMobileDevice: boolean;
  pcConnected: boolean;
  pcState: RemotePCPlayerState | null;
  setMode: (mode: MobileMode) => void;
  setIsMobileDevice: (isMobile: boolean) => void;
  setPcState: (state: RemotePCPlayerState | null) => void;
  sendPcCommand: (command: string, payload?: unknown) => Promise<void>;
}

function getBackendHost(): string {
  if (
    typeof window !== "undefined" &&
    window.location &&
    typeof window.location.hostname === "string" &&
    window.location.hostname &&
    window.location.hostname !== "localhost" &&
    window.location.hostname !== "127.0.0.1" &&
    !String(window.location.protocol || "").startsWith("tauri")
  ) {
    return window.location.hostname;
  }
  return "127.0.0.1";
}

function checkIsMobile(): boolean {
  if (typeof window === "undefined") return false;
  if ("__TAURI_INTERNALS__" in window) return false;
  const ua = navigator.userAgent || "";
  const isMobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(ua);
  const isLanHost = window.location.hostname !== "localhost" && window.location.hostname !== "127.0.0.1";
  const isNarrow = window.innerWidth <= 840;
  const isTouch = typeof navigator.maxTouchPoints === "number" && navigator.maxTouchPoints > 0;
  return isMobileUA || isLanHost || (isTouch && isNarrow) || isNarrow;
}

export const useMobileMode = create<MobileModeState>((set, get) => ({
  mode: "phone",
  isMobileDevice: checkIsMobile(),
  pcConnected: false,
  pcState: null,

  setMode: (mode) => {
    set({ mode });
    try {
      localStorage.setItem("dynamusic:mobile_mode", mode);
    } catch {
      /* ignore */
    }
  },

  setIsMobileDevice: (isMobileDevice) => set({ isMobileDevice }),

  setPcState: (pcState) => set({ pcState, pcConnected: Boolean(pcState?.track) }),

  sendPcCommand: async (command, payload) => {
    try {
      const host = getBackendHost();
      await fetch(`http://${host}:47822/player/command`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ command, payload }),
      });
    } catch {
      /* ignore */
    }
  },
}));

// Hydrate saved mode
if (typeof window !== "undefined") {
  try {
    const saved = localStorage.getItem("dynamusic:mobile_mode") as MobileMode | null;
    if (saved === "phone" || saved === "pc_remote") {
      useMobileMode.setState({ mode: saved });
    }
  } catch {
    /* ignore */
  }

  // Poll / SSE listen for live PC state only when running in browser (mobile client)
  if (!("__TAURI_INTERNALS__" in window)) {
    const pollPcState = () => {
      const host = getBackendHost();
      fetch(`http://${host}:47822/player/state`)
        .then((r) => r.json())
        .then((d) => {
          if (d.ok && d.state) {
            useMobileMode.getState().setPcState(d.state);
          }
        })
        .catch(() => undefined);
    };

    pollPcState();
    window.setInterval(pollPcState, 3000);

    const onResize = () => {
      useMobileMode.getState().setIsMobileDevice(checkIsMobile());
    };
    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onResize);
  }
}

