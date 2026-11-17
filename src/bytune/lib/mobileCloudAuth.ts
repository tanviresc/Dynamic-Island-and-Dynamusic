/**
 * Direct client-side Supabase Auth & Multi-User Cloud Sync for standalone mobile (Capacitor APK / Web).
 *
 * Keeps multi-user accounts cleanly isolated per userId on-device, shows Onboarding on fresh installs
 * and after Sign Out, syncs `user_data`, `profiles`, and `display_names` directly with Supabase using
 * the shared merge logic in `src/electron/sync-merge.ts`, and supports Google OAuth via Android deep links.
 */
import { createClient, type Session, type SupabaseClient } from "@supabase/supabase-js";
import {
  DISPLAY_NAME_MAX,
  displayNameProblem,
  normalizeDisplayName,
  normalizeUsername,
  passwordProblem,
  usernameProblem,
} from "./account-validators";
import { artworkUrlOk } from "./artwork";
import { OAUTH_REDIRECT, SUPABASE_ANON_KEY, SUPABASE_URL, SYNCED_STORES, syntheticEmail } from "./config";
import {
  readChunkedDataset,
  readChunkedManifestSync,
  writeChunkedDataset,
} from "./mobileChunkedStore";
import {
  DEVICE_SETTINGS_FIELDS,
  mergeArtistMeta,
  mergeLibrary,
  mergeListening,
  mergeListeningHistory,
  mergeRecentSearches,
  mergeSettings,
  mergeSyncMeta,
  stripDeviceSettings,
  type SyncMetaSnapshot,
} from "../../electron/sync-merge";

export type AuthMode = "guest" | "account";

export interface MobileProfile {
  mode: AuthMode;
  userId?: string;
  username?: string;
  pendingUsername?: boolean;
  displayName?: string;
  displayNamePending?: boolean;
  suggestedDisplayName?: string;
  deviceId: string;
  createdAt: number;
}

export interface MobileSessionInfo {
  mode: AuthMode | null;
  userId: string | null;
  username: string | null;
  displayName?: string | null;
  suggestedDisplayName?: string;
  freshInstall: boolean;
  needsUsername?: boolean;
  isNewAccount?: boolean;
}

export interface MobileSyncStatus {
  state: "local" | "idle" | "pending" | "syncing" | "error";
  lastSyncAt: number | null;
  lastError: string | null;
  restoreSeq: number;
  restoredStores: string[];
}

const PROFILE_KEY = "dynamusic:mobile_profile";
const OWNER_KEY = "dynamusic:mobile_owner";
const SYNC_META_KEY = "dynamusic:mobile_sync_meta";
const STORE_PREFIX = "dynamusic:store:";
const ARCHIVE_PREFIX = "dynamusic:archive:";
const SESSION_CACHE_KEY = "dynamusic:store:__auth_session__";

const ACCOUNT_STORES = [
  ...SYNCED_STORES,
  "player",
  "listen-journal",
  "home-engagement",
] as const;

const FORBIDDEN_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const MAX_PAYLOAD_BYTES = 8 * 1024 * 1024;
const PUSH_DEBOUNCE_MS = 5_000;
const RETRY_MS = 30_000;

let client: SupabaseClient | null = null;
let currentSession: Session | null = null;
let carriedName: string | null = null;
let eventSink: ((channel: string, ...args: unknown[]) => void) | null = null;

let queueTail: Promise<unknown> = Promise.resolve();
let syncing = false;
let lastSyncAt: number | null = null;
let lastError: string | null = null;
let restoreSeq = 0;
let restoredStores: string[] = [];
const pushTimers = new Map<string, ReturnType<typeof setTimeout>>();
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let syncMetaMemory: SyncMetaSnapshot = { stores: {} };

interface OAuthWaiter {
  resolve: (info: MobileSessionInfo) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

let oauthWaiter: OAuthWaiter | null = null;
let oauthListenerInstalled = false;

export function setMobileAuthEventSink(sink: (channel: string, ...args: unknown[]) => void): void {
  eventSink = sink;
}

function emitEvent(channel: string, ...args: unknown[]): void {
  try {
    eventSink?.(channel, ...args);
  } catch {
    /* ignore */
  }
}

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = queueTail.catch(() => undefined).then(work);
  queueTail = next;
  return next;
}

function newDeviceId(): string {
  return `mob_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function readJson<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    if (value === null || value === undefined) {
      localStorage.removeItem(key);
    } else {
      localStorage.setItem(key, JSON.stringify(value));
    }
  } catch {
    /* ignore quota errors */
  }
}

function storeKey(name: string): string {
  return `${STORE_PREFIX}${name}`;
}

function archiveKey(ownerId: string, name: string): string {
  const safeOwner = ownerId.replace(/[^A-Za-z0-9_-]/g, "_");
  return `${ARCHIVE_PREFIX}${safeOwner}:${name}`;
}

export function readMobileStore(name: string): unknown {
  return readChunkedManifestSync<unknown>(storeKey(name));
}

export function readMobileStoreAsync(name: string): Promise<unknown> {
  return readChunkedDataset<unknown>(storeKey(name));
}

export function writeMobileStore(name: string, data: unknown, markDirty = true): void {
  void writeChunkedDataset(storeKey(name), data);
  if (markDirty && isSyncedStore(name)) {
    mobileNoteLocalWrite(name);
  }
}

function readProfile(): MobileProfile | null {
  return readJson<MobileProfile>(PROFILE_KEY);
}

function writeProfile(patch: Partial<MobileProfile> & { mode: AuthMode }): MobileProfile {
  const existing = readProfile();
  const next: MobileProfile = {
    deviceId: existing?.deviceId ?? newDeviceId(),
    createdAt: existing?.createdAt ?? Date.now(),
    ...existing,
    ...patch,
  } as MobileProfile;
  writeJson(PROFILE_KEY, next);
  return next;
}

function clearProfile(): void {
  writeJson(PROFILE_KEY, null);
  writeJson(SESSION_CACHE_KEY, null);
}

function getOwner(): string {
  try {
    const saved = localStorage.getItem(OWNER_KEY);
    if (saved) return saved;
  } catch {
    /* ignore */
  }
  const p = readProfile();
  return p?.mode === "account" && p.userId ? p.userId : "guest";
}

function setOwner(next: string): void {
  try {
    localStorage.setItem(OWNER_KEY, next);
  } catch {
    /* ignore */
  }
}

function isSyncedStore(name: string): name is (typeof SYNCED_STORES)[number] {
  return (SYNCED_STORES as readonly string[]).includes(name);
}

function getSupabase(): SupabaseClient {
  if (client) return client;
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      flowType: "pkce",
      detectSessionInUrl: false,
      autoRefreshToken: true,
      persistSession: true,
      storageKey: "dynamusic:sb_auth",
    },
  });
  client.auth.onAuthStateChange((_event, session) => {
    currentSession = session;
  });
  installLifecycleHooks();
  return client;
}

async function ensureLiveSession(): Promise<Session | null> {
  if (currentSession?.access_token && currentSession.user?.id) {
    return currentSession;
  }
  try {
    const { data } = await getSupabase().auth.getSession();
    currentSession = data.session ?? null;
    return currentSession;
  } catch {
    return null;
  }
}

function verifiedUserId(): string | null {
  const profile = readProfile();
  if (profile?.mode !== "account" || !profile.userId) return null;
  if (!currentSession?.user?.id || !currentSession.access_token) return null;
  const expiresAt = typeof currentSession.expires_at === "number" ? currentSession.expires_at * 1000 : 0;
  if (expiresAt && expiresAt <= Date.now()) return null;
  return currentSession.user.id === profile.userId ? currentSession.user.id : null;
}

function sessionInfoFromState(): MobileSessionInfo {
  const profile = readProfile();
  if (!profile) {
    return {
      mode: null,
      userId: null,
      username: null,
      displayName: null,
      freshInstall: false,
      ...(carriedName ? { suggestedDisplayName: carriedName } : {}),
    };
  }
  if (profile.mode === "guest") {
    return {
      mode: "guest",
      userId: null,
      username: null,
      displayName: profile.displayName ?? null,
      freshInstall: false,
    };
  }
  return {
    mode: "account",
    userId: currentSession?.user?.id ?? profile.userId ?? null,
    username: profile.username ?? null,
    displayName: profile.displayName ?? null,
    freshInstall: false,
    needsUsername: profile.pendingUsername === true,
    ...(profile.pendingUsername && profile.suggestedDisplayName
      ? { suggestedDisplayName: profile.suggestedDisplayName }
      : {}),
  };
}

function notifyAuthChanged(info = sessionInfoFromState()): void {
  writeJson(SESSION_CACHE_KEY, info);
  emitEvent("auth:changed", info);
}

function noteRestored(stores: string[]): void {
  if (stores.length === 0) return;
  restoredStores = stores;
  restoreSeq += 1;
  emitEvent("sync:restored", { stores, seq: restoreSeq });
}

function loadSyncMeta(): SyncMetaSnapshot {
  const saved = readJson<SyncMetaSnapshot>(SYNC_META_KEY);
  if (!saved || typeof saved !== "object") return { stores: {} };
  return {
    stores: saved.stores && typeof saved.stores === "object" ? saved.stores : {},
    lastUserId: typeof saved.lastUserId === "string" ? saved.lastUserId : undefined,
  };
}

function saveSyncMeta(meta: SyncMetaSnapshot): void {
  syncMetaMemory = meta;
  writeJson(SYNC_META_KEY, meta);
}

function resetSyncState(userId?: string): void {
  for (const t of pushTimers.values()) clearTimeout(t);
  pushTimers.clear();
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const next: SyncMetaSnapshot = { stores: {}, ...(userId ? { lastUserId: userId } : {}) };
  saveSyncMeta(next);
  lastSyncAt = null;
  lastError = null;
}

function accountProfile(userId: string, patch: Partial<MobileProfile>): MobileProfile {
  carriedName = null;
  const same = readProfile()?.userId === userId;
  return writeProfile({
    ...(same ? {} : { displayName: undefined, displayNamePending: undefined, suggestedDisplayName: undefined }),
    ...patch,
    mode: "account",
    userId,
  });
}

function switchMobileOwner(nextOwner: string, migrateGuest: boolean): void {
  const previous = getOwner();
  if (nextOwner === previous) return;

  if (previous === "guest" && migrateGuest) {
    // Guest created their very first account: keep local stores in place and stamp unsynced
    // so the initial sync pushes them cleanly into the new account.
    const meta = mergeSyncMeta(loadSyncMeta(), syncMetaMemory);
    const now = Date.now();
    for (const name of SYNCED_STORES) {
      if (readMobileStore(name) != null) {
        meta.stores[name] = { syncedAt: 0, changedAt: now };
      }
    }
    meta.lastUserId = nextOwner;
    saveSyncMeta(meta);
  } else {
    for (const name of ACCOUNT_STORES) {
      const local = readMobileStore(name);
      void writeChunkedDataset(archiveKey(previous, name), local);
      const saved = readChunkedManifestSync<any>(archiveKey(nextOwner, name));
      let nextValue = saved;
      if (name === "library") {
        const downloads = (local as { state?: { downloads?: unknown } } | null)?.state?.downloads ?? {};
        nextValue = saved
          ? { state: { ...(saved.state ?? {}), downloads }, version: saved.version ?? 1 }
          : null;
      } else if (name === "settings") {
        const localState = (local as { state?: Record<string, unknown> } | null)?.state ?? {};
        const device = Object.fromEntries(
          DEVICE_SETTINGS_FIELDS.filter((k) => localState[k] !== undefined).map((k) => [k, localState[k]])
        );
        if (saved?.state || Object.keys(device).length > 0) {
          nextValue = { state: { ...(saved?.state ?? {}), ...device }, version: saved?.version ?? 0 };
        }
      }
      void writeChunkedDataset(storeKey(name), nextValue);
    }
  }

  setOwner(nextOwner);
}

/* ------------------------------------------------------------------ */
/* Browser-safe cloud payload sanitization & device stripping         */
/* ------------------------------------------------------------------ */

function isPlainObject(v: unknown): v is Record<string, any> {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function utf8ByteLength(s: string): number {
  return typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
}

function sanitizeCloudPayload(name: string, raw: unknown): { payload: Record<string, any>; sanitized: boolean } | null {
  try {
    const serialized = JSON.stringify(raw);
    if (!serialized || utf8ByteLength(serialized) > MAX_PAYLOAD_BYTES) return null;
  } catch {
    return null;
  }
  if (!isPlainObject(raw) || !isPlainObject(raw.state)) return null;
  for (const key of Object.keys(raw)) {
    if (FORBIDDEN_KEYS.has(key)) return null;
  }

  let sanitized = false;
  const payload = JSON.parse(JSON.stringify(raw)) as { state: Record<string, any>; version?: number };
  const state = payload.state;

  const cleanTracks = (list: unknown): any[] | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) {
      sanitized = true;
      return [];
    }
    const seen = new Set<string>();
    const out: any[] = [];
    for (const item of list) {
      if (
        !isPlainObject(item) ||
        typeof item.id !== "string" ||
        !item.id ||
        FORBIDDEN_KEYS.has(item.id) ||
        seen.has(item.id) ||
        typeof item.title !== "string" ||
        typeof item.artist !== "string" ||
        typeof item.duration !== "number" ||
        !Number.isFinite(item.duration)
      ) {
        sanitized = true;
        continue;
      }
      if (typeof item.thumb === "string" && item.thumb !== "" && !artworkUrlOk(item.thumb)) {
        item.thumb = "";
        sanitized = true;
      } else if (typeof item.thumb !== "string") {
        item.thumb = "";
        sanitized = true;
      }
      seen.add(item.id);
      out.push(item);
    }
    return out;
  };

  if (name === "library") {
    if ("downloads" in state) {
      delete state.downloads;
      sanitized = true;
    }
    if (state.liked !== undefined) state.liked = cleanTracks(state.liked);
    if (state.history !== undefined) state.history = cleanTracks(state.history);
    if (Array.isArray(state.playlists)) {
      const cleaned: any[] = [];
      for (const pl of state.playlists) {
        if (!isPlainObject(pl) || typeof pl.id !== "string" || !pl.id || FORBIDDEN_KEYS.has(pl.id)) {
          sanitized = true;
          continue;
        }
        cleaned.push({ ...pl, tracks: cleanTracks(pl.tracks) ?? [] });
      }
      state.playlists = cleaned;
    }
  } else if (name === "settings") {
    for (const field of DEVICE_SETTINGS_FIELDS) {
      if (field in state) {
        delete state[field];
        sanitized = true;
      }
    }
  }

  return { payload, sanitized };
}

const idOf = (item: unknown): unknown => (item as { id?: unknown } | null)?.id;
const isLocalTrack = (t: unknown): boolean => typeof idOf(t) === "string" && (idOf(t) as string).startsWith("local:");
const tracksOf = (p: unknown): unknown[] => {
  const list = (p as { tracks?: unknown } | null)?.tracks;
  return Array.isArray(list) ? list : [];
};
const staysOnDevice = (p: unknown): boolean => tracksOf(p).length > 0 && tracksOf(p).every(isLocalTrack);

function withoutPath(track: unknown): unknown {
  if (!track || typeof track !== "object" || !("localPath" in track)) return track;
  const { localPath: _path, ...rest } = track as Record<string, unknown>;
  return rest;
}

function stripForUpload(name: string, data: unknown): unknown {
  if (!isPlainObject(data) || !isPlainObject(data.state)) return data;
  if (name === "library") {
    const { downloads: _drop, ...keep } = data.state;
    const stripTracks = (list: unknown): unknown => (Array.isArray(list) ? list.map(withoutPath) : list);
    return {
      ...data,
      state: {
        ...keep,
        liked: stripTracks(keep.liked),
        history: stripTracks(keep.history),
        playlists: Array.isArray(keep.playlists)
          ? keep.playlists
              .filter((p) => !staysOnDevice(p))
              .map((p) => {
                if (!isPlainObject(p)) return p;
                const { device: _device, ...rest } = p;
                return { ...rest, tracks: tracksOf(p).filter((t) => !isLocalTrack(t)).map(withoutPath) };
              })
          : keep.playlists,
      },
    };
  }
  if (name === "settings") return stripDeviceSettings(data);
  return data;
}

function localDeviceState(name: string): Record<string, unknown> {
  const local = readMobileStore(name) as { state?: Record<string, unknown> } | null;
  const state = local?.state ?? {};
  if (name === "library") return state.downloads ? { downloads: state.downloads } : {};
  if (name === "settings") {
    const device: Record<string, unknown> = {};
    for (const f of DEVICE_SETTINGS_FIELDS) {
      if (state[f] !== undefined) device[f] = state[f];
    }
    return device;
  }
  return {};
}

function withDeviceState(name: string, remote: unknown, device: Record<string, unknown>): unknown {
  if (Object.keys(device).length === 0) return remote;
  if (isPlainObject(remote) && isPlainObject(remote.state)) {
    return { ...remote, state: { ...remote.state, ...device } };
  }
  return remote;
}

function withoutKey(envelope: unknown, key: string): unknown {
  if (!isPlainObject(envelope) || !isPlainObject(envelope.state) || !(key in envelope.state)) return envelope;
  const { [key]: _drop, ...state } = envelope.state;
  return { ...envelope, state };
}

function mergeStore(name: string, local: unknown, remote: unknown): unknown | null {
  switch (name) {
    case "library":
      return mergeLibrary(local, remote, localDeviceState("library"));
    case "settings":
      return mergeSettings(local, remote, localDeviceState("settings"));
    case "recent-searches":
      return mergeRecentSearches(local, remote);
    case "listening-signals":
      return mergeListening(local, remote);
    case "listening-history":
      return mergeListeningHistory(local, remote);
    case "artist-meta-cache":
      return mergeArtistMeta(local, remote);
    default:
      return null;
  }
}

/* ------------------------------------------------------------------ */
/* Display names & Profiles                                           */
/* ------------------------------------------------------------------ */

async function fetchDisplayName(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase().from("display_names").select("name").eq("user_id", userId).maybeSingle();
  if (error) throw new Error(error.message);
  return typeof data?.name === "string" ? data.name : null;
}

async function pushDisplayName(userId: string, name: string): Promise<void> {
  const { error } = await getSupabase().from("display_names").upsert({ user_id: userId, name });
  if (error) throw new Error(error.message);
}

async function fetchUsernameForUser(userId: string): Promise<string | null> {
  const { data, error } = await getSupabase().from("profiles").select("username").eq("id", userId).maybeSingle();
  if (error) return null;
  return typeof data?.username === "string" ? data.username : null;
}

async function claimDisplayName(userId: string, name: string): Promise<void> {
  let pending = false;
  try {
    await pushDisplayName(userId, name);
  } catch {
    pending = true;
  }
  const p = readProfile();
  if (p?.mode === "account" && p.userId === userId) {
    writeProfile({ mode: "account", displayName: name, displayNamePending: pending || undefined, suggestedDisplayName: undefined });
  }
}

async function syncDisplayName(): Promise<boolean> {
  const p = readProfile();
  const userId = verifiedUserId();
  if (p?.mode !== "account" || !userId) return false;
  try {
    if (p.displayNamePending && p.displayName) {
      await pushDisplayName(userId, p.displayName);
      writeProfile({ mode: "account", displayNamePending: undefined });
      return false;
    }
    const remote = await fetchDisplayName(userId);
    if ((remote ?? undefined) === p.displayName) return false;
    writeProfile({ mode: "account", displayName: remote ?? undefined });
    return true;
  } catch {
    return false;
  }
}

async function usernameAvailableRaw(username: string, currentUserId: string | null): Promise<boolean> {
  const clean = normalizeUsername(username);
  const { data, error } = await getSupabase().from("profiles").select("id").eq("username", clean).maybeSingle();
  if (error) throw new Error(error.message);
  return data == null || (currentUserId != null && data.id === currentUserId);
}

/* ------------------------------------------------------------------ */
/* Cloud Sync Engine                                                  */
/* ------------------------------------------------------------------ */

async function pushStore(name: string, userId: string): Promise<void> {
  const data = readMobileStore(name);
  if (data == null) return;
  const { error } = await getSupabase().from("user_data").upsert(
    {
      user_id: userId,
      store_name: name,
      payload: stripForUpload(name, data),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id,store_name" }
  );
  if (error) throw new Error(error.message);
  const meta = mergeSyncMeta(loadSyncMeta(), syncMetaMemory);
  const now = Date.now();
  meta.stores[name] = { syncedAt: now, changedAt: now };
  saveSyncMeta(meta);
  lastSyncAt = now;
  lastError = null;
}

function scheduleRetry(): void {
  if (retryTimer) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    void flushMobilePendingSync();
  }, RETRY_MS);
}

export function mobileNoteLocalWrite(name: string): void {
  if (!isSyncedStore(name)) return;
  const profile = readProfile();
  if (profile?.mode !== "account") return;

  const meta = mergeSyncMeta(loadSyncMeta(), syncMetaMemory);
  const prev = meta.stores[name];
  meta.stores[name] = { syncedAt: prev?.syncedAt ?? 0, changedAt: Date.now() };
  saveSyncMeta(meta);

  const existing = pushTimers.get(name);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    pushTimers.delete(name);
    void serialize(async () => {
      await ensureLiveSession();
      const uid = verifiedUserId();
      if (!uid) return;
      try {
        await pushStore(name, uid);
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        scheduleRetry();
      }
    });
  }, PUSH_DEBOUNCE_MS);
  pushTimers.set(name, timer);
}

async function flushMobilePendingSync(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  const pendingNames = [...pushTimers.keys()];
  for (const [, timer] of pushTimers) clearTimeout(timer);
  pushTimers.clear();
  if (pendingNames.length === 0) return;

  await ensureLiveSession();
  const uid = verifiedUserId();
  if (!uid) return;
  for (const name of pendingNames) {
    try {
      await pushStore(name, uid);
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
      scheduleRetry();
    }
  }
}

async function syncNowExclusive(): Promise<{ pushed: string[]; pulled: string[]; merged: string[] }> {
  await ensureLiveSession();
  const userId = verifiedUserId();
  if (!userId || syncing) return { pushed: [], pulled: [], merged: [] };
  syncing = true;
  const restored = new Set<string>();
  try {
    const { data: rows, error } = await getSupabase()
      .from("user_data")
      .select("store_name,payload,updated_at")
      .eq("user_id", userId);
    if (error) throw new Error("Cloud backup could not be read.");

    let meta = mergeSyncMeta(loadSyncMeta(), syncMetaMemory);
    if (meta.lastUserId && meta.lastUserId !== userId) {
      for (const name of SYNCED_STORES) {
        writeMobileStore(name, null, false);
        restored.add(name);
        delete meta.stores[name];
      }
    }
    meta.lastUserId = userId;
    saveSyncMeta(meta);

    const cloud = new Map<string, { payload: unknown; updatedAt: number; sanitized: boolean }>();
    for (const row of rows ?? []) {
      const storeName = String((row as any).store_name ?? "");
      if (!isSyncedStore(storeName)) continue;
      const checked = sanitizeCloudPayload(storeName, (row as any).payload);
      if (!checked) continue;
      cloud.set(storeName, {
        payload: checked.payload,
        updatedAt: new Date(String((row as any).updated_at)).getTime() || Date.now(),
        sanitized: checked.sanitized,
      });
    }

    const pushed: string[] = [];
    const pulled: string[] = [];
    const merged: string[] = [];
    for (const name of SYNCED_STORES) {
      const local = readMobileStore(name);
      const m = meta.stores[name] ?? { syncedAt: 0, changedAt: 0 };
      const remoteRow = cloud.get(name);
      const localChanged = local != null && (m.changedAt > m.syncedAt || m.syncedAt === 0);
      const remoteChanged = remoteRow != null && remoteRow.updatedAt > m.syncedAt;

      if (local == null && remoteRow) {
        writeMobileStore(name, remoteRow.payload, false);
        restored.add(name);
        meta.stores[name] = { syncedAt: remoteRow.updatedAt, changedAt: remoteRow.updatedAt };
        pulled.push(name);
        if (remoteRow.sanitized) await pushStore(name, userId);
        continue;
      }
      if (local == null || !remoteRow) {
        if (local != null) {
          await pushStore(name, userId);
          pushed.push(name);
        }
        continue;
      }
      if (remoteChanged && localChanged) {
        const firstSettings = name === "settings" && m.syncedAt === 0 && isPlainObject(local);
        const localForMerge = firstSettings ? withoutKey(local, "autoplay") : local;
        const mergedEnvelope = mergeStore(name, localForMerge, remoteRow.payload);
        const next = mergedEnvelope ?? (remoteRow.updatedAt > m.syncedAt ? remoteRow.payload : local);
        writeMobileStore(name, next, false);
        restored.add(name);
        await pushStore(name, userId);
        const now = Date.now();
        meta.stores[name] = { syncedAt: now, changedAt: now };
        merged.push(name);
        continue;
      }
      if (remoteChanged) {
        const payload = withDeviceState(name, remoteRow.payload, localDeviceState(name));
        writeMobileStore(name, payload, false);
        restored.add(name);
        meta.stores[name] = { syncedAt: remoteRow.updatedAt, changedAt: remoteRow.updatedAt };
        pulled.push(name);
        if (remoteRow.sanitized) await pushStore(name, userId);
        continue;
      }
      if (localChanged) {
        await pushStore(name, userId);
        pushed.push(name);
      }
    }

    saveSyncMeta(meta);
    lastSyncAt = Date.now();
    lastError = null;
    return { pushed, pulled, merged };
  } catch (err) {
    lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    syncing = false;
    noteRestored([...restored]);
  }
}

export function mobileSyncNow(): Promise<{ pushed: string[]; pulled: string[]; merged: string[] }> {
  return serialize(syncNowExclusive);
}

export function mobileSyncBackupNow(): Promise<void> {
  return serialize(async () => {
    await ensureLiveSession();
    const uid = verifiedUserId();
    if (!uid) throw new Error("Sign in first.");
    for (const name of SYNCED_STORES) {
      await pushStore(name, uid);
    }
    lastSyncAt = Date.now();
    lastError = null;
  });
}

export function mobileSyncRestoreNow(): Promise<string[]> {
  return serialize(async () => {
    await ensureLiveSession();
    const uid = verifiedUserId();
    if (!uid) throw new Error("Sign in first.");
    const { data: rows, error } = await getSupabase()
      .from("user_data")
      .select("store_name,payload")
      .eq("user_id", uid);
    if (error) throw new Error("Cloud backup could not be read.");
    const pulled: string[] = [];
    const meta = mergeSyncMeta(loadSyncMeta(), syncMetaMemory);
    try {
      for (const row of rows ?? []) {
        const name = String((row as any).store_name ?? "");
        if (!isSyncedStore(name)) continue;
        const checked = sanitizeCloudPayload(name, (row as any).payload);
        if (!checked) continue;
        const payload = withDeviceState(name, checked.payload, localDeviceState(name));
        writeMobileStore(name, payload, false);
        pulled.push(name);
        const now = Date.now();
        meta.stores[name] = { syncedAt: now, changedAt: now };
        if (checked.sanitized) await pushStore(name, uid);
      }
      saveSyncMeta(meta);
      lastSyncAt = Date.now();
      lastError = null;
      return pulled;
    } finally {
      noteRestored(pulled);
    }
  });
}

export function mobileSyncStatus(): MobileSyncStatus {
  const profile = readProfile();
  if (profile?.mode !== "account") {
    return { state: "local", lastSyncAt: null, lastError: null, restoreSeq, restoredStores };
  }
  const pending =
    pushTimers.size > 0 ||
    SYNCED_STORES.some((n) => {
      const m = syncMetaMemory.stores[n];
      return m != null && m.changedAt > m.syncedAt;
    });
  const state: MobileSyncStatus["state"] = syncing
    ? "syncing"
    : lastError
      ? "error"
      : pending
        ? "pending"
        : "idle";
  return { state, lastSyncAt, lastError, restoreSeq, restoredStores };
}

/* ------------------------------------------------------------------ */
/* Google OAuth deep-link handling (Android + Browser)                */
/* ------------------------------------------------------------------ */

function clearOAuthWaiter(): void {
  if (oauthWaiter) {
    clearTimeout(oauthWaiter.timer);
    oauthWaiter = null;
  }
}

async function completeGoogleCode(code: string): Promise<MobileSessionInfo> {
  const { data, error } = await getSupabase().auth.exchangeCodeForSession(code);
  if (error || !data.session || !data.user) {
    throw new Error(error?.message ?? "Google sign-in didn't complete.");
  }
  currentSession = data.session;
  const userId = data.user.id;

  let username = (data.user.user_metadata?.user_name ?? data.user.user_metadata?.name ?? "")
    .toString()
    .replace(/[^a-zA-Z0-9]/g, "")
    .toLowerCase()
    .slice(0, 20);
  if (username.length < 3) username = `user${userId.slice(0, 8).replace(/[^a-z0-9]/g, "")}`;

  const { data: existing } = await getSupabase().from("profiles").select("username").eq("id", userId).maybeSingle();
  let isNewAccount = false;
  let needsUsername = false;
  let suggested: string | undefined;

  if (!existing) {
    isNewAccount = true;
    needsUsername = true;
    let finalName = username;
    for (let i = 0; i < 5 && !(await usernameAvailableRaw(finalName, null)); i++) {
      finalName = `${username}${Math.random().toString(36).replace(/[^a-z0-9]/g, "").slice(2, 6)}`;
    }
    await getSupabase().from("profiles").insert({ id: userId, username: finalName });
    username = finalName;
    const meta = data.user.user_metadata ?? {};
    const fromGoogle = normalizeDisplayName(
      [...normalizeDisplayName(String(meta.full_name ?? meta.name ?? ""))].slice(0, DISPLAY_NAME_MAX).join("")
    );
    suggested = carriedName ?? (fromGoogle || undefined);
    accountProfile(userId, { username, pendingUsername: true, suggestedDisplayName: suggested });
  } else {
    username = existing.username;
    accountProfile(userId, { username });
  }

  return serialize(async () => {
    const previous = getOwner();
    const migrateGuest = previous === "guest" && isNewAccount;
    switchMobileOwner(userId, migrateGuest);
    if (previous !== userId) resetSyncState(userId);
    await syncDisplayName();
    await syncNowExclusive().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
    });
    noteRestored([...SYNCED_STORES]);
    const info: MobileSessionInfo = {
      mode: "account",
      userId,
      username,
      displayName: readProfile()?.displayName ?? null,
      freshInstall: false,
      needsUsername,
      isNewAccount,
      ...(suggested ? { suggestedDisplayName: suggested } : {}),
    };
    notifyAuthChanged(info);
    return info;
  });
}

function handleIncomingOAuthUrl(rawUrl: string): void {
  if (!oauthWaiter || !rawUrl) return;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return;
  }
  const redirect = new URL(OAUTH_REDIRECT);
  if (
    parsed.protocol !== redirect.protocol ||
    parsed.hostname !== redirect.hostname ||
    parsed.pathname.replace(/\/+$/, "") !== redirect.pathname.replace(/\/+$/, "")
  ) {
    return;
  }
  const waiter = oauthWaiter;
  clearOAuthWaiter();
  const code = parsed.searchParams.get("code");
  if (!code) {
    waiter.reject(new Error(parsed.searchParams.get("error_description") ?? "Google sign-in didn't complete."));
    return;
  }
  void completeGoogleCode(code).then(waiter.resolve, waiter.reject);
}

function ensureOAuthListeners(): void {
  if (oauthListenerInstalled || typeof window === "undefined") return;
  oauthListenerInstalled = true;
  window.addEventListener("dynamusic:oauth-callback", (ev) => {
    const url = (ev as CustomEvent<{ url?: string }>).detail?.url;
    if (url) handleIncomingOAuthUrl(url);
  });
  window.addEventListener("focus", () => {
    void checkPendingAndroidOAuth();
  });
}

async function checkPendingAndroidOAuth(): Promise<void> {
  try {
    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { MediaKeepalive?: { takePendingOAuthUrl?: () => Promise<{ url?: string }> } } };
    }).Capacitor;
    const res = await cap?.Plugins?.MediaKeepalive?.takePendingOAuthUrl?.();
    if (res?.url) handleIncomingOAuthUrl(res.url);
  } catch {
    /* ignore */
  }
}

let lifecycleInstalled = false;
function installLifecycleHooks(): void {
  if (lifecycleInstalled || typeof window === "undefined") return;
  lifecycleInstalled = true;
  const flush = (): void => {
    void serialize(() => flushMobilePendingSync());
  };
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/* ------------------------------------------------------------------ */
/* Public Auth Methods (ByTuneApi compatible)                         */
/* ------------------------------------------------------------------ */

export async function mobileAuthGetSession(): Promise<MobileSessionInfo> {
  await ensureLiveSession();
  const info = sessionInfoFromState();
  writeJson(SESSION_CACHE_KEY, info);
  return info;
}

/**
 * Synchronous cached session read for zero-block mobile startup (< 200ms first paint).
 * Never touches network/Supabase locks; async `mobileAuthGetSession()` reconciles afterward.
 */
export function readCachedMobileSessionSync(): MobileSessionInfo | null {
  if (typeof localStorage === "undefined") return null;
  const cached = readJson<MobileSessionInfo>(SESSION_CACHE_KEY);
  const profile = readProfile();
  if (profile) {
    const info = sessionInfoFromState();
    if (info.mode !== null) return info;
  }
  if (cached && cached.mode !== null) return cached;
  return null;
}

export async function mobileAuthUsernameAvailable(
  username: string
): Promise<{ available: boolean | null; reason?: string }> {
  const clean = normalizeUsername(username);
  const problem = usernameProblem(clean);
  if (problem) return { available: false, reason: problem };
  try {
    return { available: await usernameAvailableRaw(clean, readProfile()?.userId ?? null) };
  } catch (err) {
    return { available: null, reason: err instanceof Error ? err.message : "Network error" };
  }
}

export async function mobileAuthSignUp(
  username: string,
  password: string,
  displayName: string
): Promise<MobileSessionInfo> {
  mobileAuthCancelGoogle();
  const clean = normalizeUsername(username);
  const name = normalizeDisplayName(displayName);
  const problem = usernameProblem(clean) ?? passwordProblem(password) ?? displayNameProblem(name);
  if (problem) throw new Error(problem);
  if (!(await usernameAvailableRaw(clean, null))) throw new Error("That username is already taken.");

  const { data, error } = await getSupabase().auth.signUp({
    email: syntheticEmail(clean),
    password,
  });
  if (error) throw new Error(error.message);
  const userId = data.user?.id;
  if (!userId) throw new Error("Sign-up failed — no user returned.");

  const { error: pErr } = await getSupabase().from("profiles").insert({ id: userId, username: clean });
  if (pErr) throw new Error(pErr.message);

  if (!data.session) {
    throw new Error(
      "Account created but email confirmation is enabled in Supabase. Disable 'Confirm email' in Authentication."
    );
  }
  currentSession = data.session;

  return serialize(async () => {
    const previous = getOwner();
    accountProfile(userId, { username: clean });
    await claimDisplayName(userId, name);
    switchMobileOwner(userId, previous === "guest");
    if (previous !== userId) resetSyncState(userId);
    await syncNowExclusive().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
    });
    noteRestored([...SYNCED_STORES]);
    const info: MobileSessionInfo = {
      mode: "account",
      userId,
      username: clean,
      displayName: name,
      freshInstall: false,
      isNewAccount: true,
    };
    notifyAuthChanged(info);
    return info;
  });
}

export async function mobileAuthSignIn(username: string, password: string): Promise<MobileSessionInfo> {
  mobileAuthCancelGoogle();
  const clean = normalizeUsername(username);
  if (!clean || !password) throw new Error("Enter your username and password.");
  const { data, error } = await getSupabase().auth.signInWithPassword({
    email: syntheticEmail(clean),
    password,
  });
  if (error || !data.session || !data.user) throw new Error("Wrong username or password.");
  currentSession = data.session;
  const userId = data.user.id;
  const profileUsername = (await fetchUsernameForUser(userId)) ?? clean;

  return serialize(async () => {
    const previous = getOwner();
    accountProfile(userId, { username: profileUsername });
    switchMobileOwner(userId, false);
    if (previous !== userId) resetSyncState(userId);
    await syncDisplayName();
    await syncNowExclusive().catch((err) => {
      lastError = err instanceof Error ? err.message : String(err);
    });
    noteRestored([...SYNCED_STORES]);
    const info: MobileSessionInfo = {
      mode: "account",
      userId,
      username: profileUsername,
      displayName: readProfile()?.displayName ?? null,
      freshInstall: false,
      isNewAccount: false,
    };
    notifyAuthChanged(info);
    return info;
  });
}

export async function mobileAuthSignInGoogle(): Promise<MobileSessionInfo> {
  mobileAuthCancelGoogle();
  ensureOAuthListeners();

  const { data, error } = await getSupabase().auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: OAUTH_REDIRECT,
      skipBrowserRedirect: true,
      queryParams: { prompt: "select_account" },
    },
  });
  if (error || !data?.url) throw new Error(error?.message ?? "Could not start Google sign-in.");

  return new Promise<MobileSessionInfo>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (oauthWaiter?.resolve === resolve) {
        clearOAuthWaiter();
        reject(new Error("Google sign-in timed out. Please try again."));
      }
    }, 5 * 60 * 1000);
    oauthWaiter = { resolve, reject, timer };

    const cap = (window as unknown as {
      Capacitor?: { Plugins?: { MediaKeepalive?: { openExternal?: (opts: { url: string }) => Promise<void> } } };
    }).Capacitor;
    const openExternal = cap?.Plugins?.MediaKeepalive?.openExternal;
    if (openExternal) {
      void openExternal({ url: data.url }).catch((err) => {
        if (oauthWaiter?.resolve !== resolve) return;
        clearOAuthWaiter();
        reject(err instanceof Error ? err : new Error("Could not open browser."));
      });
    } else {
      window.open(data.url, "_blank", "noopener");
    }
  });
}

export function mobileAuthCancelGoogle(): boolean {
  if (oauthWaiter) {
    const { reject } = oauthWaiter;
    clearOAuthWaiter();
    reject(new Error("Google sign-in cancelled."));
  }
  return true;
}

export async function mobileAuthContinueGuest(displayName?: string): Promise<MobileSessionInfo> {
  mobileAuthCancelGoogle();
  const given = normalizeDisplayName(displayName ?? "");
  const problem = given ? displayNameProblem(given) : null;
  if (problem) throw new Error(problem);

  return serialize(async () => {
    try {
      await getSupabase().auth.signOut();
    } catch {
      /* offline */
    }
    currentSession = null;
    switchMobileOwner("guest", false);
    resetSyncState();
    const was = readProfile();
    const kept = was?.mode === "guest" ? was.displayName : (carriedName ?? undefined);
    const profile = writeProfile({
      mode: "guest",
      displayName: given || kept,
      displayNamePending: undefined,
      suggestedDisplayName: undefined,
    });
    carriedName = null;
    noteRestored([...SYNCED_STORES]);
    const info: MobileSessionInfo = {
      mode: "guest",
      userId: null,
      username: null,
      displayName: profile.displayName ?? null,
      freshInstall: false,
    };
    notifyAuthChanged(info);
    return info;
  });
}

export function mobileAuthClearGuestProfile(): Promise<void> {
  const profile = readProfile();
  if (profile?.mode === "guest") {
    carriedName = profile.displayName ?? null;
    clearProfile();
  }
  return Promise.resolve();
}

export async function mobileAuthSetUsername(username: string, displayName?: string): Promise<MobileSessionInfo> {
  const clean = normalizeUsername(username);
  const name = displayName === undefined ? null : normalizeDisplayName(displayName);
  const problem = usernameProblem(clean) ?? (name === null ? null : displayNameProblem(name));
  if (problem) throw new Error(problem);

  await ensureLiveSession();
  const profile = readProfile();
  const userId = currentSession?.user?.id ?? profile?.userId ?? null;
  if (profile?.mode !== "account" || !userId) throw new Error("Sign in first.");
  if (!(await usernameAvailableRaw(clean, userId))) throw new Error("That username is already in use.");

  const { error } = await getSupabase().from("profiles").update({ username: clean }).eq("id", userId);
  if (error) throw new Error(error.message);
  writeProfile({ mode: "account", username: clean, pendingUsername: false });
  if (name !== null) await claimDisplayName(userId, name);
  const info = sessionInfoFromState();
  notifyAuthChanged(info);
  return info;
}

export async function mobileAuthSkipUsername(displayName?: string): Promise<MobileSessionInfo> {
  const profile = readProfile();
  if (profile?.mode === "account" && profile.pendingUsername) {
    writeProfile({ mode: "account", pendingUsername: false, suggestedDisplayName: undefined });
    const name = normalizeDisplayName(displayName ?? "");
    if (profile.userId && !displayNameProblem(name)) await claimDisplayName(profile.userId, name);
  }
  const info = sessionInfoFromState();
  notifyAuthChanged(info);
  return info;
}

export async function mobileAuthSetDisplayName(raw: string): Promise<MobileSessionInfo> {
  const name = normalizeDisplayName(raw);
  const problem = displayNameProblem(name);
  if (problem) throw new Error(problem);

  const profile = readProfile();
  if (profile?.mode === "guest") {
    writeProfile({ mode: "guest", displayName: name });
    const info = sessionInfoFromState();
    notifyAuthChanged(info);
    return info;
  }

  await ensureLiveSession();
  const userId = verifiedUserId();
  if (profile?.mode !== "account" || !userId) throw new Error("Sign in again to change your display name.");
  await pushDisplayName(userId, name);
  writeProfile({ mode: "account", displayName: name, displayNamePending: undefined });
  const info = sessionInfoFromState();
  notifyAuthChanged(info);
  return info;
}

export async function mobileAuthSignOut(): Promise<MobileSessionInfo> {
  return serialize(async () => {
    await flushMobilePendingSync();
    await Promise.race([
      syncNowExclusive().catch((err) => {
        lastError = err instanceof Error ? err.message : String(err);
      }),
      new Promise<void>((r) => setTimeout(r, 6000)),
    ]);

    try {
      await getSupabase().auth.signOut();
    } catch {
      /* offline — clear locally anyway */
    }
    currentSession = null;
    clearProfile();
    switchMobileOwner("guest", false);
    resetSyncState();
    noteRestored([...SYNCED_STORES]);
    const info: MobileSessionInfo = {
      mode: null,
      userId: null,
      username: null,
      displayName: null,
      freshInstall: false,
    };
    notifyAuthChanged(info);
    return info;
  });
}

export function resetMobileDataStores(): void {
  for (const name of ACCOUNT_STORES) {
    void writeChunkedDataset(storeKey(name), null);
  }
  clearProfile();
  resetSyncState();
  setOwner("guest");
  noteRestored([...SYNCED_STORES]);
  notifyAuthChanged({ mode: null, userId: null, username: null, displayName: null, freshInstall: false });
}

