/**
 * In-App Offline Audio Vault (IndexedDB).
 *
 * Stores full audio tracks directly inside the app's internal IndexedDB storage
 * (`dynamusic-offline-vault`) so Liked Songs (and any offline-saved tracks) play
 * 100% offline with zero network connection—both on Desktop and on Phone (PWA / Mobile).
 */
import type { Track } from "../types";
import { getBackendBaseUrl, getBackendHost, isCapacitorNative, isTauriDesktop } from "../stores/mobileMode";
import { upgradeArtwork } from "./artwork";
import { getCachedLyrics, saveCachedLyrics } from "./lyricsCache";
import { fallbackMobileStreamUrl } from "./mobileStandaloneFallback";

function getVaultBaseUrl(): string {
  return getBackendBaseUrl();
}

function isUnpairedPhone(): boolean {
  return !isTauriDesktop() && isCapacitorNative() && getBackendHost() === "127.0.0.1";
}

let vaultServerUnreachableUntil = 0;

export function base64ToBlob(base64: string, mime = "audio/mp4"): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: mime });
}

async function fetchUrlAsBlob(url: string): Promise<Blob | null> {
  if (!url || url.startsWith("blob:")) return null;
  // 1. Standard browser/WebView fetch (works for CORS-enabled Piped / local proxy)
  try {
    const ctl = new AbortController();
    let timer = setTimeout(() => ctl.abort(), 15_000);
    const res = await fetch(url, { signal: ctl.signal });
    clearTimeout(timer);
    if (res.ok) {
      timer = setTimeout(() => ctl.abort(), 90_000);
      try {
        const candidate = await res.blob();
        if (candidate && candidate.size >= 4096) return candidate;
      } finally {
        clearTimeout(timer);
      }
    }
  } catch {
    /* fall through to native Android downloader if available */
  }

  // 2. Native Android downloader (bypasses WebView CORS on upstream audio CDNs)
  if (typeof window !== "undefined") {
    try {
      const cap = (window as unknown as {
        Capacitor?: {
          Plugins?: {
            MediaKeepalive?: {
              fetchAudioBase64?: (opts: { url: string }) => Promise<{ base64?: string; mime?: string; size?: number }>;
            };
          };
        };
      }).Capacitor;
      const fetcher = cap?.Plugins?.MediaKeepalive?.fetchAudioBase64;
      if (fetcher) {
        const res = await fetcher({ url });
        if (res?.base64) {
          const blob = base64ToBlob(res.base64, res.mime || "audio/mp4");
          if (blob && blob.size >= 4096) return blob;
        }
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

const DB_NAME = "dynamusic-offline-vault";
const STORE_NAME = "tracks";
const ARTWORK_STORE = "artwork";
const DB_VERSION = 2;
const maxMemoryBlobUrls = () => (isCapacitorNative() ? 8 : 32);
const maxMemoryArtworkUrls = () => (isCapacitorNative() ? 32 : 96);
const NATIVE_VAULT_IDS_KEY = "dynamusic:native_offline_ids";

interface NativeOfflineFilePlugin {
  getOfflineFileUri?: (opts: { id: string }) => Promise<{ exists?: boolean; fileUri?: string; mime?: string }>;
  saveOfflineFile?: (opts: {
    id: string;
    url?: string;
    base64?: string;
    mime?: string;
  }) => Promise<{ fileUri?: string; mime?: string; size?: number }>;
  deleteOfflineFile?: (opts: { id: string }) => Promise<void>;
  saveOfflineArt?: (opts: { id: string; url: string }) => Promise<{ fileUri?: string; size?: number }>;
  getOfflineArtDataUrl?: (opts: { id: string }) => Promise<{ exists?: boolean; dataUrl?: string }>;
  deleteOfflineArt?: (opts: { id: string }) => Promise<void>;
}

function getNativeOfflinePlugin(): NativeOfflineFilePlugin | null {
  if (!isCapacitorNative() || typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: { MediaKeepalive?: NativeOfflineFilePlugin } } }).Capacitor;
  return cap?.Plugins?.MediaKeepalive ?? null;
}

function loadNativeSavedIds(): void {
  try {
    const raw = localStorage.getItem(NATIVE_VAULT_IDS_KEY);
    if (!raw) return;
    const ids = JSON.parse(raw) as unknown;
    if (Array.isArray(ids)) {
      for (const id of ids) {
        if (typeof id === "string" && id) savedIds.add(id);
      }
    }
  } catch {
    /* ignore */
  }
}

function persistNativeSavedId(id: string, present: boolean): void {
  try {
    const raw = localStorage.getItem(NATIVE_VAULT_IDS_KEY);
    const list: string[] = raw ? (JSON.parse(raw) as string[]) : [];
    const set = new Set(Array.isArray(list) ? list : []);
    if (present) set.add(id);
    else set.delete(id);
    localStorage.setItem(NATIVE_VAULT_IDS_KEY, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

interface StoredTrackAudio {
  id: string;
  blob: Blob;
  mime: string;
  savedAt: number;
  title?: string;
  artist?: string;
}

interface StoredArtworkRecord {
  key: string;
  trackId?: string;
  rawUrl?: string;
  blob: Blob;
  mime: string;
  savedAt: number;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryBlobUrls = new Map<string, string>();
const pinnedTrackIds = new Set<string>();
const savedIds = new Set<string>();
const inFlightSaves = new Map<string, Promise<boolean>>();
const vaultListeners = new Set<() => void>();

const artworkMemoryUrls = new Map<string, string>();
const savedArtworkKeys = new Set<string>();
const inFlightArtSaves = new Map<string, Promise<boolean>>();
const inFlightArtReads = new Map<string, Promise<string | null>>();
const artworkListeners = new Set<() => void>();

/**
 * Pin track IDs whose blob URLs are actively loaded/playing in audio decks
 * so the LRU cache never revokes a URL mid-playback.
 */
export function setActiveOfflineTrackIds(ids: (string | null | undefined)[]): void {
  pinnedTrackIds.clear();
  for (const id of ids) {
    if (id) pinnedTrackIds.add(id);
  }
}

export function cacheBlobUrlLru(trackId: string, url: string): void {
  if (memoryBlobUrls.has(trackId)) {
    memoryBlobUrls.delete(trackId);
  }
  memoryBlobUrls.set(trackId, url);
  const cap = maxMemoryBlobUrls();
  if (memoryBlobUrls.size <= cap) return;
  for (const candidateId of Array.from(memoryBlobUrls.keys())) {
    if (memoryBlobUrls.size <= cap) break;
    if (candidateId === trackId || pinnedTrackIds.has(candidateId)) continue;
    const oldUrl = memoryBlobUrls.get(candidateId);
    memoryBlobUrls.delete(candidateId);
    if (oldUrl) {
      try {
        URL.revokeObjectURL(oldUrl);
      } catch {
        /* ignore */
      }
    }
  }
}

function notifyArtworkListeners(): void {
  for (const fn of artworkListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeOfflineArtwork(cb: () => void): () => void {
  artworkListeners.add(cb);
  return () => artworkListeners.delete(cb);
}

function buildArtworkKeys(url?: string | null, trackId?: string | null): string[] {
  const keys: string[] = [];
  const trimmedId = trackId?.trim();
  if (trimmedId) keys.push(`id:${trimmedId}`);
  const trimmedUrl = url?.trim();
  if (trimmedUrl && !trimmedUrl.startsWith("blob:") && !trimmedUrl.startsWith("data:")) {
    const upgraded = upgradeArtwork(trimmedUrl, 600);
    if (upgraded && !keys.includes(upgraded)) keys.push(upgraded);
    if (!keys.includes(trimmedUrl)) keys.push(trimmedUrl);
  }
  return keys;
}

function cacheArtworkUrlLru(keys: string[], objectOrDataUrl: string): void {
  for (const key of keys) {
    if (artworkMemoryUrls.has(key)) artworkMemoryUrls.delete(key);
    artworkMemoryUrls.set(key, objectOrDataUrl);
  }
  const cap = maxMemoryArtworkUrls();
  if (artworkMemoryUrls.size <= cap) return;
  const activeUrls = new Set(artworkMemoryUrls.values());
  for (const candidateKey of Array.from(artworkMemoryUrls.keys())) {
    if (artworkMemoryUrls.size <= cap) break;
    if (keys.includes(candidateKey)) continue;
    const evictedUrl = artworkMemoryUrls.get(candidateKey);
    artworkMemoryUrls.delete(candidateKey);
    if (evictedUrl && evictedUrl.startsWith("blob:") && !Array.from(artworkMemoryUrls.values()).includes(evictedUrl)) {
      try {
        URL.revokeObjectURL(evictedUrl);
      } catch {
        /* ignore */
      }
    }
    void activeUrls;
  }
}

export function peekOfflineArtworkUrl(url?: string | null, trackId?: string | null): string | null {
  for (const key of buildArtworkKeys(url, trackId)) {
    const hit = artworkMemoryUrls.get(key);
    if (hit) return hit;
  }
  return null;
}

export async function resolveOfflineArtworkUrl(
  url?: string | null,
  trackId?: string | null
): Promise<string | null> {
  const keys = buildArtworkKeys(url, trackId);
  if (keys.length === 0) return null;

  const mem = peekOfflineArtworkUrl(url, trackId);
  if (mem) return mem;

  const dedupeKey = keys[0];
  const inFlight = inFlightArtReads.get(dedupeKey);
  if (inFlight) return inFlight;

  const task = (async (): Promise<string | null> => {
    try {
      const db = await openVaultDb();
      if (db && db.objectStoreNames.contains(ARTWORK_STORE)) {
        for (const key of keys) {
          const row = await new Promise<StoredArtworkRecord | null>((resolve) => {
            try {
              const tx = db.transaction(ARTWORK_STORE, "readonly");
              const req = tx.objectStore(ARTWORK_STORE).get(key);
              req.onsuccess = () => {
                const res = req.result as StoredArtworkRecord | undefined;
                resolve(res?.blob && res.blob.size > 64 ? res : null);
              };
              req.onerror = () => resolve(null);
            } catch {
              resolve(null);
            }
          });
          if (row) {
            const usableBlob = row.blob.type
              ? row.blob
              : new Blob([row.blob], { type: row.mime || "image/jpeg" });
            const blobUrl = URL.createObjectURL(usableBlob);
            cacheArtworkUrlLru(keys, blobUrl);
            for (const k of keys) savedArtworkKeys.add(k);
            notifyArtworkListeners();
            return blobUrl;
          }
        }
      }

      const trimmedId = trackId?.trim();
      const native = getNativeOfflinePlugin();
      if (trimmedId && native?.getOfflineArtDataUrl) {
        const info = await native.getOfflineArtDataUrl({ id: trimmedId }).catch(() => null);
        if (info?.exists && info.dataUrl) {
          cacheArtworkUrlLru(keys, info.dataUrl);
          for (const k of keys) savedArtworkKeys.add(k);
          notifyArtworkListeners();
          return info.dataUrl;
        }
      }

      return null;
    } finally {
      inFlightArtReads.delete(dedupeKey);
    }
  })();

  inFlightArtReads.set(dedupeKey, task);
  return task;
}

async function fetchArtworkBlob(url: string): Promise<Blob | null> {
  if (!url || url.startsWith("blob:") || url.startsWith("data:")) return null;
  const candidates = Array.from(
    new Set([upgradeArtwork(url, 600), url].filter((u): u is string => Boolean(u && u.startsWith("http"))))
  );
  for (const candidate of candidates) {
    try {
      const res = await fetch(candidate, { signal: AbortSignal.timeout(6000) });
      if (!res.ok) continue;
      const blob = await res.blob();
      if (blob && blob.size >= 128) return blob;
    } catch {
      /* try next candidate */
    }
  }
  return null;
}

function dataUrlToBlob(dataUrl: string): Blob | null {
  try {
    const comma = dataUrl.indexOf(",");
    if (comma < 0) return null;
    const header = dataUrl.slice(0, comma);
    const mimeMatch = /data:([^;]+)/.exec(header);
    const mime = mimeMatch?.[1] || "image/jpeg";
    return base64ToBlob(dataUrl.slice(comma + 1), mime);
  } catch {
    return null;
  }
}

export async function saveOfflineArtwork(track: { id?: string; thumb?: string | null }): Promise<boolean> {
  const thumb = track.thumb?.trim();
  if (!thumb) return false;
  const keys = buildArtworkKeys(thumb, track.id);
  if (keys.length === 0) return false;

  const idKey = track.id?.trim() ? `id:${track.id.trim()}` : null;
  if (idKey && savedArtworkKeys.has(idKey)) return true;

  const dedupeKey = idKey ?? keys[0];
  const pending = inFlightArtSaves.get(dedupeKey);
  if (pending) return pending;

  const task = (async (): Promise<boolean> => {
    try {
      const upgraded = upgradeArtwork(thumb, 600) || thumb;
      const native = getNativeOfflinePlugin();
      const nativeSavePromise =
        track.id?.trim() && native?.saveOfflineArt
          ? native.saveOfflineArt({ id: track.id.trim(), url: upgraded }).catch(() => null)
          : Promise.resolve(null);

      let blob = await fetchArtworkBlob(thumb);
      await nativeSavePromise;

      if (!blob && track.id?.trim() && native?.getOfflineArtDataUrl) {
        const nativeRes = await native.getOfflineArtDataUrl({ id: track.id.trim() }).catch(() => null);
        if (nativeRes?.exists && nativeRes.dataUrl) {
          blob = dataUrlToBlob(nativeRes.dataUrl);
        }
      }

      if (!blob || blob.size < 128) return false;

      const db = await openVaultDb();
      if (db && db.objectStoreNames.contains(ARTWORK_STORE)) {
        await new Promise<void>((resolve) => {
          try {
            const tx = db.transaction(ARTWORK_STORE, "readwrite");
            const store = tx.objectStore(ARTWORK_STORE);
            const savedAt = Date.now();
            for (const key of keys) {
              const rec: StoredArtworkRecord = {
                key,
                trackId: track.id?.trim() || undefined,
                rawUrl: thumb,
                blob: blob!,
                mime: blob!.type || "image/jpeg",
                savedAt,
              };
              store.put(rec);
            }
            tx.oncomplete = () => resolve();
            tx.onerror = () => resolve();
          } catch {
            resolve();
          }
        });
      }

      const blobUrl = URL.createObjectURL(blob);
      cacheArtworkUrlLru(keys, blobUrl);
      for (const k of keys) savedArtworkKeys.add(k);
      notifyArtworkListeners();
      return true;
    } catch {
      return false;
    } finally {
      inFlightArtSaves.delete(dedupeKey);
    }
  })();

  inFlightArtSaves.set(dedupeKey, task);
  return task;
}

export async function saveOfflineLyricsForTrack(track: Track): Promise<boolean> {
  if (!track?.id || !track.title) return false;
  try {
    const existing = await getCachedLyrics(track);
    if (existing && (existing.synced?.length || existing.plain)) return true;
    if (typeof navigator !== "undefined" && navigator.onLine === false) return false;
    if (typeof window === "undefined" || !window.bytune?.getLyrics) return false;
    const res = await window.bytune.getLyrics({
      id: track.id,
      title: track.title,
      artist: track.artist,
      album: track.album,
      duration: track.duration || undefined,
    });
    if (res && (res.synced?.length || res.plain)) {
      await saveCachedLyrics(track, res);
      return true;
    }
  } catch {
    /* ignore */
  }
  return false;
}

export async function saveOfflineTrackExtras(track: Track): Promise<void> {
  await Promise.allSettled([saveOfflineArtwork(track), saveOfflineLyricsForTrack(track)]);
}

function notifyListeners(): void {
  for (const fn of vaultListeners) {
    try {
      fn();
    } catch {
      /* ignore */
    }
  }
}

export function subscribeOfflineVault(cb: () => void): () => void {
  vaultListeners.add(cb);
  return () => vaultListeners.delete(cb);
}

export function isSavedInOfflineVault(trackId: string): boolean {
  return savedIds.has(trackId);
}

export function getSavedOfflineCount(trackIds: string[]): number {
  let count = 0;
  for (const id of trackIds) {
    if (savedIds.has(id)) count++;
  }
  return count;
}

function openVaultDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  if (typeof navigator !== "undefined" && navigator.storage?.persist) {
    void navigator.storage.persist().catch(() => false);
  }
  dbPromise = new Promise<IDBDatabase | null>((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains(ARTWORK_STORE)) {
          db.createObjectStore(ARTWORK_STORE, { keyPath: "key" });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        // Hydrate savedIds and artwork indices on open
        try {
          const storeNames = db.objectStoreNames.contains(ARTWORK_STORE)
            ? [STORE_NAME, ARTWORK_STORE]
            : [STORE_NAME];
          const tx = db.transaction(storeNames, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => {
            for (const k of keysReq.result) {
              if (typeof k === "string") savedIds.add(k);
            }
            notifyListeners();
          };
          if (db.objectStoreNames.contains(ARTWORK_STORE)) {
            const artKeysReq = tx.objectStore(ARTWORK_STORE).getAllKeys();
            artKeysReq.onsuccess = () => {
              for (const k of artKeysReq.result) {
                if (typeof k === "string") savedArtworkKeys.add(k);
              }
              notifyArtworkListeners();
            };
          }
        } catch {
          /* ignore */
        }
        resolve(db);
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

// Kick off hydration immediately in browser environments
if (typeof window !== "undefined") {
  loadNativeSavedIds();
  void openVaultDb();
  if (isTauriDesktop()) {
    void fetch(`${getVaultBaseUrl()}/vault-list`, { signal: AbortSignal.timeout(4000) })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { ids?: string[] } | null) => {
        if (Array.isArray(d?.ids)) {
          for (const id of d.ids) {
            if (typeof id === "string") savedIds.add(id);
          }
          notifyListeners();
        }
      })
      .catch(() => undefined);
  }
}

/**
 * Retrieve a playable URL from the offline vault if the track is stored locally
 * (`blob:` from IndexedDB, or range-capable disk vault URL on desktop).
 */
export async function getOfflineVaultUrl(trackId: string): Promise<string | null> {
  const native = getNativeOfflinePlugin();
  if (native?.getOfflineFileUri) {
    try {
      const info = await native.getOfflineFileUri({ id: trackId });
      if (info?.exists && info.fileUri) {
        savedIds.add(trackId);
        persistNativeSavedId(trackId, true);
        return info.fileUri;
      }
    } catch {
      /* fall through to IndexedDB */
    }
  }

  const existingUrl = memoryBlobUrls.get(trackId);
  if (existingUrl && !native) {
    // Refresh LRU order on hit
    memoryBlobUrls.delete(trackId);
    memoryBlobUrls.set(trackId, existingUrl);
    return existingUrl;
  }

  const db = await openVaultDb();
  if (db) {
    const idbRow = await new Promise<StoredTrackAudio | null>((resolve) => {
      try {
        const tx = db.transaction(STORE_NAME, "readonly");
        const store = tx.objectStore(STORE_NAME);
        const req = store.get(trackId);
        req.onsuccess = () => {
          const row = req.result as StoredTrackAudio | undefined;
          resolve(row?.blob && row.blob.size > 1024 ? row : null);
        };
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    if (idbRow) {
      savedIds.add(trackId);
      const usableBlob = idbRow.blob.type
        ? idbRow.blob
        : new Blob([idbRow.blob], { type: idbRow.mime || "audio/mp4" });
      if (native?.saveOfflineFile) {
        try {
          const base64 = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
              const res = String(reader.result ?? "");
              const comma = res.indexOf(",");
              resolve(comma >= 0 ? res.slice(comma + 1) : res);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(usableBlob);
          });
          const saved = await native.saveOfflineFile({
            id: trackId,
            base64,
            mime: usableBlob.type || "audio/mp4",
          });
          if (saved?.fileUri) {
            persistNativeSavedId(trackId, true);
            return saved.fileUri;
          }
        } catch {
          /* fall back to blob URL below */
        }
      }
      const url = URL.createObjectURL(usableBlob);
      cacheBlobUrlLru(trackId, url);
      return url;
    }
  }

  // On PC desktop, serve validated offline-vault files straight from disk over HTTP Range
  // instead of pulling gigabytes into WebView2 IndexedDB / JS heap blobs.
  if (isTauriDesktop() && savedIds.has(trackId)) {
    return `${getVaultBaseUrl()}/vault/${encodeURIComponent(trackId)}`;
  }

  return null;
}

/**
 * Download and store a track's full audio inside the app's internal IndexedDB vault.
 */
export async function saveTrackToOfflineVault(
  track: Track,
  resolveNetworkStreamUrl?: (id: string) => Promise<string>
): Promise<boolean> {
  if (!track?.id || track.id.startsWith("local:")) return false;
  if (savedIds.has(track.id)) {
    void saveOfflineTrackExtras(track);
    return true;
  }

  const pending = inFlightSaves.get(track.id);
  if (pending) return pending;

  const task = (async (): Promise<boolean> => {
    const extrasPromise = saveOfflineTrackExtras(track).catch(() => undefined);
    try {
      // On PC desktop, store directly in Node's disk offline-vault (`POST /vault/:id`)
      // rather than downloading huge binary Blobs into WebView2 JS heap & IndexedDB.
      if (isTauriDesktop()) {
        const ctl = new AbortController();
        const timer = setTimeout(() => ctl.abort(), 90_000);
        try {
          const res = await fetch(`${getVaultBaseUrl()}/vault/${encodeURIComponent(track.id)}`, {
            method: "POST",
            signal: ctl.signal,
          });
          if (res.ok) {
            savedIds.add(track.id);
            notifyListeners();
            await extrasPromise;
            return true;
          }
        } catch {
          /* ignore */
        } finally {
          clearTimeout(timer);
        }
        return false;
      }

      const native = getNativeOfflinePlugin();
      if (native?.saveOfflineFile) {
        try {
          const existing = await native.getOfflineFileUri?.({ id: track.id });
          if (existing?.exists && existing.fileUri) {
            savedIds.add(track.id);
            persistNativeSavedId(track.id, true);
            notifyListeners();
            await extrasPromise;
            return true;
          }
          const primaryUrl = resolveNetworkStreamUrl
            ? await resolveNetworkStreamUrl(track.id)
            : await window.bytune?.getStreamUrl(track.id, false, "high", track.title, track.artist).catch(() => null);
          if (primaryUrl && (primaryUrl.startsWith("file://") || primaryUrl.startsWith("blob:"))) {
            savedIds.add(track.id);
            persistNativeSavedId(track.id, true);
            notifyListeners();
            await extrasPromise;
            return true;
          }
          if (primaryUrl && (primaryUrl.startsWith("http://") || primaryUrl.startsWith("https://"))) {
            const saved = await native.saveOfflineFile({ id: track.id, url: primaryUrl }).catch(() => null);
            if (saved?.fileUri) {
              savedIds.add(track.id);
              persistNativeSavedId(track.id, true);
              notifyListeners();
              await extrasPromise;
              return true;
            }
          }
          const altUrl = await fallbackMobileStreamUrl(track.id, {
            title: track.title,
            artist: track.artist,
          }).catch(() => null);
          if (altUrl && altUrl !== primaryUrl) {
            const saved = await native.saveOfflineFile({ id: track.id, url: altUrl }).catch(() => null);
            if (saved?.fileUri) {
              savedIds.add(track.id);
              persistNativeSavedId(track.id, true);
              notifyListeners();
              await extrasPromise;
              return true;
            }
          }
        } catch {
          /* fall back to IndexedDB */
        }
      }

      const db = await openVaultDb();
      if (!db) return false;

      let blob: Blob | null = null;

      // 1. Try the shared PC/Mobile server vault if potentially reachable (`GET /vault/:id`)
      if (!isUnpairedPhone() && Date.now() >= vaultServerUnreachableUntil) {
        const ctl = new AbortController();
        const headerTimer = setTimeout(() => ctl.abort(), 3500);
        try {
          const vaultRes = await fetch(`${getVaultBaseUrl()}/vault/${encodeURIComponent(track.id)}`, {
            signal: ctl.signal,
          });
          clearTimeout(headerTimer);
          if (vaultRes.ok) {
            const candidate = await vaultRes.blob();
            if (candidate && candidate.size >= 4096) {
              blob = candidate;
            }
          }
        } catch {
          clearTimeout(headerTimer);
          // Avoid stalling 3.5s per song when outside home / PC is off
          vaultServerUnreachableUntil = Date.now() + 20_000;
        }
      }

      // 2. Fallback: resolve stream via bridge or mobile standalone Piped resolver + CORS-resilient fetch
      if (!blob) {
        const primaryUrl = resolveNetworkStreamUrl
          ? await resolveNetworkStreamUrl(track.id)
          : await window.bytune?.getStreamUrl(track.id, false, "high", track.title, track.artist).catch(() => null);
        if (primaryUrl?.startsWith("blob:")) return true;
        if (primaryUrl) {
          blob = await fetchUrlAsBlob(primaryUrl);
        }
        if (!blob) {
          const altUrl = await fallbackMobileStreamUrl(track.id, {
            title: track.title,
            artist: track.artist,
          }).catch(() => null);
          if (altUrl && altUrl !== primaryUrl) {
            blob = await fetchUrlAsBlob(altUrl);
          }
        }
      }

      if (!blob || blob.size < 4096) return false;

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const record: StoredTrackAudio = {
          id: track.id,
          blob: blob!,
          mime: blob!.type || "audio/mp4",
          savedAt: Date.now(),
          title: track.title,
          artist: track.artist,
        };
        const putReq = store.put(record);
        putReq.onsuccess = () => resolve();
        putReq.onerror = () => reject(putReq.error);
      });

      savedIds.add(track.id);
      notifyListeners();
      await extrasPromise;
      return true;
    } catch {
      return false;
    } finally {
      inFlightSaves.delete(track.id);
    }
  })();

  inFlightSaves.set(track.id, task);
  return task;
}

export async function removeTrackFromOfflineVault(trackId: string): Promise<void> {
  const mem = memoryBlobUrls.get(trackId);
  if (mem) {
    URL.revokeObjectURL(mem);
    memoryBlobUrls.delete(trackId);
  }
  savedIds.delete(trackId);
  persistNativeSavedId(trackId, false);
  const artIdKey = `id:${trackId}`;
  savedArtworkKeys.delete(artIdKey);
  artworkMemoryUrls.delete(artIdKey);
  notifyListeners();
  notifyArtworkListeners();

  void getNativeOfflinePlugin()?.deleteOfflineFile?.({ id: trackId }).catch(() => undefined);
  void getNativeOfflinePlugin()?.deleteOfflineArt?.({ id: trackId }).catch(() => undefined);

  void fetch(`${getVaultBaseUrl()}/vault/${encodeURIComponent(trackId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);

  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const storeNames = db.objectStoreNames.contains(ARTWORK_STORE)
        ? [STORE_NAME, ARTWORK_STORE]
        : [STORE_NAME];
      const tx = db.transaction(storeNames, "readwrite");
      tx.objectStore(STORE_NAME).delete(trackId);
      if (db.objectStoreNames.contains(ARTWORK_STORE)) {
        tx.objectStore(ARTWORK_STORE).delete(artIdKey);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export interface OfflineVaultPageItem {
  id: string;
  title?: string;
  artist?: string;
  mime: string;
  savedAt: number;
}

/** Lazy cursor-based paginated listing of offline vault tracks (metadata only; avoids Blob cloning). */
export async function getOfflineTracksPage(
  offset = 0,
  limit = 50
): Promise<{ items: OfflineVaultPageItem[]; total: number; hasMore: boolean }> {
  const safeOffset = Math.max(0, offset);
  const safeLimit = Math.max(1, limit);
  const allIds = Array.from(savedIds);
  const db = await openVaultDb();
  if (!db) {
    const slice = allIds.slice(safeOffset, safeOffset + safeLimit).map((id) => ({
      id,
      mime: "audio/mp4",
      savedAt: 0,
    }));
    return {
      items: slice,
      total: allIds.length,
      hasMore: safeOffset + slice.length < allIds.length,
    };
  }

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const countReq = store.count();
      let total = allIds.length;
      countReq.onsuccess = () => {
        total = Number(countReq.result) || allIds.length;
      };
      const items: OfflineVaultPageItem[] = [];
      let advanced = false;
      const cursorReq = store.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) {
          resolve({ items, total, hasMore: safeOffset + items.length < total });
          return;
        }
        if (!advanced && safeOffset > 0) {
          advanced = true;
          cursor.advance(safeOffset);
          return;
        }
        const row = cursor.value as StoredTrackAudio | undefined;
        if (row?.id) {
          items.push({
            id: row.id,
            title: row.title,
            artist: row.artist,
            mime: row.mime || "audio/mp4",
            savedAt: row.savedAt || 0,
          });
        }
        if (items.length >= safeLimit) {
          resolve({ items, total, hasMore: safeOffset + items.length < total });
          return;
        }
        cursor.continue();
      };
      cursorReq.onerror = () => resolve({ items: [], total: allIds.length, hasMore: false });
    } catch {
      resolve({ items: [], total: allIds.length, hasMore: false });
    }
  });
}

/**
 * Ensure all tracks in a list (such as Liked Songs) are saved inside the app's offline vault
 * along with offline artwork + cached lyrics.
 */
export async function syncLikedSongsToOfflineVault(tracks: Track[]): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = tracks.filter((t) => Boolean(t?.id) && !t.id.startsWith("local:") && !savedIds.has(t.id));
  const extrasBackfill = tracks.filter(
    (t) => Boolean(t?.id) && !t.id.startsWith("local:") && savedIds.has(t.id) && !savedArtworkKeys.has(`id:${t.id}`)
  );

  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      const track = queue[cursor++];
      if (track) await saveTrackToOfflineVault(track);
      if (cursor < queue.length) {
        await new Promise((r) => setTimeout(r, isTauriDesktop() ? 400 : 150));
      }
    }
    for (const track of extrasBackfill) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      await saveOfflineTrackExtras(track);
    }
  };
  if (queue.length > 0 || extrasBackfill.length > 0) {
    await worker();
  }
}

