/**
 * In-App Offline Audio Vault (IndexedDB).
 *
 * Stores full audio tracks directly inside the app's internal IndexedDB storage
 * (`dynamusic-offline-vault`) so Liked Songs (and any offline-saved tracks) play
 * 100% offline with zero network connection—both on Desktop and on Phone (PWA / Mobile).
 */
import type { Track } from "../types";

const DB_NAME = "dynamusic-offline-vault";
const STORE_NAME = "tracks";
const DB_VERSION = 1;

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
const savedIds = new Set<string>();
const inFlightSaves = new Map<string, Promise<boolean>>();
const vaultListeners = new Set<() => void>();

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
  if (existingUrl) return existingUrl;

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
          const url = URL.createObjectURL(row.blob);
          memoryBlobUrls.set(trackId, url);
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

      const streamUrl = resolveNetworkStreamUrl
        ? await resolveNetworkStreamUrl(track.id)
        : await window.bytune?.getStreamUrl(track.id, false, "high");
      if (!streamUrl || streamUrl.startsWith("blob:")) return streamUrl?.startsWith("blob:") ?? false;

      const res = await fetch(streamUrl);
      if (!res.ok) return false;
      const blob = await res.blob();
      if (!blob || blob.size < 4096) return false;

      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE_NAME, "readwrite");
        const store = tx.objectStore(STORE_NAME);
        const record: StoredTrackAudio = {
          id: track.id,
          blob,
          mime: blob.type || "audio/mp4",
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
  for (const track of tracks) {
    if (!track?.id || track.id.startsWith("local:") || savedIds.has(track.id)) continue;
    await saveTrackToOfflineVault(track);
  }
}

