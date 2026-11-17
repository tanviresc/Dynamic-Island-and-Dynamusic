/**
 * Chunked & paginated IndexedDB storage layer for Mobile (Capacitor APK / Web).
 *
 * Splits large local JSON datasets (`library`, `listen-journal`, archives) into
 * small paginated IndexedDB chunks (`CHUNK_SIZE` = 50 tracks / 100 journal entries / 64 KB
 * fallback slices), eliminating heavy single-file `localStorage` JSON parse/stringify freezes
 * and enabling lazy page-by-page loading in offline mode.
 */

const CHUNK_DB_NAME = "dynamusic-mobile-chunks";
const CHUNK_DB_VERSION = 1;
const CHUNK_STORE = "chunks";
const MANIFEST_PREFIX = "dynamusic:chunk_manifest:";

export const TRACK_CHUNK_SIZE = 50;
export const JOURNAL_CHUNK_SIZE = 100;
export const RAW_TEXT_CHUNK_BYTES = 64 * 1024;
const BOOT_PREVIEW_TRACKS = 25;
const MAX_MEM_ENTRIES = 24;

export interface ChunkManifest {
  version: 1;
  kind: "library" | "journal" | "raw" | "inline";
  updatedAt: number;
  storeVersion: number;
  /** Non-chunked lightweight header fields (folders, pins, counts, playlist headers). */
  header: unknown;
  /** Number of pages for each chunked section. */
  counts?: {
    liked?: number;
    likedPages?: number;
    history?: number;
    historyPages?: number;
    playlists?: Record<string, { total: number; pages: number }>;
    journal?: number;
    journalPages?: number;
    rawPages?: number;
  };
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
const memoryCache = new Map<string, unknown>();
const memoryChunks = new Map<string, unknown>();

/** Reset in-memory caches (used when switching accounts or clearing test state). */
export function clearChunkedStoreCache(): void {
  memoryCache.clear();
  memoryChunks.clear();
}

function rememberMem(key: string, value: unknown): void {
  memoryCache.delete(key);
  memoryCache.set(key, value);
  while (memoryCache.size > MAX_MEM_ENTRIES) {
    const oldest = memoryCache.keys().next().value;
    if (!oldest) break;
    memoryCache.delete(oldest);
  }
}

function openChunkDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(CHUNK_DB_NAME, CHUNK_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(CHUNK_STORE)) {
          db.createObjectStore(CHUNK_STORE, { keyPath: "key" });
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

interface ChunkRow {
  key: string;
  data: unknown;
}

async function idbGetChunk<T = unknown>(key: string): Promise<T | undefined> {
  const db = await openChunkDb();
  if (!db) return memoryChunks.get(key) as T | undefined;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readonly");
      const req = tx.objectStore(CHUNK_STORE).get(key);
      req.onsuccess = () => resolve((req.result as ChunkRow | undefined)?.data as T | undefined);
      req.onerror = () => resolve(memoryChunks.get(key) as T | undefined);
    } catch {
      resolve(memoryChunks.get(key) as T | undefined);
    }
  });
}

async function idbPutChunks(rows: ChunkRow[], deletePrefix?: string, keepKeys?: Set<string>): Promise<void> {
  const db = await openChunkDb();
  if (!db) {
    if (deletePrefix && keepKeys) {
      for (const k of Array.from(memoryChunks.keys())) {
        if (k.startsWith(deletePrefix) && !keepKeys.has(k)) {
          memoryChunks.delete(k);
        }
      }
    }
    for (const row of rows) {
      memoryChunks.set(row.key, row.data);
    }
    return;
  }
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      for (const row of rows) {
        store.put(row);
      }
      if (deletePrefix && keepKeys) {
        const cursorReq = store.openCursor(IDBKeyRange.bound(deletePrefix, `${deletePrefix}\uffff`));
        cursorReq.onsuccess = () => {
          const cursor = cursorReq.result;
          if (!cursor) return;
          const k = String(cursor.key);
          if (!keepKeys.has(k)) {
            cursor.delete();
          }
          cursor.continue();
        };
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function idbDeletePrefix(prefix: string): Promise<void> {
  for (const k of Array.from(memoryChunks.keys())) {
    if (k.startsWith(prefix)) memoryChunks.delete(k);
  }
  const db = await openChunkDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(CHUNK_STORE, "readwrite");
      const store = tx.objectStore(CHUNK_STORE);
      const cursorReq = store.openCursor(IDBKeyRange.bound(prefix, `${prefix}\uffff`));
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function manifestStorageKey(storeKey: string): string {
  return `${MANIFEST_PREFIX}${storeKey}`;
}

function readManifestSync(storeKey: string): ChunkManifest | null {
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(manifestStorageKey(storeKey));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChunkManifest;
    return parsed && parsed.version === 1 ? parsed : null;
  } catch {
    return null;
  }
}

function writeManifestSync(storeKey: string, manifest: ChunkManifest | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const k = manifestStorageKey(storeKey);
    if (!manifest) {
      localStorage.removeItem(k);
    } else {
      localStorage.setItem(k, JSON.stringify(manifest));
    }
  } catch {
    /* ignore quota errors */
  }
}

function chunkSlice<T>(items: T[], size: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    pages.push(items.slice(i, i + size));
  }
  return pages;
}

function isLibraryPayload(data: unknown): data is { version?: number; state?: Record<string, any> } {
  if (!data || typeof data !== "object") return false;
  const st = (data as { state?: Record<string, unknown> }).state;
  return Boolean(
    st &&
      typeof st === "object" &&
      (Array.isArray(st.liked) || Array.isArray(st.playlists) || Array.isArray(st.history))
  );
}

function isJournalPayload(data: unknown): data is { version?: number; state?: { entries?: unknown[] } } {
  if (!data || typeof data !== "object") return false;
  const st = (data as { state?: { entries?: unknown } }).state;
  return Boolean(st && typeof st === "object" && Array.isArray(st.entries));
}

function reconstructHeaderStub(manifest: ChunkManifest): unknown {
  if (manifest.kind === "library") {
    const hdr = manifest.header as {
      version?: number;
      state?: Record<string, any>;
      previewLiked?: unknown[];
      previewHistory?: unknown[];
    };
    const playlists = Array.isArray(hdr?.state?.playlists)
      ? hdr.state.playlists.map((pl: any) => ({ ...pl, tracks: Array.isArray(pl.tracks) ? pl.tracks : [] }))
      : [];
    return {
      version: manifest.storeVersion,
      state: {
        ...(hdr?.state ?? {}),
        liked: Array.isArray(hdr?.previewLiked) ? hdr.previewLiked : [],
        history: Array.isArray(hdr?.previewHistory) ? hdr.previewHistory : [],
        playlists,
      },
    };
  }
  if (manifest.kind === "journal") {
    const hdr = manifest.header as { previewEntries?: unknown[] };
    return {
      version: manifest.storeVersion,
      state: { entries: Array.isArray(hdr?.previewEntries) ? hdr.previewEntries : [] },
    };
  }
  if (manifest.kind === "inline") {
    return manifest.header;
  }
  return null;
}

/**
 * Synchronous non-blocking read for mobile boot: returns the in-memory hydrated dataset
 * if loaded, otherwise the compact chunk manifest stub, or legacy localStorage JSON.
 */
export function readChunkedManifestSync<T = unknown>(storeKey: string): T | null {
  if (memoryCache.has(storeKey)) {
    return memoryCache.get(storeKey) as T;
  }
  const manifest = readManifestSync(storeKey);
  if (manifest) {
    return reconstructHeaderStub(manifest) as T;
  }
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(storeKey);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

/**
 * Write a dataset cleanly in chunked IndexedDB form. Removes giant single-key `localStorage`
 * copies once persisted cleanly into the manifest + async IndexedDB chunk store.
 */
export async function writeChunkedDataset(storeKey: string, data: unknown): Promise<void> {
  if (data === null || data === undefined) {
    memoryCache.delete(storeKey);
    writeManifestSync(storeKey, null);
    try {
      localStorage?.removeItem(storeKey);
    } catch {
      /* ignore */
    }
    await idbDeletePrefix(`${storeKey}::`);
    return;
  }

  rememberMem(storeKey, data);
  const now = Date.now();
  const prefix = `${storeKey}::`;

  if (isLibraryPayload(data) && data.state) {
    const st = data.state;
    const liked: unknown[] = Array.isArray(st.liked) ? st.liked : [];
    const history: unknown[] = Array.isArray(st.history) ? st.history : [];
    const playlists: Array<Record<string, any>> = Array.isArray(st.playlists) ? st.playlists : [];

    const likedChunks = chunkSlice(liked, TRACK_CHUNK_SIZE);
    const historyChunks = chunkSlice(history, TRACK_CHUNK_SIZE);
    const rows: ChunkRow[] = [];
    const keepKeys = new Set<string>();

    likedChunks.forEach((chunk, p) => {
      const k = `${prefix}liked:p${p}`;
      keepKeys.add(k);
      rows.push({ key: k, data: chunk });
    });
    historyChunks.forEach((chunk, p) => {
      const k = `${prefix}history:p${p}`;
      keepKeys.add(k);
      rows.push({ key: k, data: chunk });
    });

    const plCounts: Record<string, { total: number; pages: number }> = {};
    const plHeaders = playlists.map((pl) => {
      const tracks: unknown[] = Array.isArray(pl.tracks) ? pl.tracks : [];
      const pages = chunkSlice(tracks, TRACK_CHUNK_SIZE);
      const id = String(pl.id ?? "");
      plCounts[id] = { total: tracks.length, pages: pages.length };
      pages.forEach((chunk, p) => {
        const k = `${prefix}pl:${id}:p${p}`;
        keepKeys.add(k);
        rows.push({ key: k, data: chunk });
      });
      return {
        ...pl,
        // Keep tiny playlist preview slice inline only up to 10 tracks; full list lives in chunks.
        tracks: tracks.slice(0, 10),
      };
    });

    const { liked: _l, history: _h, playlists: _p, ...restState } = st;
    const manifest: ChunkManifest = {
      version: 1,
      kind: "library",
      updatedAt: now,
      storeVersion: Number(data.version ?? 1),
      header: {
        state: { ...restState, playlists: plHeaders },
        previewLiked: liked.slice(0, BOOT_PREVIEW_TRACKS),
        previewHistory: history.slice(0, BOOT_PREVIEW_TRACKS),
      },
      counts: {
        liked: liked.length,
        likedPages: likedChunks.length,
        history: history.length,
        historyPages: historyChunks.length,
        playlists: plCounts,
      },
    };
    writeManifestSync(storeKey, manifest);
    // Avoid blocking synchronous localStorage with monolithic library JSON when chunk store persists.
    await idbPutChunks(rows, prefix, keepKeys);
    try {
      localStorage?.removeItem(storeKey);
    } catch {
      /* ignore */
    }
    return;
  }

  if (isJournalPayload(data) && data.state) {
    const entries = Array.isArray(data.state.entries) ? data.state.entries : [];
    const pages = chunkSlice(entries, JOURNAL_CHUNK_SIZE);
    const rows: ChunkRow[] = [];
    const keepKeys = new Set<string>();
    pages.forEach((chunk, p) => {
      const k = `${prefix}journal:p${p}`;
      keepKeys.add(k);
      rows.push({ key: k, data: chunk });
    });
    const manifest: ChunkManifest = {
      version: 1,
      kind: "journal",
      updatedAt: now,
      storeVersion: Number(data.version ?? 0),
      header: { previewEntries: entries.slice(-50) },
      counts: { journal: entries.length, journalPages: pages.length },
    };
    writeManifestSync(storeKey, manifest);
    await idbPutChunks(rows, prefix, keepKeys);
    try {
      localStorage?.removeItem(storeKey);
    } catch {
      /* ignore */
    }
    return;
  }

  let rawJson = "";
  try {
    rawJson = JSON.stringify(data);
  } catch {
    return;
  }

  if (rawJson.length > RAW_TEXT_CHUNK_BYTES) {
    const slices: string[] = [];
    for (let i = 0; i < rawJson.length; i += RAW_TEXT_CHUNK_BYTES) {
      slices.push(rawJson.slice(i, i + RAW_TEXT_CHUNK_BYTES));
    }
    const rows: ChunkRow[] = [];
    const keepKeys = new Set<string>();
    slices.forEach((slice, idx) => {
      const k = `${prefix}raw:p${idx}`;
      keepKeys.add(k);
      rows.push({ key: k, data: slice });
    });
    writeManifestSync(storeKey, {
      version: 1,
      kind: "raw",
      updatedAt: now,
      storeVersion: Number((data as { version?: number }).version ?? 0),
      header: null,
      counts: { rawPages: slices.length },
    });
    await idbPutChunks(rows, prefix, keepKeys);
    try {
      localStorage?.removeItem(storeKey);
    } catch {
      /* ignore */
    }
    return;
  }

  writeManifestSync(storeKey, {
    version: 1,
    kind: "inline",
    updatedAt: now,
    storeVersion: Number((data as { version?: number }).version ?? 0),
    header: data,
  });
}

/**
 * Asynchronous lazy reassembly from chunked IndexedDB storage.
 * Falls back cleanly to legacy monolithic `localStorage` data and upgrades it in-place.
 */
export async function readChunkedDataset<T = unknown>(storeKey: string): Promise<T | null> {
  if (memoryCache.has(storeKey)) {
    return memoryCache.get(storeKey) as T;
  }

  const manifest = readManifestSync(storeKey);
  if (!manifest) {
    try {
      if (typeof localStorage === "undefined") return null;
      const raw = localStorage.getItem(storeKey);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as T;
      rememberMem(storeKey, parsed);
      // Migrate legacy monolithic JSON blob into IndexedDB chunks cleanly.
      void writeChunkedDataset(storeKey, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  if (manifest.kind === "inline") {
    rememberMem(storeKey, manifest.header);
    return manifest.header as T;
  }

  const prefix = `${storeKey}::`;

  if (manifest.kind === "raw") {
    const totalPages = manifest.counts?.rawPages ?? 0;
    const parts: string[] = [];
    for (let p = 0; p < totalPages; p++) {
      const slice = await idbGetChunk<string>(`${prefix}raw:p${p}`);
      if (typeof slice !== "string") break;
      parts.push(slice);
    }
    if (parts.length !== totalPages || parts.length === 0) return null;
    try {
      const parsed = JSON.parse(parts.join("")) as T;
      rememberMem(storeKey, parsed);
      return parsed;
    } catch {
      return null;
    }
  }

  if (manifest.kind === "journal") {
    const pageCount = manifest.counts?.journalPages ?? 0;
    const entries: unknown[] = [];
    for (let p = 0; p < pageCount; p++) {
      const chunk = await idbGetChunk<unknown[]>(`${prefix}journal:p${p}`);
      if (Array.isArray(chunk)) entries.push(...chunk);
    }
    const stub = reconstructHeaderStub(manifest) as { state?: { entries?: unknown[] } };
    const result = {
      version: manifest.storeVersion,
      state: { entries: entries.length > 0 ? entries : (stub?.state?.entries ?? []) },
    } as T;
    rememberMem(storeKey, result);
    return result;
  }

  if (manifest.kind === "library") {
    const hdr = manifest.header as {
      state?: Record<string, any>;
      previewLiked?: unknown[];
      previewHistory?: unknown[];
    };
    const likedPages = manifest.counts?.likedPages ?? 0;
    const historyPages = manifest.counts?.historyPages ?? 0;

    const liked: unknown[] = [];
    for (let p = 0; p < likedPages; p++) {
      const chunk = await idbGetChunk<unknown[]>(`${prefix}liked:p${p}`);
      if (Array.isArray(chunk)) liked.push(...chunk);
    }

    const history: unknown[] = [];
    for (let p = 0; p < historyPages; p++) {
      const chunk = await idbGetChunk<unknown[]>(`${prefix}history:p${p}`);
      if (Array.isArray(chunk)) history.push(...chunk);
    }

    const rawPlaylists: Array<Record<string, any>> = Array.isArray(hdr?.state?.playlists)
      ? hdr.state.playlists
      : [];
    const playlists = await Promise.all(
      rawPlaylists.map(async (pl) => {
        const id = String(pl.id ?? "");
        const pages = manifest.counts?.playlists?.[id]?.pages ?? 0;
        if (pages === 0) return { ...pl, tracks: Array.isArray(pl.tracks) ? pl.tracks : [] };
        const tracks: unknown[] = [];
        for (let p = 0; p < pages; p++) {
          const chunk = await idbGetChunk<unknown[]>(`${prefix}pl:${id}:p${p}`);
          if (Array.isArray(chunk)) tracks.push(...chunk);
        }
        return {
          ...pl,
          tracks: tracks.length > 0 ? tracks : (Array.isArray(pl.tracks) ? pl.tracks : []),
        };
      })
    );

    const result = {
      version: manifest.storeVersion,
      state: {
        ...(hdr?.state ?? {}),
        liked: liked.length > 0 ? liked : (hdr?.previewLiked ?? []),
        history: history.length > 0 ? history : (hdr?.previewHistory ?? []),
        playlists,
      },
    } as T;
    rememberMem(storeKey, result);
    return result;
  }

  return null;
}

/** Lazy paginated reader for a single library section without loading unrelated chunks. */
export async function readLibraryChunkPage<T = unknown>(
  storeKey: string,
  section: "liked" | "history" | "playlist",
  page: number,
  playlistId?: string
): Promise<{ items: T[]; totalPages: number }> {
  const manifest = readManifestSync(storeKey);
  if (!manifest || manifest.kind !== "library") {
    return { items: [], totalPages: 0 };
  }
  const prefix = `${storeKey}::`;
  let totalPages = 0;
  let chunkKey = "";
  if (section === "liked") {
    totalPages = manifest.counts?.likedPages ?? 0;
    chunkKey = `${prefix}liked:p${page}`;
  } else if (section === "history") {
    totalPages = manifest.counts?.historyPages ?? 0;
    chunkKey = `${prefix}history:p${page}`;
  } else if (playlistId) {
    totalPages = manifest.counts?.playlists?.[playlistId]?.pages ?? 0;
    chunkKey = `${prefix}pl:${playlistId}:p${page}`;
  }
  if (!chunkKey || page < 0 || page >= totalPages) {
    return { items: [], totalPages };
  }
  const chunk = await idbGetChunk<T[]>(chunkKey);
  return { items: Array.isArray(chunk) ? chunk : [], totalPages };
}
