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
import { getBackendBaseUrl, getBackendHost } from "../stores/mobileMode";
import {
  fallbackMobileSearch,
  fallbackMobileSearchPage,
  fallbackMobileStreamUrl,
  fallbackMobileSuggestions,
} from "./mobileStandaloneFallback";
import {
  mobileAuthCancelGoogle,
  mobileAuthClearGuestProfile,
  mobileAuthContinueGuest,
  mobileAuthGetSession,
  mobileAuthSetDisplayName,
  mobileAuthSetUsername,
  mobileAuthSignIn,
  mobileAuthSignInGoogle,
  mobileAuthSignOut,
  mobileAuthSignUp,
  mobileAuthSkipUsername,
  mobileAuthUsernameAvailable,
  mobileNoteLocalWrite,
  mobileSyncBackupNow,
  mobileSyncNow,
  mobileSyncRestoreNow,
  mobileSyncStatus,
  readMobileStore,
  resetMobileDataStores,
  setMobileAuthEventSink,
  writeMobileStore,
} from "./mobileCloudAuth";

let lastLocalLibraryWriteAt = 0;

class RpcServerError extends Error {}

function backendUrl(): string {
  return getBackendBaseUrl();
}

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

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isUnpairedNativeMobile(): boolean {
  if (typeof window === "undefined" || isTauriRuntime()) return false;
  const host = window.location?.hostname || "";
  const cap = (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  const isCap = Boolean(cap?.isNativePlatform?.()) || window.location?.protocol === "capacitor:";
  return (isCap || host === "localhost") && getBackendHost() === "127.0.0.1";
}

async function rpcInvoke<T = any>(channel: string, ...args: unknown[]): Promise<T> {
  if (isUnpairedNativeMobile()) {
    throw new Error(`PC host not configured for ${channel}`);
  }
  const isRemoteHost = getBackendHost() !== "127.0.0.1";
  const isMediaFallbackChannel =
    channel === "music:search" ||
    channel === "music:searchPage" ||
    channel === "music:suggestions" ||
    channel === "music:stream";
  const isFastFallbackChannel =
    isRemoteHost &&
    (channel === "data:read" ||
      channel === "data:scope" ||
      channel === "auth:getSession" ||
      channel === "sync:status" ||
      channel === "updates:state" ||
      isMediaFallbackChannel);

  let lastError: unknown = null;
  const attempts = isFastFallbackChannel ? 1 : 2;

  for (let attempt = 0; attempt < attempts; attempt++) {
    const ctl = new AbortController();
    const timeoutMs = isMediaFallbackChannel && isRemoteHost ? 4000 : isFastFallbackChannel ? 1500 : 12_000;
    const timer = setTimeout(() => ctl.abort(), timeoutMs);
    try {
      const res = await fetch(`${backendUrl()}/rpc`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ channel, args: encodeBinaryInput(args) }),
        signal: ctl.signal,
      });
      if (!res.ok) {
        throw new Error(`RPC HTTP ${res.status} on ${channel}`);
      }
      const data = (await res.json()) as { ok: boolean; result?: unknown; error?: string };
      if (!data.ok) {
        throw new RpcServerError(data.error || `RPC error on ${channel}`);
      }
      return decodeBinaryOutput(data.result) as T;
    } catch (err) {
      lastError = err;
      if (attempt < attempts - 1) {
        await new Promise((r) => setTimeout(r, 200));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
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
  if (typeof EventSource === "undefined") return;
  let retryAttempt = 0;
  let retryTimer: number | null = null;
  let currentEs: EventSource | null = null;

  const connect = () => {
    if (retryTimer !== null) {
      window.clearTimeout(retryTimer);
      retryTimer = null;
    }
    if (currentEs) {
      try {
        currentEs.close();
      } catch {
        /* ignore */
      }
      currentEs = null;
    }
    if (isUnpairedNativeMobile()) {
      sseConnected = false;
      return;
    }
    try {
      const es = new EventSource(`${backendUrl()}/events`);
      currentEs = es;
      es.onopen = () => {
        sseConnected = true;
        retryAttempt = 0;
      };
      es.onmessage = (ev) => {
        try {
          if (ev.data === ": keepalive" || !ev.data) return;
          const parsed = JSON.parse(ev.data) as { channel?: string; args?: unknown[] };
          if (!parsed.channel) return;
          if (parsed.channel === "window:reload") {
            window.location.reload();
            return;
          }
          if (parsed.channel === "pc:player_state" && !isTauriRuntime()) {
            const state = parsed.args?.[0];
            if (state && typeof window !== "undefined") {
              void import("../stores/mobileMode").then((m) => m.useMobileMode.getState().setPcState(state as any));
            }
          }
          if (parsed.channel === "pc:player_command" && isTauriRuntime()) {
            const data = (parsed.args?.[0] ?? {}) as { commandId?: string; command?: string; payload?: unknown };
            if (data.command && typeof window !== "undefined") {
              window.postMessage(
                { type: "dynamusic:remote_command", commandId: data.commandId, command: data.command, payload: data.payload },
                "*"
              );
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
        sseConnected = false;
        es.close();
        if (currentEs === es) currentEs = null;
        const delay = Math.min(8000, Math.round(500 * Math.pow(1.75, retryAttempt)));
        retryAttempt += 1;
        retryTimer = window.setTimeout(connect, delay);
      };
    } catch {
      sseConnected = false;
      const delay = Math.min(8000, Math.round(500 * Math.pow(1.75, retryAttempt)));
      retryAttempt += 1;
      retryTimer = window.setTimeout(connect, delay);
    }
  };
  connect();
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible" && !sseConnected) {
      retryAttempt = 0;
      connect();
    }
  });
  window.addEventListener("online", () => {
    if (!sseConnected) {
      retryAttempt = 0;
      connect();
    }
  });
  window.addEventListener("dynamusic:backend-host-changed", () => {
    retryAttempt = 0;
    connect();
  });
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

  setMobileAuthEventSink(emitBackendEvent);
  connectEventStream();

  const withMobileCloudFallback = async <T>(rpcCall: () => Promise<T>, mobileCall: () => Promise<T> | T): Promise<T> => {
    if (isUnpairedNativeMobile()) {
      return await mobileCall();
    }
    try {
      return await rpcCall();
    } catch (err) {
      if (!isTauriRuntime() && !(err instanceof RpcServerError)) {
        return await mobileCall();
      }
      throw err;
    }
  };

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
      rpcInvoke("music:searchPage", query, filter).catch(() => fallbackMobileSearchPage(query, filter)),
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
    getStreamUrl: async (id: string, forceRotate = false, quality?: string, title?: string, artist?: string) => {
      if (!forceRotate) {
        const offlineUrl = await getOfflineVaultUrl(id);
        if (offlineUrl) return offlineUrl;
      }
      try {
        const rawUrl = await rpcInvoke<string>("music:stream", id, forceRotate, quality, title, artist);
        const host = getBackendHost();
        if (host !== "127.0.0.1" && typeof rawUrl === "string") {
          return rawUrl.replace("http://127.0.0.1:", `http://${host}:`);
        }
        return rawUrl;
      } catch {
        const fallback = await fallbackMobileStreamUrl(id, {
          forceRotate,
          quality,
          title,
          artist,
        });
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

    // Persistence (Node sidecar JSON files on desktop; isolated localStorage + Supabase sync on standalone mobile)
    readData: async (name: string) => {
      if (isUnpairedNativeMobile()) {
        return readMobileStore(name);
      }
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
          writeMobileStore(name, val, false);
          return val;
        }
      } catch {
        /* fallback to localStorage if sidecar is unreachable */
      }
      return readMobileStore(name);
    },
    writeData: async (name: string, data: unknown) => {
      if (name === "library") {
        lastLocalLibraryWriteAt = Date.now();
      }
      if (isUnpairedNativeMobile()) {
        writeMobileStore(name, data, true);
        return;
      }
      writeMobileStore(name, data, false);
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
        if (!isTauriRuntime()) {
          mobileNoteLocalWrite(name);
        } else if (name === "library") {
          try {
            localStorage.setItem("dynamusic:offline_dirty_library", JSON.stringify(data));
          } catch {
            /* ignore */
          }
        }
      }
    },
    resetData: async () => {
      resetMobileDataStores();
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
    authGetSession: () =>
      withMobileCloudFallback(
        async () => {
          const sess = await rpcInvoke("auth:getSession");
          if (sess && typeof sess === "object") {
            try {
              localStorage.setItem("dynamusic:store:__auth_session__", JSON.stringify(sess));
            } catch {
              /* ignore */
            }
          }
          return sess;
        },
        () => mobileAuthGetSession()
      ),
    authSignUp: (username: string, password: string, displayName: string) => {
      documentScopePromise = null;
      return withMobileCloudFallback(
        () => rpcInvoke("auth:signUp", username, password, displayName),
        () => mobileAuthSignUp(username, password, displayName)
      );
    },
    authSignIn: (username: string, password: string) => {
      documentScopePromise = null;
      return withMobileCloudFallback(
        () => rpcInvoke("auth:signIn", username, password),
        () => mobileAuthSignIn(username, password)
      );
    },
    authSignInGoogle: () => {
      documentScopePromise = null;
      return withMobileCloudFallback(
        () => rpcInvoke("auth:signInGoogle"),
        () => mobileAuthSignInGoogle()
      );
    },
    authCancelGoogle: () =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:cancelGoogle").catch(() => false),
        () => mobileAuthCancelGoogle()
      ),
    authContinueGuest: (displayName?: string) => {
      documentScopePromise = null;
      return withMobileCloudFallback(
        () => rpcInvoke("auth:continueGuest", displayName),
        () => mobileAuthContinueGuest(displayName)
      );
    },
    authClearGuestProfile: () =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:clearGuestProfile"),
        () => mobileAuthClearGuestProfile()
      ),
    authUsernameAvailable: (username: string) =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:usernameAvailable", username),
        () => mobileAuthUsernameAvailable(username)
      ),
    authSetUsername: (username: string, displayName?: string) =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:setUsername", username, displayName),
        () => mobileAuthSetUsername(username, displayName)
      ),
    authSkipUsername: (displayName?: string) =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:skipUsername", displayName),
        () => mobileAuthSkipUsername(displayName)
      ),
    authSetDisplayName: (name: string) =>
      withMobileCloudFallback(
        () => rpcInvoke("auth:setDisplayName", name),
        () => mobileAuthSetDisplayName(name)
      ),
    authSignOut: () => {
      documentScopePromise = null;
      return withMobileCloudFallback(
        () => rpcInvoke("auth:signOut"),
        () => mobileAuthSignOut()
      );
    },
    onAuthChanged: (
      cb: (info: { mode: string | null; userId: string | null; username: string | null; freshInstall?: boolean }) => void
    ): (() => void) => onBackendEvent("auth:changed", cb),
    syncStatus: () =>
      withMobileCloudFallback(
        () => rpcInvoke("sync:status"),
        () => mobileSyncStatus()
      ).catch(() => mobileSyncStatus()),
    syncNow: () =>
      withMobileCloudFallback(
        () => rpcInvoke("sync:now"),
        () => mobileSyncNow()
      ),
    syncBackupNow: () =>
      withMobileCloudFallback(
        () => rpcInvoke("sync:backupNow"),
        () => mobileSyncBackupNow()
      ),
    syncRestoreNow: () =>
      withMobileCloudFallback(
        () => rpcInvoke("sync:restoreNow"),
        () => mobileSyncRestoreNow()
      ),
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
