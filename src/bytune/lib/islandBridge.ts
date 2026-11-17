/**
 * Bridges ByTune's `usePlayer` store with the Dynamic Island overlay window
 * via Tauri IPC (`update_music_state` command and `dynamusic://command` events).
 */
import { shownTrack, usePlayer } from "../stores/player";
import { getPlaybackClock } from "./playbackClock";
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

function handlePlayerCommand(cmd: string, payload?: unknown): void {
  const p = usePlayer.getState();
  switch (cmd) {
    case "PLAY":
    case "play":
      p.setPlaying(true);
      break;
    case "PAUSE":
    case "pause":
      p.setPlaying(false);
      break;
    case "TOGGLE":
    case "toggle":
    case "toggle_play":
      p.toggle();
      break;
    case "NEXT":
    case "next":
      p.next(true);
      break;
    case "PREV":
    case "prev":
      p.prev();
      break;
    case "SEEK":
    case "seek":
      if (typeof payload === "number") p.seek(payload);
      break;
    case "VOLUME":
    case "set_volume":
      if (typeof payload === "number" && Number.isFinite(payload)) {
        p.setVolume(Math.max(0, Math.min(1, payload)));
      }
      break;
    case "toggle_mute":
      p.toggleMute();
      break;
    case "PLAY_NOW":
      if (payload && typeof payload === "object") {
        const pData = payload as { track?: any; tracks?: any[]; startIndex?: number; from?: string };
        if (Array.isArray(pData.tracks) && pData.tracks.length > 0) {
          p.playQueue(pData.tracks, pData.startIndex ?? 0, pData.from);
        } else if (pData.track) {
          p.playTrack(pData.track);
        } else {
          p.playTrack(payload as any);
        }
      }
      break;
    case "play_track":
      if (payload && typeof payload === "object") {
        p.playTrack(payload as any);
      }
      break;
    case "play_queue":
      if (payload && typeof payload === "object") {
        const q = payload as { tracks?: any[]; startIndex?: number; from?: string };
        if (Array.isArray(q.tracks) && q.tracks.length > 0) {
          p.playQueue(q.tracks, q.startIndex ?? 0, q.from);
        }
      }
      break;
    case "jump_to":
      if (typeof payload === "number") p.jumpTo(payload);
      break;
    case "ADD_PRIORITY_QUEUE":
    case "PLAY_NEXT":
    case "add_to_queue":
      if (payload && typeof payload === "object") {
        const data = payload as { tracks?: any; playNext?: boolean };
        const playNext = cmd === "PLAY_NEXT" ? true : Boolean(data.playNext);
        if ("tracks" in data && data.tracks) {
          p.addToQueue(data.tracks, playNext);
        } else {
          p.addToQueue(payload as any, playNext);
        }
      }
      break;
    case "REORDER_PRIORITY":
      if (payload && typeof payload === "object") {
        const m = payload as { from?: number; to?: number };
        if (typeof m.from === "number" && typeof m.to === "number") {
          p.reorderPriority(m.from, m.to);
        }
      }
      break;
    case "REMOVE_PRIORITY":
      if (typeof payload === "number") p.removePriority(payload);
      break;
    case "CLEAR_PRIORITY":
      p.clearPriority();
      break;
    case "REORDER_CONTEXT":
      if (payload && typeof payload === "object") {
        const m = payload as { from?: number; to?: number };
        if (typeof m.from === "number" && typeof m.to === "number") {
          p.reorderContext(m.from, m.to);
        }
      }
      break;
    case "REMOVE_CONTEXT":
      if (typeof payload === "number") p.removeContext(payload);
      break;
    case "move_upcoming":
      if (payload && typeof payload === "object") {
        const m = payload as { from?: number; to?: number };
        if (typeof m.from === "number" && typeof m.to === "number") {
          p.moveUpcoming(m.from, m.to);
        }
      }
      break;
    case "remove_at":
      if (typeof payload === "number") p.removeAt(payload);
      break;
    case "clear_upcoming":
      p.clearUpcoming();
      break;
    case "toggle_shuffle":
      p.toggleShuffle();
      break;
    case "cycle_repeat":
      p.cycleRepeat();
      break;
    case "close_stop":
      prepareDynamusicClose();
      break;
    case "reopen_home":
      resetDynamusicToHome();
      break;
  }
}
function slimTrack(qt: any) {
  return {
    id: qt.id,
    title: qt.title,
    artist: qt.artist,
    artistId: qt.artistId,
    album: qt.album,
    albumId: qt.albumId,
    duration: qt.duration,
    thumb: qt.thumb,
  };
}

export function initIslandBridge(): void {
  if (initialized || typeof window === "undefined") return;
  initialized = true;

  const seenCommandIds = new Set<string>();
  const dispatchRemoteCommand = (command: string, payload?: unknown, commandId?: string): void => {
    if (!command) return;
    if (commandId) {
      if (seenCommandIds.has(commandId)) return;
      seenCommandIds.add(commandId);
      if (seenCommandIds.size > 64) {
        const first = seenCommandIds.values().next().value;
        if (first) seenCommandIds.delete(first);
      }
    }
    handlePlayerCommand(command, payload);
  };

  let desktopWs: WebSocket | null = null;
  let lastTrackId = "";
  let lastPlaying: boolean | null = null;
  let lastSyncMs = 0;
  let cachedQueueInputs: {
    queue: unknown;
    index: number;
    priorityQueue: unknown;
    contextQueue: unknown;
    contextIndex: number;
    currentFromPriority: boolean;
    slimQueue: ReturnType<typeof slimTrack>[];
    upcomingCtx: ReturnType<typeof slimTrack>[];
    priorityQ: ReturnType<typeof slimTrack>[];
    qStart: number;
  } | null = null;

  const syncToIsland = (force = false) => {
    const s = usePlayer.getState();
    const track = shownTrack(s);
    const trackId = track?.id ?? "";
    const now = Date.now();
    const clock = getPlaybackClock();
    const livePos = clock.duration > 0 || clock.generation > 0 ? clock.position : s.position;
    const liveDur = (clock.duration > 0 ? clock.duration : s.duration) || track?.duration || 0;

    if (
      !force &&
      trackId === lastTrackId &&
      s.playing === lastPlaying &&
      now - lastSyncMs < (s.playing ? 250 : 1500)
    ) {
      return;
    }
    lastTrackId = trackId;
    lastPlaying = s.playing;
    lastSyncMs = now;

    // Also forward authoritative dual-queue state + serverTimestamp to sidecar for mobile WS sync
    if ("__TAURI_INTERNALS__" in window) {
      if (
        !cachedQueueInputs ||
        cachedQueueInputs.queue !== s.queue ||
        cachedQueueInputs.index !== s.index ||
        cachedQueueInputs.priorityQueue !== s.priorityQueue ||
        cachedQueueInputs.contextQueue !== s.contextQueue ||
        cachedQueueInputs.contextIndex !== s.contextIndex ||
        cachedQueueInputs.currentFromPriority !== s.currentFromPriority
      ) {
        const qStart = Math.max(0, s.index - 2);
        const qEnd = Math.min(s.queue.length, s.index + 40);
        const ctxStart = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
        cachedQueueInputs = {
          queue: s.queue,
          index: s.index,
          priorityQueue: s.priorityQueue,
          contextQueue: s.contextQueue,
          contextIndex: s.contextIndex,
          currentFromPriority: s.currentFromPriority,
          slimQueue: s.queue.slice(qStart, qEnd).map(slimTrack),
          upcomingCtx: s.contextQueue.slice(ctxStart, ctxStart + 40).map(slimTrack),
          priorityQ: s.priorityQueue.slice(0, 40).map(slimTrack),
          qStart,
        };
      }
      const { slimQueue, upcomingCtx, priorityQ, qStart } = cachedQueueInputs;
      const syncState = {
        track: track ? { ...slimTrack(track), duration: liveDur } : null,
        trackId: track?.id ?? null,
        playing: s.playing,
        isPlaying: s.playing,
        position: livePos,
        duration: liveDur,
        volume: s.volume,
        shuffle: s.shuffle,
        repeat: s.repeat,
        playingFrom: s.playingFrom,
        serverTimestamp: now,
        priorityQueue: priorityQ,
        contextQueue: upcomingCtx,
        contextIndex: 0,
        queue: slimQueue,
        index: s.index - qStart,
        queueOffset: qStart,
        autoplayCount: Math.max(0, Math.min(s.autoplayCount, s.queue.length - s.index - 1)),
      };

      let sentViaWs = false;
      if (desktopWs && desktopWs.readyState === WebSocket.OPEN) {
        try {
          desktopWs.send(JSON.stringify({ type: "sync_state", state: syncState }));
          sentViaWs = true;
        } catch {
          sentViaWs = false;
        }
      }
      if (!sentViaWs) {
        void fetch("http://127.0.0.1:47822/player/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ state: syncState }),
        }).catch(() => undefined);
      }
    }
  };

  usePlayer.subscribe((state, prevState) => {
    const track = shownTrack(state);
    const prevTrack = shownTrack(prevState);
    const force =
      track?.id !== prevTrack?.id ||
      state.playing !== prevState.playing ||
      state.seekNonce !== prevState.seekNonce ||
      state.shuffle !== prevState.shuffle ||
      state.repeat !== prevState.repeat ||
      state.index !== prevState.index ||
      state.queue !== prevState.queue ||
      state.priorityQueue !== prevState.priorityQueue ||
      state.contextQueue !== prevState.contextQueue ||
      state.volume !== prevState.volume;
    syncToIsland(force);
  });

  // Bidirectional Desktop WebSocket client + heartbeat + stale watchdog so sidecar never misses commands
  if ("__TAURI_INTERNALS__" in window) {
    let wsAttempt = 0;
    let wsRetryTimer: number | null = null;
    let staleTimer: number | null = null;
    const connectDesktopWs = () => {
      if (wsRetryTimer !== null) {
        window.clearTimeout(wsRetryTimer);
        wsRetryTimer = null;
      }
      if (staleTimer !== null) {
        window.clearTimeout(staleTimer);
        staleTimer = null;
      }
      try {
        const ws = new WebSocket("ws://127.0.0.1:47822/ws/remote?role=desktop");
        desktopWs = ws;
        const bumpStaleWatchdog = () => {
          if (staleTimer !== null) window.clearTimeout(staleTimer);
          staleTimer = window.setTimeout(() => {
            if (desktopWs === ws) {
              try {
                ws.close();
              } catch {
                /* ignore */
              }
            }
          }, 10_000);
        };
        ws.onopen = () => {
          wsAttempt = 0;
          bumpStaleWatchdog();
          syncToIsland(true);
        };
        ws.onmessage = (ev) => {
          bumpStaleWatchdog();
          try {
            const msg = JSON.parse(String(ev.data)) as {
              type?: string;
              ts?: number;
              commandId?: string;
              command?: string;
              payload?: unknown;
            };
            if (msg.type === "ping") {
              ws.send(JSON.stringify({ type: "pong", ts: msg.ts ?? Date.now() }));
              return;
            }
            if (msg.type === "request_sync") {
              syncToIsland(true);
              return;
            }
            if (msg.type === "command" && msg.command) {
              dispatchRemoteCommand(msg.command, msg.payload, msg.commandId);
            }
          } catch {
            /* ignore */
          }
        };
        const scheduleReconnect = () => {
          if (staleTimer !== null) {
            window.clearTimeout(staleTimer);
            staleTimer = null;
          }
          if (desktopWs === ws) desktopWs = null;
          const delay = Math.min(6000, Math.round(400 * Math.pow(1.6, wsAttempt)));
          wsAttempt += 1;
          wsRetryTimer = window.setTimeout(connectDesktopWs, delay);
        };
        ws.onclose = scheduleReconnect;
        ws.onerror = () => {
          try {
            ws.close();
          } catch {
            /* ignore */
          }
        };
      } catch {
        const delay = Math.min(6000, Math.round(400 * Math.pow(1.6, wsAttempt)));
        wsAttempt += 1;
        wsRetryTimer = window.setTimeout(connectDesktopWs, delay);
      }
    };
    connectDesktopWs();
    window.addEventListener("online", () => {
      wsAttempt = 0;
      if (!desktopWs || desktopWs.readyState !== WebSocket.OPEN) connectDesktopWs();
    });

    // Broadcast position updates only while actively playing so idle CPU stays at zero.
    let playingTickTimer: number | null = null;
    const syncPlayingTick = (playing: boolean) => {
      if (playing && playingTickTimer === null) {
        playingTickTimer = window.setInterval(() => {
          if (usePlayer.getState().playing) syncToIsland(true);
        }, 1500);
      } else if (!playing && playingTickTimer !== null) {
        window.clearInterval(playingTickTimer);
        playingTickTimer = null;
      }
    };
    syncPlayingTick(usePlayer.getState().playing);
    usePlayer.subscribe((state, prevState) => {
      if (state.playing !== prevState.playing) {
        syncPlayingTick(state.playing);
      }
    });
  }

  // Initial sync
  setTimeout(() => syncToIsland(true), 250);

  // Listen for commands dispatched from Mobile PC Remote Mode
  if (typeof window !== "undefined") {
    window.addEventListener("message", (ev) => {
      if (ev.data && typeof ev.data === "object" && ev.data.type === "dynamusic:remote_command") {
        dispatchRemoteCommand(ev.data.command, ev.data.payload, ev.data.commandId);
      }
    });
  }

  if ("__TAURI_INTERNALS__" in window) {
    void import("@tauri-apps/api/event")
      .then(({ listen }) =>
        listen<{ command: string; payload?: unknown } | string>("dynamusic://command", (event) => {
          const cmd =
            typeof event.payload === "string"
              ? event.payload
              : event.payload?.command ?? "";
          const payload = typeof event.payload === "object" ? (event.payload as any)?.payload : undefined;
          handlePlayerCommand(cmd, payload);
        })
      )
      .catch(() => undefined);
  }
}
