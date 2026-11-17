/**
 * Persistent chunked offline-first lyrics cache backed by IndexedDB (`lyrics` headers
 * + small paginated `lyrics_chunks`) so storing/loading long enhanced LRC datasets
 * never freezes the UI thread during playback.
 */
import type { LyricsResult, SyncedLyricLine } from "../types";
import { cleanTrackQuery } from "./mobileStandaloneFallback";

const DB_NAME = "dynamusic-lyrics-cache";
const DB_VERSION = 2;
const STORE_NAME = "lyrics";
const CHUNK_STORE_NAME = "lyrics_chunks";
const LS_INDEX_KEY = "dynamusic:lyrics_cache_v1";
const LYRICS_STORAGE_CHUNK_SIZE = 24;
const MAX_MEM_ENTRIES = 64;
const MAX_LS_ENTRIES = 12;

interface StoredLyricsHeader {
  key: string;
  source?: string | null;
  wordSynced?: boolean;
  plain?: string | null;
  chunkCount?: number;
  /** Legacy inline field for backwards compatibility with pre-v2 entries. */
  result?: LyricsResult;
  duration?: number;
  savedAt: number;
}

interface StoredLyricsChunk {
  chunkKey: string;
  lines: SyncedLyricLine[];
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
        if (!db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
          db.createObjectStore(CHUNK_STORE_NAME, { keyPath: "chunkKey" });
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

function isCompatibleHeader(
  entry: StoredLyricsHeader | undefined,
  key: string,
  trackDuration?: number
): entry is StoredLyricsHeader {
  if (!entry) return false;
  const hasContent =
    (entry.chunkCount ?? 0) > 0 ||
    Boolean(entry.plain && entry.plain.trim()) ||
    Boolean(entry.result && (entry.result.synced?.length || entry.result.plain));
  if (!hasContent) return false;
  if (key.startsWith("meta:") && trackDuration && trackDuration > 0 && entry.duration && entry.duration > 0) {
    if (Math.abs(trackDuration - entry.duration) > 10) return false;
  }
  return true;
}

function readLocalFallback(keys: string[], trackDuration?: number): LyricsResult | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(LS_INDEX_KEY);
    if (!raw) return null;
    const map = JSON.parse(raw) as Record<string, StoredLyricsHeader>;
    for (const key of keys) {
      const entry = map[key];
      if (isCompatibleHeader(entry, key, trackDuration) && entry.result) {
        return entry.result;
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

function writeLocalFallback(keys: string[], result: LyricsResult, duration?: number): void {
  try {
    if (typeof localStorage === "undefined") return;
    const raw = localStorage.getItem(LS_INDEX_KEY);
    const map = raw ? (JSON.parse(raw) as Record<string, StoredLyricsHeader>) : {};
    const now = Date.now();
    for (const key of keys) {
      map[key] = { key, source: result.source, result, duration, savedAt: now };
    }
    const entries = Object.values(map).sort((a, b) => b.savedAt - a.savedAt).slice(0, MAX_LS_ENTRIES);
    const pruned: Record<string, StoredLyricsHeader> = {};
    for (const e of entries) {
      pruned[e.key] = e;
    }
    localStorage.setItem(LS_INDEX_KEY, JSON.stringify(pruned));
  } catch {
    /* ignore quota errors */
  }
}

async function readChunkedResult(db: IDBDatabase, entry: StoredLyricsHeader): Promise<LyricsResult | null> {
  if (entry.result && (entry.result.synced?.length || entry.result.plain)) {
    return entry.result;
  }
  const chunkCount = entry.chunkCount ?? 0;
  let synced: SyncedLyricLine[] | null = null;
  if (chunkCount > 0 && db.objectStoreNames.contains(CHUNK_STORE_NAME)) {
    const tx = db.transaction(CHUNK_STORE_NAME, "readonly");
    const store = tx.objectStore(CHUNK_STORE_NAME);
    const collected: SyncedLyricLine[] = [];
    for (let idx = 0; idx < chunkCount; idx++) {
      const chunk = await new Promise<StoredLyricsChunk | undefined>((resolve) => {
        const req = store.get(`${entry.key}#${idx}`);
        req.onsuccess = () => resolve(req.result as StoredLyricsChunk | undefined);
        req.onerror = () => resolve(undefined);
      });
      if (chunk?.lines?.length) collected.push(...chunk.lines);
    }
    if (collected.length > 0) synced = collected;
  }
  if (!synced?.length && !entry.plain) return null;
  return {
    ...(entry.source ? { source: entry.source } : {}),
    wordSynced: entry.wordSynced,
    synced,
    plain: entry.plain ?? null,
  };
}

export async function getCachedLyrics(track: {
  id?: string | null;
  title: string;
  artist: string;
  duration?: number;
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
        const entry = await new Promise<StoredLyricsHeader | undefined>((resolve) => {
          const req = store.get(key);
          req.onsuccess = () => resolve(req.result as StoredLyricsHeader | undefined);
          req.onerror = () => resolve(undefined);
        });
        if (isCompatibleHeader(entry, key, track.duration)) {
          const assembled = await readChunkedResult(db, entry);
          if (assembled) {
            for (const k of keys) setMem(k, assembled);
            return assembled;
          }
        }
      }
    } catch {
      /* fall through to localStorage */
    }
  }

  const lsHit = readLocalFallback(keys, track.duration);
  if (lsHit) {
    for (const k of keys) setMem(k, lsHit);
  }
  return lsHit;
}

export async function saveCachedLyrics(
  track: { id?: string | null; title: string; artist: string; duration?: number },
  result: LyricsResult
): Promise<void> {
  if (!result || (!result.synced?.length && !result.plain)) return;
  const keys = buildLyricsCacheKeys(track);
  if (!keys.length) return;
  const duration = track.duration && track.duration > 0 ? track.duration : undefined;
  for (const key of keys) setMem(key, result);

  const db = await openLyricsDb();
  if (db) {
    try {
      const storeNames = db.objectStoreNames.contains(CHUNK_STORE_NAME)
        ? [STORE_NAME, CHUNK_STORE_NAME]
        : [STORE_NAME];
      const tx = db.transaction(storeNames, "readwrite");
      const headerStore = tx.objectStore(STORE_NAME);
      const chunkStore = db.objectStoreNames.contains(CHUNK_STORE_NAME)
        ? tx.objectStore(CHUNK_STORE_NAME)
        : null;
      const savedAt = Date.now();
      const synced = result.synced ?? [];
      const chunkCount = chunkStore ? Math.ceil(synced.length / LYRICS_STORAGE_CHUNK_SIZE) : 0;

      for (const key of keys) {
        if (chunkStore) {
          headerStore.put({
            key,
            source: result.source ?? null,
            wordSynced: result.wordSynced,
            plain: result.plain ?? null,
            chunkCount,
            duration,
            savedAt,
          } satisfies StoredLyricsHeader);
          for (let c = 0; c < chunkCount; c++) {
            const slice = synced.slice(c * LYRICS_STORAGE_CHUNK_SIZE, (c + 1) * LYRICS_STORAGE_CHUNK_SIZE);
            chunkStore.put({ chunkKey: `${key}#${c}`, lines: slice } satisfies StoredLyricsChunk);
          }
        } else {
          headerStore.put({ key, source: result.source ?? null, result, duration, savedAt } satisfies StoredLyricsHeader);
        }
      }
      return;
    } catch {
      /* fall through to localStorage */
    }
  }

  writeLocalFallback(keys, result, duration);
}

