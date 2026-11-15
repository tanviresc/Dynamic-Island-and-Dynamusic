/**
 * Persistent offline-first lyrics cache backed by IndexedDB (with in-memory LRU
 * and localStorage fallback) so repeat & offline playback loads lyrics instantly.
 */
import type { LyricsResult } from "../types";
import { cleanTrackQuery } from "./mobileStandaloneFallback";

const DB_NAME = "dynamusic-lyrics-cache";
const DB_VERSION = 1;
const STORE_NAME = "lyrics";
const LS_INDEX_KEY = "dynamusic:lyrics_cache_v1";
const MAX_MEM_ENTRIES = 64;
const MAX_LS_ENTRIES = 24;

interface StoredLyricsEntry {
  key: string;
  result: LyricsResult;
  savedAt: number;
}

const memCache = new Map<string, LyricsResult>();
let dbPromise: Promise<IDBDatabase | null> | null = null;

function openLyricsDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "key" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function setMem(key: string, value: LyricsResult): void {
  if (memCache.has(key)) memCache.delete(key);
  memCache.set(key, value);
  while (memCache.size > MAX_MEM_ENTRIES) {
    const oldest = memCache.keys().next().value;
    if (!oldest) break;
    memCache.delete(oldest);
  }
}

export function buildLyricsCacheKeys(track: {
  id?: string | null;
  title: string;
  artist: string;
}): string[] {
  const keys: string[] = [];
  if (track.id && track.id.trim()) {
    keys.push(`id:${track.id.trim()}`);
  }
  const cleaned = cleanTrackQuery(track.title ?? "", track.artist ?? "");
  const normTitle = cleaned.title.toLowerCase();
  const normArtist = cleaned.artist.toLowerCase();
  if (normTitle) {
    keys.push(`meta:${normTitle}|${normArtist}`);
  }
  return keys;
}

function readLocalFallback(keys: string[]): LyricsResult | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_INDEX_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StoredLyricsEntry>;
    for (const key of keys) {
      const entry = map[key];
      if (entry?.result && (entry.result.synced?.length || entry.result.plain)) {
        return entry.result;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeLocalFallback(keys: string[], result: LyricsResult): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LS_INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StoredLyricsEntry>) : {};
    const now = Date.now();
    for (const key of keys) {
      map[key] = { key, result, savedAt: now };
    }
    const entries = Object.values(map).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_LS_ENTRIES);
    const pruned: Record<string, StoredLyricsEntry> = {};
    for (const e of entries) {
      pruned[e.key] = e;
    }
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(pruned));
  } catch {
    /* ignore quota errors */
  }
}

export async function getCachedLyrics(track: {
  id?: string | null;
  title: string;
  artist: string;
}): Promise<LyricsResult | null> {
  const keys = buildLyricsCacheKeys(track);
  for (const key of keys) {
    const hit = memCache.get(key);
    if (hit) {
      setMem(key, hit);
      return hit;
    }
  }

  const db = await openLyricsDb();
  if (db) {
    try {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      for (const key of keys) {
        const entry = await new Promise<StoredLyricsEntry | undefined>((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result as StoredLyricsEntry | undefined);
          req.onerror = () => resolve(undefined);
        });
        if (entry?.result && (entry.result.synced?.length || entry.result.plain)) {
          for (const k of keys) setMem(k, entry.result);
          return entry.result;
        }
      }
    } catch {
      /* fall through to localStorage */
    }
  }

  const lsHit = readLocalFallback(keys);
  if (lsHit) {
    for (const k of keys) setMem(k, lsHit);
  }
  return lsHit;
}

export async function saveCachedLyrics(
  track: { id?: string | null; title: string; artist: string },
  result: LyricsResult
): Promise<void> {
  if (!result || (!result.synced?.length && !result.plain)) return;
  const keys = buildLyricsCacheKeys(track);
  if (!keys.length) return;
  for (const key of keys) setMem(key, result);
  writeLocalFallback(keys, result);

  const db = await openLyricsDb();
  if (db) {
    try {
      const tx = db.transaction(STORE_NAME, "readwrite");
      const store = tx.objectStore(STORE_NAME);
      const savedAt = Date.now();
      for (const key of keys) {
        store.put({ key, result, savedAt } satisfies StoredLyricsEntry);
      }
    } catch {
      /* localStorage + memory already updated */
    }
  }
}
