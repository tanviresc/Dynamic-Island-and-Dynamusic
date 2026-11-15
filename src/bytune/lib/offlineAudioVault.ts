/**
 * In-App Offline Audio Vault (IndexedDB).
 *
 * Stores full audio tracks directly inside the app's internal IndexedDB storage
 * (`dynamusic-offline-vault`) so Liked Songs (and any offline-saved tracks) play
 * 100% offline with zero network connection—both on Desktop and on Phone (PWA / Mobile).
 */
import type { Track } from "../types";
import { getBackendBaseUrl, getBackendHost, isCapacitorNative, isTauriDesktop } from "../stores/mobileMode";
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
const DB_VERSION = 1;
const MAX_MEMORY_BLOB_URLS = 32;

interface StoredTrackAudio {
  id: string;
  blob: Blob;
  mime: string;
  savedAt: number;
  title?: string;
  artist?: string;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryBlobUrls = new Map<string, string>();
const pinnedTrackIds = new Set<string>();
const savedIds = new Set<string>();
const inFlightSaves = new Map<string, Promise<boolean>>();
const vaultListeners = new Set<() => void>();

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
  if (memoryBlobUrls.size <= MAX_MEMORY_BLOB_URLS) return;
  for (const candidateId of Array.from(memoryBlobUrls.keys())) {
    if (memoryBlobUrls.size <= MAX_MEMORY_BLOB_URLS) break;
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
      };
      req.onsuccess = () => {
        const db = req.result;
        // Hydrate savedIds index on open
        try {
          const tx = db.transaction(STORE_NAME, "readonly");
          const store = tx.objectStore(STORE_NAME);
          const keysReq = store.getAllKeys();
          keysReq.onsuccess = () => {
            for (const k of keysReq.result) {
              if (typeof k === "string") savedIds.add(k);
            }
            notifyListeners();
          };
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
  void openVaultDb();
}

/**
 * Retrieve a playable `blob:` URL from the internal IndexedDB vault if the track is stored inside the app.
 */
export async function getOfflineVaultUrl(trackId: string): Promise<string | null> {
  const existingUrl = memoryBlobUrls.get(trackId);
  if (existingUrl) {
    // Refresh LRU order on hit
    memoryBlobUrls.delete(trackId);
    memoryBlobUrls.set(trackId, existingUrl);
    return existingUrl;
  }

  const db = await openVaultDb();
  if (!db) return null;

  return new Promise<string | null>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(trackId);
      req.onsuccess = () => {
        const row = req.result as StoredTrackAudio | undefined;
        if (row?.blob && row.blob.size > 1024) {
          savedIds.add(trackId);
          const usableBlob = row.blob.type
            ? row.blob
            : new Blob([row.blob], { type: row.mime || "audio/mp4" });
          const url = URL.createObjectURL(usableBlob);
          cacheBlobUrlLru(trackId, url);
          resolve(url);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/**
 * Download and store a track's full audio inside the app's internal IndexedDB vault.
 */
export async function saveTrackToOfflineVault(
  track: Track,
  resolveNetworkStreamUrl?: (id: string) => Promise<string>
): Promise<boolean> {
  if (!track?.id || track.id.startsWith("local:")) return false;
  if (savedIds.has(track.id)) return true;

  const pending = inFlightSaves.get(track.id);
  if (pending) return pending;

  const task = (async (): Promise<boolean> => {
    try {
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
  notifyListeners();

  void fetch(`${getVaultBaseUrl()}/vault/${encodeURIComponent(trackId)}`, {
    method: "DELETE",
    signal: AbortSignal.timeout(3000),
  }).catch(() => undefined);

  const db = await openVaultDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      tx.objectStore(STORE_NAME).delete(trackId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

/**
 * Ensure all tracks in a list (such as Liked Songs) are saved inside the app's offline vault.
 */
export async function syncLikedSongsToOfflineVault(tracks: Track[]): Promise<void> {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return;
  const queue = tracks.filter((t) => Boolean(t?.id) && !t.id.startsWith("local:") && !savedIds.has(t.id));
  if (queue.length === 0) return;
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < queue.length) {
      if (typeof navigator !== "undefined" && navigator.onLine === false) break;
      const track = queue[cursor++];
      if (track) await saveTrackToOfflineVault(track);
    }
  };
  const concurrency = isCapacitorNative() ? 1 : Math.min(3, queue.length);
  await Promise.all(Array.from({ length: concurrency }, () => worker()));
}

