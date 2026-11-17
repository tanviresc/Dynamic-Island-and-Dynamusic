import { isCapacitorNative, isTauriDesktop } from "../stores/mobileMode";

/**
 * True only when running inside a mobile browser / standalone mobile PWA
 * (never triggers on Windows/macOS Tauri desktop or desktop browsers).
 */
export function isMobileWebRuntime(): boolean {
  if (typeof window === "undefined" || isTauriDesktop() || isCapacitorNative()) return false;
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";
  const coarse =
    typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches;
  return /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || coarse;
}

export type InterruptionOrigin = "native" | "web" | null;

export interface MobileInterruptionState {
  pausedByInterruption: boolean;
  origin: InterruptionOrigin;
  interruptedTrackId: string | null;
}

/**
 * Coordinates audio-focus interruptions (calls, Reels, voice messages) across both
 * Capacitor Android MediaPlaybackService and mobile browser `<audio>` elements so
 * temporary interruptions pause cleanly and automatically resume once focus returns.
 */
export class MobileInterruptionController {
  private pausedByInterruption = false;
  private origin: InterruptionOrigin = null;
  private interruptedTrackId: string | null = null;
  private suppressNextNativePause = false;
  private userOverrideAt = 0;

  getState(): MobileInterruptionState {
    return {
      pausedByInterruption: this.pausedByInterruption,
      origin: this.origin,
      interruptedTrackId: this.interruptedTrackId,
    };
  }

  onNativeFocusLost(trackId: string | null, applyUiPause: () => void): void {
    this.pausedByInterruption = true;
    this.origin = "native";
    this.interruptedTrackId = trackId;
    this.suppressNextNativePause = true;
    applyUiPause();
  }

  onNativeFocusGained(currentTrackId: string | null, applyUiResume: () => void): boolean {
    const shouldResume =
      this.pausedByInterruption &&
      this.origin === "native" &&
      (!this.interruptedTrackId || this.interruptedTrackId === currentTrackId);
    this.pausedByInterruption = false;
    this.origin = null;
    this.interruptedTrackId = null;
    this.suppressNextNativePause = false;
    if (shouldResume) {
      applyUiResume();
    }
    return shouldResume;
  }

  onWebFocusLost(trackId: string | null, applyUiPause: () => void): void {
    // Ignore transient focus events right after an intentional user pause.
    if (Date.now() - this.userOverrideAt < 350) return;
    this.pausedByInterruption = true;
    this.origin = "web";
    this.interruptedTrackId = trackId;
    applyUiPause();
  }

  tryResumeWebInterruption(currentTrackId: string | null, resumeAudio: () => void): boolean {
    if (!this.pausedByInterruption || this.origin !== "web") return false;
    if (this.interruptedTrackId && this.interruptedTrackId !== currentTrackId) return false;
    this.pausedByInterruption = false;
    this.origin = null;
    this.interruptedTrackId = null;
    resumeAudio();
    return true;
  }

  /**
   * Returns true once when a store transition (`playing: false`) was initiated by a native
   * `AUDIOFOCUS_LOSS_TRANSIENT` event so the engine does not overwrite native auto-resume state.
   */
  consumeSuppressNextNativePause(): boolean {
    if (!this.suppressNextNativePause) return false;
    this.suppressNextNativePause = false;
    return true;
  }

  clear(byUserAction = false): void {
    this.pausedByInterruption = false;
    this.origin = null;
    this.interruptedTrackId = null;
    this.suppressNextNativePause = false;
    if (byUserAction) {
      this.userOverrideAt = Date.now();
    }
  }
}

let keepaliveCtx: AudioContext | null = null;
let keepaliveOsc: OscillatorNode | null = null;
let keepaliveGain: GainNode | null = null;
let keepaliveWanted = false;
let focusWatchInstalled = false;
let resumeCallback: (() => void) | null = null;

function stopSilentOscillator(): void {
  try {
    keepaliveOsc?.stop();
    keepaliveOsc?.disconnect();
  } catch {
    /* ignore */
  }
  try {
    keepaliveGain?.disconnect();
  } catch {
    /* ignore */
  }
  keepaliveOsc = null;
  keepaliveGain = null;
}

/**
 * Maintains a lightweight near-zero-gain Web Audio signal exclusively on mobile browsers/PWAs
 * while playing or bridging tracks, keeping background media focus alive and surfacing
 * OS interruption (`suspended` / `interrupted` -> `running`) events for auto-resume.
 */
export function setMobileWebAudioKeepalive(active: boolean, onFocusRestored?: () => void): void {
  if (!isMobileWebRuntime() || typeof window === "undefined") return;
  if (onFocusRestored) resumeCallback = onFocusRestored;
  keepaliveWanted = active;

  const AudioCtx =
    window.AudioContext ||
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!AudioCtx) return;

  if (!focusWatchInstalled) {
    focusWatchInstalled = true;
    const handleVisibilityOrFocus = (): void => {
      if (document.visibilityState === "visible" || document.hasFocus()) {
        if (keepaliveCtx && keepaliveCtx.state === "suspended") {
          void keepaliveCtx.resume().then(() => {
            if (keepaliveCtx?.state === "running") resumeCallback?.();
          }).catch(() => undefined);
        } else {
          resumeCallback?.();
        }
      }
    };
    window.addEventListener("focus", handleVisibilityOrFocus);
    window.addEventListener("pageshow", handleVisibilityOrFocus);
    document.addEventListener("visibilitychange", handleVisibilityOrFocus);
  }

  if (active) {
    if (!keepaliveCtx) {
      try {
        keepaliveCtx = new AudioCtx({ latencyHint: "playback" });
        let wasInterrupted = false;
        keepaliveCtx.addEventListener("statechange", () => {
          const st = keepaliveCtx?.state as string | undefined;
          if (st === "interrupted" || st === "suspended") {
            if (keepaliveWanted) wasInterrupted = true;
          } else if (st === "running" && wasInterrupted) {
            wasInterrupted = false;
            resumeCallback?.();
          }
        });
      } catch {
        keepaliveCtx = null;
        return;
      }
    }
    if (keepaliveCtx.state === "suspended") {
      void keepaliveCtx.resume().catch(() => undefined);
    }
    if (!keepaliveOsc && keepaliveCtx.state !== "closed") {
      try {
        const gain = keepaliveCtx.createGain();
        gain.gain.value = 0.00001;
        const osc = keepaliveCtx.createOscillator();
        osc.frequency.value = 1;
        osc.connect(gain);
        gain.connect(keepaliveCtx.destination);
        osc.start();
        keepaliveOsc = osc;
        keepaliveGain = gain;
      } catch {
        stopSilentOscillator();
      }
    }
  } else {
    stopSilentOscillator();
    if (keepaliveCtx && keepaliveCtx.state === "running") {
      void keepaliveCtx.suspend().catch(() => undefined);
    }
  }
}
