/**
 * Bridges ByTune's `usePlayer` store with the Dynamic Island overlay window
 * via Tauri IPC (`update_music_state` command and `dynamusic://command` events).
 */
import { shownTrack, usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { flushCoalescedStorage } from "./persist";

let initialized = false;

export function resetDynamusicToHome(): void {
  useUI.setState({
    view: { name: "home" },
    navPast: [],
    navFuture: [],
    pendingScroll: 0,
    nowPlayingOpen: false,
    lyricsCenter: false,
    rightPanel: "details",
    contextMenu: null,
    dialog: null,
    playlistPicker: null,
  });
  if (typeof document !== "undefined") {
    const scroller = document.getElementById("view-scroll");
    if (scroller) scroller.scrollTop = 0;
  }
}

export function prepareDynamusicClose(): void {
  const p = usePlayer.getState();
  if (p.playing) {
    p.setPlaying(false);
  }
  resetDynamusicToHome();
  flushCoalescedStorage();
}

export function initIslandBridge(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  let lastTrackId = "";
  let lastPlaying: boolean | null = null;
  let lastSyncMs = 0;

  const syncToIsland = (force = false) => {
    const s = usePlayer.getState();
    const track = shownTrack(s);
    const trackId = track?.id ?? "";
    const now = Date.now();

    if (!force && trackId === lastTrackId && s.playing === lastPlaying && now - lastSyncMs < 1500) {
      return;
    }
    lastTrackId = trackId;
    lastPlaying = s.playing;
    lastSyncMs = now;

    if (!("__TAURI_INTERNALS__" in window)) return;

    void import("@tauri-apps/api/core")
      .then(({ invoke }) =>
        invoke("update_music_state", {
          state: track
            ? {
                title: track.title ?? "",
                artist: track.artist ?? "",
                album: track.album ?? null,
                albumArt: track.thumb ?? null,
                isPlaying: s.playing,
                positionMs: Math.round((s.position || 0) * 1000),
                durationMs: Math.round((s.duration || track.duration || 0) * 1000),
                volume: s.volume,
                lyricsCurrentLine: null,
              }
            : null,
        })
      )
      .catch(() => undefined);
  };

  usePlayer.subscribe((state, prevState) => {
    const track = shownTrack(state);
    const prevTrack = shownTrack(prevState);
    const force = track?.id !== prevTrack?.id || state.playing !== prevState.playing;
    syncToIsland(force);
  });

  // Initial sync
  setTimeout(() => syncToIsland(true), 250);

  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ command: string; payload?: unknown } | string>("dynamusic://command", (event) => {
          const cmd =
            typeof event.payload === "string"
              ? event.payload
              : event.payload?.command ?? "";
          const p = usePlayer.getState();
          switch (cmd) {
            case "play":
              p.setPlaying(true);
              break;
            case "pause":
              p.setPlaying(false);
              break;
            case "toggle":
            case "toggle_play":
              p.toggle();
              break;
            case "next":
              p.next(true);
              break;
            case "prev":
              p.prev();
              break;
            case "close_stop":
              prepareDynamusicClose();
              break;
            case "reopen_home":
              resetDynamusicToHome();
              break;
          }
        })
      )
      .catch(() => undefined);
  }
}
