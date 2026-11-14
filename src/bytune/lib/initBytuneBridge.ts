/**
 * Bridges `window.bytune` (`ByTuneApi`) in the renderer to the local Dynamusic Node sidecar
 * (`http://127.0.0.1:47822/rpc` & `/events`) and Tauri v2 window controls.
 */
import type { ByTuneApi } from "../../electron/preload";
import type {
  DownloadProgress,
  ImportedPlaylist,
  ImportSong,
  MoodPage,
  PodcastPage,
  PodcastShelf,
  RadioPage,
  RoomChange,
  RoomView,
  SearchSuggestion,
  SpotifyPlaylistInfo,
  SpotifyStatus,
  Track,
} from "../types";
import type { LocalTrack } from "../../electron/local-library";
import type { UpdateState } from "../../electron/updater";
import { getOfflineVaultUrl } from "./offlineAudioVault";
import {
  fallbackMobileSearch,
  fallbackMobileSearchPage,
  fallbackMobileStreamUrl,
  fallbackMobileSuggestions,
} from "./mobileStandaloneFallback";

let lastLocalLibraryWriteAt = 0;

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

const BACKEND_URL = `http://${getBackendHost()}:47822`;

function encodeBinaryInput(val: unknown): unknown {
  if (val == null) return val;
  if (val instanceof Uint8Array) {
    let bin = "";
    for (let i = 0; i < val.byteLength; i++) {
      bin += String.fromCharCode(val[i]);
    }
    return { __uint8__: btoa(bin) };
  }
  if (Array.isArray(val)) return val.map(encodeBinaryInput);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = encodeBinaryInput(v);
    }
    return out;
  }
  return val;
}

function decodeBinaryOutput(val: unknown): any {
  if (val == null) return val;
  if (typeof val === "object" && typeof (val as { __uint8__?: unknown }).__uint8__ === "string") {
    const b64 = (val as { __uint8__: string }).__uint8__;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) {
      out[i] = bin.charCodeAt(i);
    }
    return out;
  }
  if (Array.isArray(val)) return val.map(decodeBinaryOutput);
  if (typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = decodeBinaryOutput(v);
    }
    return out;
  }
  return val;
}

async function rpcInvoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  const isRemoteHost = getBackendHost() !== "127.0.0.1";
  const isFastFallbackChannel =
    isRemoteHost &&
    (channel === "data:read" ||
      channel === "data:scope" ||
      channel === "auth:getSession" ||
      channel === "sync:status" ||
      channel === "updates:state");
  const ctl = isFastFallbackChannel ? new AbortController() : undefined;
  const timer = ctl ? setTimeout(() => ctl.abort(), 1500) : undefined;
  try {
    const res = await fetch(`${BACKEND_URL}/rpc`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, args: encodeBinaryInput(args) }),
      signal: ctl?.signal,
    });
    if (!res.ok) {
      throw new Error(`RPC HTTP ${res.status} on ${channel}`);
    }
    const data = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
    if (!data.ok) {
      throw new Error(data.error || `RPC error on ${channel}`);
    }
    return decodeBinaryOutput(data.result) as T;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function rpcSend(channel: string, ...args: unknown[]): void {
  void rpcInvoke(channel, ...args).catch(() => undefined);
}

const eventListeners = new Map<string, Set<(...args: any[]) => void>>();

function onBackendEvent(channel: string, cb: (...args: any[]) => void): () => void {
  let set = eventListeners.get(channel);
  if (!set) {
    set = new Set();
    eventListeners.set(channel, set);
  }
  set.add(cb);
  return () => {
    set?.delete(cb);
  };
}

function emitBackendEvent(channel: string, ...args: any[]): void {
  const set = eventListeners.get(channel);
  if (!set) return;
  for (const fn of set) {
    try {
      fn(...args);
    } catch {
      /* ignore */
    }
  }
}

let sseConnected = false;
function connectEventStream(): void {
  if (sseConnected || typeof EventSource === "undefined") return;
  sseConnected = true;
  const connect = () => {
    try {
      const es = new EventSource(`${BACKEND_URL}/events`);
      es.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as { channel?: string; args?: unknown[] };
          if (!parsed.channel) return;
          if (parsed.channel === "window:reload") {
            window.location.reload();
            return;
          }
          if (parsed.channel === "pc:player_state") {
            const state = parsed.args?.[0];
            if (state && typeof window !== "undefined") {
              void import("../stores/mobileMode").then((m) => m.useMobileMode.getState().setPcState(state as any));
            }
          }
          if (parsed.channel === "pc:player_command") {
            const data = (parsed.args?.[0] ?? {}) as { command?: string; payload?: unknown };
            if (data.command && typeof window !== "undefined") {
              window.postMessage({ type: "dynamusic:remote_command", command: data.command, payload: data.payload }, "*");
            }
          }
          if (parsed.channel === "store:updated") {
            const info = (parsed.args?.[0] ?? {}) as { name?: string };
            if (info.name === "library" && Date.now() - lastLocalLibraryWriteAt > 600) {
              emitBackendEvent("sync:restored", { stores: ["library"], seq: Date.now() });
            }
          }
          const decodedArgs = decodeBinaryOutput(parsed.args ?? []) as any[];
          emitBackendEvent(parsed.channel, ...decodedArgs);
        } catch {
          /* ignore */
        }
      };
      es.onerror = () => {
        es.close();
        setTimeout(connect, 2500);
      };
    } catch {
      setTimeout(connect, 2500);
    }
  };
  connect();
}

async function getTauriWindow() {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { getCurrentWindow } = await import("@tauri-apps/api/window");
      return getCurrentWindow();
    }
  } catch {
    /* not in Tauri */
  }
  return null;
}

async function tauriWindowAction(action: string): Promise<boolean | null> {
  try {
    if ("__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<boolean>("dynamusic_window_action", { action });
    }
  } catch {
    /* fallback below */
  }
  return null;
}

let dragListenersInstalled = false;
function installAppDragHandlers(onToggleMaximize: () => void): void {
  if (dragListenersInstalled || typeof window === "undefined" || typeof window.addEventListener !== "function") return;
  dragListenersInstalled = true;

  const isInteractiveTarget = (el: HTMLElement | null): boolean => {
    if (!el) return true;
    return Boolean(
      el.closest(
        '.app-no-drag, button, input, textarea, select, a, [role="button"], [role="menuitem"], [role="listbox"], [contenteditable="true"]'
      )
    );
  };

  window.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.detail > 1) return;
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest(".app-drag") || isInteractiveTarget(target)) return;
    void tauriWindowAction("drag").then((handled) => {
      if (handled === null) {
        void getTauriWindow().then((w) => w?.startDragging());
      }
    });
  });

  window.addEventListener("dblclick", (e) => {
    const target = e.target as HTMLElement | null;
    if (!target || !target.closest(".app-drag") || isInteractiveTarget(target)) return;
    onToggleMaximize();
  });
}

export function initBytuneBridge(): void {
  if (typeof window === "undefined") return;
  if (window.bytune) return;

  connectEventStream();

  let documentScopePromise: Promise<string> | null = null;
  const documentScope = (): Promise<string> => {
    if (documentScopePromise === null) {
      documentScopePromise = rpcInvoke<string>("data:scope").catch(() => {
        documentScopePromise = null;
        return "guest:default";
      });
    }
    return documentScopePromise;
  };

  const api: ByTuneApi = {
    platform: "win32",
    versions: {
      app: "1.1.0",
      electron: "35.7.5",
      chrome: "134.0.0.0",
      node: "24.13.0",
    },

    // Music
    search: (query: string, light = false) =>
      rpcInvoke("music:search", query, light).catch(() => fallbackMobileSearch(query)),
    searchPage: (query: string, filter: string) =>
      rpcInvoke("music:searchPage", query, filter).catch(() => fallbackMobileSearchPage(query)),
    searchMore: (token: string, filter: string) => rpcInvoke("music:searchMore", token, filter),
    suggestions: (query: string): Promise<{ items: SearchSuggestion[] }> =>
      rpcInvoke<{ items: SearchSuggestion[] }>("music:suggestions", query).catch(() =>
        fallbackMobileSuggestions(query)
      ),
    getAlbum: (id: string) => rpcInvoke("music:album", id),
    getArtist: (id: string) => rpcInvoke("music:artist", id),
    getPlaylist: (id: string) => rpcInvoke("music:playlist", id),
    getPlaylistPage: (id: string) => rpcInvoke("music:playlistPage", id),
    getHome: () => rpcInvoke("music:home"),
    getRadio: (id: string, token?: string): Promise<RadioPage> =>
      rpcInvoke("music:radio", id, token),
    getCharts: () => rpcInvoke("music:charts"),
    getMoods: () => rpcInvoke("music:moods"),
    getMoodCovers: (browseId: string, params: string): Promise<string[]> =>
      rpcInvoke("music:moodCovers", browseId, params),
    getMoodPage: (browseId: string, params: string): Promise<MoodPage> =>
      rpcInvoke("music:moodPage", browseId, params),
    marketInfo: () => rpcInvoke("market:current"),
    getLyrics: (track: { id: string; title: string; artist: string; album?: string; duration?: number }) =>
      rpcInvoke("music:lyrics", track),
    enrichDurations: (ids: string[]) => rpcInvoke("music:enrich", ids),
    playbackEvent: (event: { type: string; track?: unknown; positionSec: number; playedSec: number; deltaMs: number }) =>
      rpcSend("playback:event", event),
    statsSummary: (period: string) => rpcInvoke("stats:summary", period),
    getStreamUrl: async (id: string, forceRotate = false, quality?: string) => {
      if (!forceRotate) {
        const offlineUrl = await getOfflineVaultUrl(id);
        if (offlineUrl) return offlineUrl;
      }
      try {
        const rawUrl = await rpcInvoke<string>("music:stream", id, forceRotate, quality);
        const host = getBackendHost();
        if (host !== "127.0.0.1" && typeof rawUrl === "string") {
          return rawUrl.replace("http://127.0.0.1:", `http://${host}:`);
        }
        return rawUrl;
      } catch {
        const fallback = await fallbackMobileStreamUrl(id);
        if (fallback) return fallback;
        throw new Error(`Unable to resolve stream for ${id}`);
      }
    },
    localLibrary: () => rpcInvoke("library:get"),
    scanLibrary: (filterNonMusic = true) => rpcInvoke("library:scan", filterNonMusic),
    setLibraryFolders: (folders: string[]) => rpcInvoke("library:setFolders", folders),
    addLibraryFolders: (paths: string[]) => rpcInvoke("library:addFolders", paths),
    renameLibraryFolder: (folderPath: string, displayName: string) =>
      rpcInvoke("library:renameFolder", folderPath, displayName),
    removeLibraryFolder: (folderPath: string) =>
      rpcInvoke("library:removeFolder", folderPath),
    libraryFolderStatuses: () => rpcInvoke("library:folderStatuses"),
    localTrackUrl: async (id: string) => {
      const rawUrl = await rpcInvoke<string | null>("library:trackurl", id);
      const host = getBackendHost();
      if (host !== "127.0.0.1" && typeof rawUrl === "string") {
        return rawUrl.replace("http://127.0.0.1:", `http://${host}:`);
      }
      return rawUrl;
    },
    localArtBytes: (thumb: string) => rpcInvoke("library:artbytes", thumb),
    remoteArtBytes: (url: string) => rpcInvoke("art:remoteBytes", url),
    getCanvas: (q: { title: string; artist: string; album?: string }) =>
      rpcInvoke("canvas:get", q),

    // Updates
    updateState: (): Promise<UpdateState> =>
      rpcInvoke<UpdateState>("updates:state").catch(() => ({
        status: "current" as const,
        current: "1.1.0",
        installs: false,
      })),
    checkForUpdates: (): Promise<void> => rpcInvoke("updates:check").catch(() => undefined),
    installUpdate: (): Promise<void> => rpcInvoke("updates:install").catch(() => undefined),
    restartToUpdate: (): Promise<void> => rpcInvoke("updates:restart").catch(() => undefined),
    onUpdateState: (cb: (state: UpdateState) => void): (() => void) =>
      onBackendEvent("updates:changed", cb),

    // Window controls (bridged to Tauri Rust command + window API)
    windowMinimize: () => {
      void tauriWindowAction("minimize").then((res) => {
        if (res === null) {
          void getTauriWindow().then((w) => (w ? w.minimize() : rpcSend("window:minimize")));
        }
      });
    },
    windowMaximizeToggle: () => {
      void tauriWindowAction("maximize_toggle").then(async (res) => {
        if (typeof res === "boolean") {
          emitBackendEvent("window:maximized", res);
          return;
        }
        const w = await getTauriWindow();
        if (w) {
          const max = await w.isMaximized();
          if (max) await w.unmaximize();
          else await w.maximize();
          emitBackendEvent("window:maximized", !max);
        } else {
          rpcSend("window:maximizeToggle");
        }
      });
    },
    windowClose: () => {
      void import("./islandBridge")
        .then((m) => m.prepareDynamusicClose())
        .catch(() => undefined);
      void tauriWindowAction("close").then((res) => {
        if (res === null) {
          void getTauriWindow().then((w) => (w ? w.hide() : rpcSend("window:close")));
        }
      });
    },
    isMaximized: async () => {
      const res = await tauriWindowAction("is_maximized");
      if (typeof res === "boolean") return res;
      const w = await getTauriWindow();
      if (w) return w.isMaximized();
      return rpcInvoke<boolean>("window:isMaximized").catch(() => false);
    },
    introDone: () => rpcSend("window:introDone"),
    naturalScrolling: (): Promise<boolean | null> =>
      rpcInvoke<boolean | null>("input:naturalScrolling").catch(() => null),
    setOverlayChrome: (visible: boolean) =>
      rpcInvoke<"ok" | "failed" | "unsupported">("window:setOverlayChrome", visible).catch(() => "ok" as const),
    setFullScreen: async (fs: boolean) => {
      const res = await tauriWindowAction(fs ? "fullscreen_on" : "fullscreen_off");
      if (typeof res === "boolean") {
        emitBackendEvent("window:fullscreen", fs);
        return true;
      }
      const w = await getTauriWindow();
      if (w) {
        await w.setFullscreen(fs);
        emitBackendEvent("window:fullscreen", fs);
        return true;
      }
      return rpcInvoke<boolean>("window:setFullScreen", fs).catch(() => true);
    },
    onMaximizeChange: (cb: (maximized: boolean) => void): (() => void) =>
      onBackendEvent("window:maximized", cb),
    onFullScreenChange: (cb: (fullscreen: boolean) => void): (() => void) =>
      onBackendEvent("window:fullscreen", cb),

    // PiP miniplayer
    pipToggle: () => rpcInvoke("pip:toggle").catch(() => false),
    pipIsOpen: () => rpcInvoke("pip:isOpen").catch(() => false),
    pipClose: () => rpcSend("pip:close"),
    pipMinimize: () => rpcSend("pip:minimize"),
    pipSetCompact: (on: boolean) => rpcSend("pip:compact", on === true),
    pipShowMain: () => rpcSend("pip:show-main"),
    pipSendState: (snapshot: unknown) => rpcSend("pip:state", snapshot),
    pipSendCommand: (command: unknown) => rpcSend("pip:command", command),
    onPipState: (cb: (snapshot: unknown) => void): (() => void) => onBackendEvent("pip:state", cb),
    onPipCommand: (cb: (command: unknown) => void): (() => void) => onBackendEvent("pip:command", cb),
    onPipOpenChange: (cb: (open: boolean) => void): (() => void) => onBackendEvent("pip:open-changed", cb),
    onPipNeedState: (cb: () => void): (() => void) => onBackendEvent("pip:need-state", cb),
    onPipCursorInside: (cb: (inside: boolean) => void): (() => void) => onBackendEvent("pip:cursor-inside", cb),

    // Persistence (Node sidecar JSON files in userData, with localStorage mirror fallback)
    readData: async (name: string) => {
      try {
        const scope = await documentScope();
        let val = (await rpcInvoke("data:read", name, scope)) as any;
        if (name === "library") {
          try {
            const dirtyRaw = localStorage.getItem("dynamusic:offline_dirty_library");
            if (dirtyRaw) {
              const dirty = JSON.parse(dirtyRaw);
              const dirtyLiked: Track[] = Array.isArray(dirty?.state?.liked) ? dirty.state.liked : [];
              const serverLiked: Track[] = Array.isArray(val?.state?.liked) ? val.state.liked : [];
              if (dirtyLiked.length > 0) {
                const seen = new Set(serverLiked.map((t) => t.id));
                const added = dirtyLiked.filter((t) => t?.id && !seen.has(t.id));
                if (added.length > 0) {
                  val = {
                    ...(val || { version: 1 }),
                    state: {
                      ...(val?.state || {}),
                      liked: [...added, ...serverLiked],
                    },
                  };
                  lastLocalLibraryWriteAt = Date.now();
                  await rpcInvoke("data:write", "library", val, scope).catch(() => undefined);
                }
              }
              localStorage.removeItem("dynamusic:offline_dirty_library");
            }
          } catch {
            /* ignore merge error */
          }
        }
        if (val !== null && val !== undefined) {
          try {
            localStorage.setItem(`dynamusic:store:${name}`, JSON.stringify(val));
          } catch {
            /* ignore quota */
          }
          return val;
        }
      } catch {
        /* fallback to localStorage if sidecar is unreachable */
      }
      try {
        const raw = localStorage.getItem(`dynamusic:store:${name}`);
        return raw ? JSON.parse(raw) : null;
      } catch {
        return null;
      }
    },
    writeData: async (name: string, data: unknown) => {
      if (name === "library") {
        lastLocalLibraryWriteAt = Date.now();
      }
      try {
        localStorage.setItem(`dynamusic:store:${name}`, JSON.stringify(data));
      } catch {
        /* ignore quota */
      }
      try {
        const scope = await documentScope();
        await rpcInvoke("data:write", name, data, scope);
        if (name === "library") {
          try {
            localStorage.removeItem("dynamusic:offline_dirty_library");
          } catch {
            /* ignore */
          }
        }
      } catch {
        /* saved in localStorage mirror; mark dirty if library changed while offline */
        if (name === "library") {
          try {
            localStorage.setItem("dynamusic:offline_dirty_library", JSON.stringify(data));
          } catch {
            /* ignore */
          }
        }
      }
    },
    resetData: async () => {
      try {
        for (const k of Object.keys(localStorage)) {
          if (k.startsWith("dynamusic:store:")) localStorage.removeItem(k);
        }
      } catch {
        /* ignore */
      }
      documentScopePromise = null;
      await rpcInvoke("app:resetData").catch(() => undefined);
    },

    // Backup & Playlist import/export
    backupExport: () => rpcInvoke("backup:export"),
    playlistExport: (name: string, m3u8: string, json: string): Promise<{ path?: string; cancelled?: boolean }> =>
      rpcInvoke("playlist:export", name, m3u8, json),
    playlistImport: (): Promise<{ name: string; ext: string; text: string } | null> =>
      rpcInvoke("playlist:import"),

    // Spotify
    spotifyPublicPlaylist: (link: string): Promise<ImportedPlaylist> =>
      rpcInvoke("spotify:publicPlaylist", link),
    spotifyStatus: (): Promise<SpotifyStatus> =>
      rpcInvoke<SpotifyStatus>("spotify:status").catch(() => ({ connected: false })),
    spotifyConnect: (): Promise<SpotifyStatus> => rpcInvoke("spotify:connect"),
    spotifyDisconnect: (): Promise<SpotifyStatus> => rpcInvoke("spotify:disconnect"),
    spotifyPlaylists: (): Promise<SpotifyPlaylistInfo[]> => rpcInvoke("spotify:playlists"),
    spotifyPlaylist: (id: string): Promise<ImportedPlaylist> => rpcInvoke("spotify:playlist", id),
    matchSong: (song: ImportSong, prefer: string): Promise<Track | null> =>
      rpcInvoke("match:song", song, prefer),

    // Rooms
    roomCurrent: (): Promise<RoomView> => rpcInvoke("room:current"),
    roomCreate: (): Promise<RoomView> => rpcInvoke("room:create"),
    roomJoin: (code: string): Promise<RoomView> => rpcInvoke("room:join", code),
    roomLeave: (): Promise<RoomView> => rpcInvoke("room:leave"),
    roomUpdate: (change: RoomChange): Promise<RoomView> => rpcInvoke("room:update", change),
    roomHostOnly: (on: boolean): Promise<RoomView> => rpcInvoke("room:hostOnly", on),
    roomMakeHost: (userId: string): Promise<RoomView> => rpcInvoke("room:makeHost", userId),
    roomRemove: (userId: string): Promise<RoomView> => rpcInvoke("room:remove", userId),
    roomStash: (snapshot: unknown): Promise<void> => rpcInvoke("room:stash", snapshot),
    roomUnstash: (): Promise<unknown> => rpcInvoke("room:unstash"),
    roomTakeInvite: (): Promise<string | null> => rpcInvoke("room:takeInvite").catch(() => null),
    onRoomState: (cb: (view: RoomView) => void): (() => void) => onBackendEvent("room:state", cb),
    onRoomInvite: (cb: () => void): (() => void) => onBackendEvent("room:invite", cb),

    // Replay image export
    saveReplayImage: (png: Uint8Array, name: string): Promise<{ path?: string; cancelled?: boolean }> =>
      rpcInvoke("replay:saveImage", png, name),
    copyReplayImage: (png: Uint8Array): Promise<boolean> =>
      rpcInvoke("replay:copyImage", png),
    localGainDb: (id: string): Promise<number | null> =>
      rpcInvoke<number | null>("local:gainDb", id).catch(() => null),
    getPodcast: (id: string): Promise<PodcastPage> => rpcInvoke("music:podcast", id),
    getPodcasts: (): Promise<PodcastShelf[]> => rpcInvoke("music:podcasts"),
    backupImport: () => rpcInvoke("backup:import"),

    // Accounts (Supabase) + cloud sync
    authGetSession: async () => {
      try {
        const sess = await rpcInvoke("auth:getSession");
        if (sess && typeof sess === "object") {
          try {
            localStorage.setItem("dynamusic:store:__auth_session__", JSON.stringify(sess));
          } catch {
            /* ignore */
          }
        }
        return sess;
      } catch {
        try {
          const cached = localStorage.getItem("dynamusic:store:__auth_session__");
          if (cached) return JSON.parse(cached);
        } catch {
          /* ignore */
        }
        return {
          mode: "guest" as const,
          userId: null,
          username: null,
          displayName: "Listener",
          freshInstall: false,
          needsUsername: false,
        };
      }
    },
    authSignUp: async (username: string, password: string, displayName: string) => {
      documentScopePromise = null;
      return rpcInvoke("auth:signUp", username, password, displayName);
    },
    authSignIn: async (username: string, password: string) => {
      documentScopePromise = null;
      return rpcInvoke("auth:signIn", username, password);
    },
    authSignInGoogle: async () => {
      documentScopePromise = null;
      return rpcInvoke("auth:signInGoogle");
    },
    authCancelGoogle: () => rpcInvoke("auth:cancelGoogle").catch(() => false),
    authContinueGuest: async (displayName?: string) => {
      documentScopePromise = null;
      return rpcInvoke("auth:continueGuest", displayName);
    },
    authClearGuestProfile: () => rpcInvoke("auth:clearGuestProfile"),
    authUsernameAvailable: (username: string) => rpcInvoke("auth:usernameAvailable", username),
    authSetUsername: (username: string, displayName?: string) =>
      rpcInvoke("auth:setUsername", username, displayName),
    authSkipUsername: (displayName?: string) => rpcInvoke("auth:skipUsername", displayName),
    authSetDisplayName: (name: string) => rpcInvoke("auth:setDisplayName", name),
    authSignOut: async () => {
      documentScopePromise = null;
      return rpcInvoke("auth:signOut");
    },
    onAuthChanged: (
      cb: (info: { mode: string | null; userId: string | null; username: string | null; freshInstall?: boolean }) => void
    ): (() => void) => onBackendEvent("auth:changed", cb),
    syncStatus: () =>
      rpcInvoke("sync:status").catch(() => ({
        configured: true,
        signedIn: false,
        syncing: false,
        lastSyncedAt: null,
        error: null,
      })),
    syncNow: () => rpcInvoke("sync:now"),
    syncBackupNow: () => rpcInvoke("sync:backupNow"),
    syncRestoreNow: () => rpcInvoke("sync:restoreNow"),
    onSyncRestored: (cb: (info: { stores: string[]; seq: number }) => void): (() => void) =>
      onBackendEvent("sync:restored", cb),

    // Menu & Media Controls
    onMenuCommand: (cb: (command: string) => void): (() => void) => onBackendEvent("menu:command", cb),
    menuPushState: (state: { playing: boolean; shuffle: boolean; repeat: "off" | "all" | "one" }) =>
      rpcSend("menu:push-state", state),
    mediaSetMetadata: (track: { title: string; artist: string; album: string; thumb: string } | null) =>
      rpcSend("media:metadata", track),
    mediaSetPosition: (position: number, duration: number) =>
      rpcSend("media:position", position, duration),
    onMediaAction: (cb: (a: { action: string; seekTime?: number }) => void): (() => void) =>
      onBackendEvent("media:action", cb),

    // Opened audio files
    takeOpenedFiles: (): Promise<{ tracks: LocalTrack[]; unplayable: string[] }[]> =>
      rpcInvoke("files:take").catch(() => []),
    onFilesOpened: (cb: () => void): (() => void) => onBackendEvent("files:opened", cb),
    openedFiles: (): Promise<LocalTrack[]> => rpcInvoke("library:opened").catch(() => []),
    forgetOpenedFile: (id: string): Promise<LocalTrack[]> =>
      rpcInvoke("library:forgetOpened", id).catch(() => []),

    // Filesystem helpers
    defaultDownloadDir: () => rpcInvoke("app:defaultDownloadDir").catch(() => ""),
    pickFolder: () => rpcInvoke("app:pickFolder"),
    revealPath: (p: string) => rpcInvoke("app:revealPath", p),
    openPath: (p: string) => rpcInvoke("app:openPath", p),

    // Downloads
    startDownload: (track: Track, dir?: string, quality?: string, exportCompat?: boolean) =>
      rpcInvoke("download:start", track, dir, quality, exportCompat),
    cancelDownload: (id: string) => rpcInvoke("download:cancel", id),
    downloadQueue: () => rpcInvoke("download:queue").catch(() => []),
    onDownloadEvent: (
      cb: (e: { type: string; id: string; downloaded?: number; total?: number; path?: string; reason?: string }) => void
    ): (() => void) => onBackendEvent("download:event", cb),
    onDownloadProgress: (cb: (p: DownloadProgress) => void): (() => void) =>
      onBackendEvent("download:progress", cb),
  };

  window.bytune = api;
  installAppDragHandlers(() => api.windowMaximizeToggle());
}
