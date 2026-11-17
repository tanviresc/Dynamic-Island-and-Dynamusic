/**
 * Direct standalone fallback for Mobile when not paired with a PC sidecar
 * (cellular data, external Wi-Fi, or standalone offline-first APK).
 *
 * Streams route through the native Android MobileStreamProxy, YouTube Music
 * search/browse/artist/album/playlist/home/radio/charts/moods route through
 * native MobileYtmClient parsed by pure TypeScript parsers from `src/electron/ytm.ts`,
 * and lyrics race native LyricsPlus + LRCLIB + YTM Lyrics tab with a CORS
 * LRCLIB web backup.
 */
import { stripSingerPrefix } from "./lyricsLines";
import type {
  Album,
  Artist,
  ArtistPageData,
  HomeShelf,
  LyricsResult,
  MoodPage,
  PlaylistCard,
  RadioPage,
  RemotePlaylistPage,
  SearchPageResult,
  SearchResults,
  SearchRow,
  SearchSuggestion,
  SyncedLyricLine,
  TopResult,
  Track,
} from "../types";
import {
  SEARCH_FILTER_PARAMS,
  browseToAlbum,
  browseToArtist,
  pageCredit,
  parseArtistPage,
  parseChartsShelves,
  parseMoodCovers,
  parseMoodPage,
  parseMoods,
  parsePlaylistContinuation,
  parsePlaylistShelf,
  parseRadioPage,
  parseReleasePage,
  parseRemotePlaylistPage,
  parseSearchPage,
  parseSearchSuggestions,
  withSearchRows,
  type ParsedMood,
  type ParsedSong,
} from "../../electron/ytm";

const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.kavin.rocks",
];

const INVIDIOUS_INSTANCES = [
  "https://inv.nadeko.net",
  "https://invidious.nerdvpn.de",
  "https://yewtu.be",
];

const STREAM_TIMEOUT_MS = 3_500;
const LYRICS_TIMEOUT_MS = 3_500;
const mirrorCooldownUntil = new Map<string, number>();

function healthyMirrors(hosts: string[]): string[] {
  const now = Date.now();
  const ready = hosts.filter((h) => (mirrorCooldownUntil.get(h) ?? 0) <= now);
  return ready.length > 0 ? ready : hosts;
}

function noteMirrorHealth(host: string, ok: boolean): void {
  if (ok) {
    mirrorCooldownUntil.delete(host);
  } else {
    mirrorCooldownUntil.set(host, Date.now() + 45_000);
  }
}

async function fetchWithAbort(url: string, timeoutMs = STREAM_TIMEOUT_MS): Promise<Response> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: ctl.signal });
  } finally {
    clearTimeout(timer);
  }
}

function extractVideoId(urlOrId: string | undefined): string {
  if (!urlOrId) return "";
  if (/^[A-Za-z0-9_-]{11}$/.test(urlOrId)) return urlOrId;
  const m = /[?&]v=([A-Za-z0-9_-]{11})/.exec(urlOrId) || /\/watch\?v=([A-Za-z0-9_-]{11})/.exec(urlOrId);
  return m ? m[1] : "";
}

export interface MobileStreamOptions {
  forceRotate?: boolean;
  quality?: string;
  title?: string;
  artist?: string;
}

interface NativeMediaKeepaliveBridge {
  resolveStream?: (opts: {
    videoId: string;
    forceRotate?: boolean;
    quality?: string;
    title?: string;
    artist?: string;
  }) => Promise<{ proxyUrl?: string; upstreamUrl?: string; mime?: string; lufs?: number }>;
  ytmRequest?: (opts: {
    endpoint: string;
    body?: Record<string, unknown>;
  }) => Promise<{ raw?: string }>;
  resolveLyrics?: (opts: {
    videoId: string;
    title: string;
    artist: string;
    album?: string;
    duration?: number;
  }) => Promise<{
    found?: boolean;
    source?: string;
    wordSynced?: boolean;
    synced?: SyncedLyricLine[] | null;
    plain?: string | null;
  }>;
}

function getNativeKeepalive(): NativeMediaKeepaliveBridge | null {
  const cap = (
    globalThis as { Capacitor?: { Plugins?: { MediaKeepalive?: NativeMediaKeepaliveBridge } } }
  )?.Capacitor;
  return cap?.Plugins?.MediaKeepalive ?? null;
}

async function ytmCall(endpoint: string, body: Record<string, unknown> = {}): Promise<unknown> {
  const plugin = getNativeKeepalive();
  if (typeof plugin?.ytmRequest !== "function") {
    throw new Error("Native YTM bridge unavailable");
  }
  const res = await plugin.ytmRequest({ endpoint, body });
  if (!res?.raw) throw new Error(`Empty YTM response for ${endpoint}`);
  return JSON.parse(res.raw);
}

/** Rank audio streams, preferring MP4/AAC within requested bitrate cap before WebM/Opus. */
export function pickBestPipedAudioUrl(
  audioStreams: { url?: string; bitrate?: number; mimeType?: string }[],
  quality?: string
): string | null {
  const maxBps = quality === "low" ? 64_000 : quality === "medium" ? 160_000 : Number.POSITIVE_INFINITY;
  const valid = audioStreams.filter((s) => typeof s.url === "string" && s.url.startsWith("https://"));
  if (!valid.length) return null;

  const sortByScore = (list: typeof valid) =>
    [...list].sort((a, b) => {
      const aMp4 = (a.mimeType ?? "").toLowerCase().includes("audio/mp4") ? 1 : 0;
      const bMp4 = (b.mimeType ?? "").toLowerCase().includes("audio/mp4") ? 1 : 0;
      if (aMp4 !== bMp4) return bMp4 - aMp4;
      const aBit = a.bitrate ?? 0;
      const bBit = b.bitrate ?? 0;
      const aWithin = aBit <= maxBps ? 1 : 0;
      const bWithin = bBit <= maxBps ? 1 : 0;
      if (aWithin !== bWithin) return bWithin - aWithin;
      return aWithin ? bBit - aBit : aBit - bBit;
    });

  return sortByScore(valid)[0]?.url ?? null;
}

export async function fallbackMobileStreamUrl(
  videoId: string,
  opts?: MobileStreamOptions
): Promise<string | null> {
  if (!videoId || videoId.startsWith("local:")) return null;

  try {
    const nativeResolve = getNativeKeepalive()?.resolveStream;
    if (typeof nativeResolve === "function") {
      const res = await nativeResolve({
        videoId,
        forceRotate: Boolean(opts?.forceRotate),
        quality: opts?.quality ?? "",
        title: opts?.title ?? "",
        artist: opts?.artist ?? "",
      });
      if (typeof res?.proxyUrl === "string" && res.proxyUrl.length > 0) {
        return res.proxyUrl;
      }
    }
  } catch {
    // Fall through to Piped mirrors if native resolver throws
  }

  const cleanQ = cleanTrackTitle(opts?.title ?? "");
  const cleanA = leadArtistName(opts?.artist ?? "");
  const isIpLockedGoogleVideo = (raw: string): boolean => {
    try {
      const host = new URL(raw).hostname.toLowerCase();
      return host === "googlevideo.com" || host.endsWith(".googlevideo.com");
    } catch {
      return false;
    }
  };
  const pipedAttempts = healthyMirrors(PIPED_INSTANCES).map(async (host) => {
    try {
      const res = await fetchWithAbort(`${host}/streams/${encodeURIComponent(videoId)}`, STREAM_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        audioStreams?: { url?: string; bitrate?: number; mimeType?: string }[];
      };
      const picked = pickBestPipedAudioUrl(
        (data.audioStreams ?? []).filter((s) => s?.url && !isIpLockedGoogleVideo(s.url)),
        opts?.quality
      );
      if (!picked) throw new Error("no audioStreams");
      noteMirrorHealth(host, true);
      return picked;
    } catch (err) {
      noteMirrorHealth(host, false);
      throw err;
    }
  });
  const invidiousAttempts = healthyMirrors(INVIDIOUS_INSTANCES).map(async (host) => {
    try {
      const res = await fetchWithAbort(`${host}/api/v1/videos/${encodeURIComponent(videoId)}`, STREAM_TIMEOUT_MS);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        adaptiveFormats?: { url?: string; bitrate?: number; type?: string }[];
      };
      const streams = (data.adaptiveFormats ?? [])
        .filter(
          (f) =>
            typeof f.url === "string" &&
            !isIpLockedGoogleVideo(f.url) &&
            (f.type ?? "").toLowerCase().startsWith("audio/")
        )
        .map((f) => ({
          url: f.url,
          bitrate: Number(f.bitrate ?? 0) || 0,
          mimeType: f.type,
        }));
      const picked = pickBestPipedAudioUrl(streams, opts?.quality);
      if (!picked) throw new Error("no adaptive audio");
      noteMirrorHealth(host, true);
      return picked;
    } catch (err) {
      noteMirrorHealth(host, false);
      throw err;
    }
  });
  try {
    return await Promise.any([...pipedAttempts, ...invidiousAttempts]);
  } catch {
    void cleanQ;
    void cleanA;
    return null;
  }
}

export function searchRowsToResults(rows: SearchRow[], isVideos = false): SearchResults {
  const songs: Track[] = [];
  const videos: Track[] = [];
  const albums: Album[] = [];
  const artists: Artist[] = [];
  const playlists: PlaylistCard[] = [];
  let top: TopResult | null = null;

  const seenSongs = new Set<string>();
  const seenArtists = new Set<string>();
  const seenAlbums = new Set<string>();
  const seenPlaylists = new Set<string>();

  for (const row of rows) {
    if (row.kind === "top" || row.kind === "track") {
      const song = row.song;
      if (!seenSongs.has(song.id)) {
        seenSongs.add(song.id);
        if (isVideos) videos.push(song);
        else songs.push(song);
      }
      if (row.kind === "top" && !top) {
        top = { kind: "track", track: song };
      }
    } else if (row.kind === "browse") {
      const item = row.item;
      if (item.type === "artist") {
        if (!seenArtists.has(item.browseId)) {
          seenArtists.add(item.browseId);
          const artist = browseToArtist(item);
          artists.push(artist);
          if (row.top && !top) top = { kind: "artist", artist };
        }
      } else if (item.type === "album") {
        if (!seenAlbums.has(item.browseId)) {
          seenAlbums.add(item.browseId);
          const album = browseToAlbum(item);
          albums.push(album);
          if (row.top && !top) top = { kind: "album", album };
        }
      } else if (item.type === "playlist") {
        if (!seenPlaylists.has(item.browseId)) {
          seenPlaylists.add(item.browseId);
          playlists.push({
            id: item.browseId,
            title: item.title,
            thumb: item.thumb,
            subtitle: item.subtitle,
          });
        }
      }
    }
  }

  if (!top && songs[0]) {
    top = { kind: "track", track: songs[0] };
  }
  return { songs, videos, albums, artists, playlists, top };
}

export async function fallbackMobileSearch(query: string, filter = "all"): Promise<SearchResults> {
  const empty: SearchResults = {
    songs: [],
    videos: [],
    albums: [],
    artists: [],
    playlists: [],
    top: null,
  };
  const q = query.trim();
  if (!q) return empty;

  try {
    const params = SEARCH_FILTER_PARAMS[filter] ?? null;
    const raw = await ytmCall("search", params ? { query: q, params } : { query: q });
    const parsed = parseSearchPage(raw, filter === "videos");
    const result = searchRowsToResults(parsed.rows, filter === "videos");

    // When a full search is used for artist/entity lookups and YTM's "All" tab didn't
    // surface an artist row directly, ask the explicit "artists" filter tab once.
    if (filter === "all" && result.artists.length === 0 && SEARCH_FILTER_PARAMS.artists) {
      try {
        const artistRaw = await ytmCall("search", {
          query: q,
          params: SEARCH_FILTER_PARAMS.artists,
        });
        const artistRows = parseSearchPage(artistRaw, false).rows;
        const artistOnly = searchRowsToResults(artistRows, false);
        result.artists = artistOnly.artists;
      } catch {
        /* ignore artist-filter failure when songs/albums already loaded */
      }
    }
    return result;
  } catch {
    // Fall back to Piped/Invidious when YTM bridge is unavailable
  }

  const pipedFilter = filter === "videos" ? "videos" : "music_songs";
  const pipedAttempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/search?q=${encodeURIComponent(q)}&filter=${pipedFilter}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      items?: {
        url?: string;
        title?: string;
        uploaderName?: string;
        thumbnail?: string;
        duration?: number;
      }[];
    };
    const songs: Track[] = [];
    for (const item of data.items ?? []) {
      const id = extractVideoId(item.url);
      if (!id || !item.title) continue;
      songs.push({
        id,
        title: item.title,
        artist: (item.uploaderName || "Unknown Artist").replace(/ - Topic$/i, ""),
        album: "",
        duration: typeof item.duration === "number" && item.duration > 0 ? item.duration : 0,
        thumb: item.thumbnail || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      });
    }
    if (!songs.length) throw new Error("empty");
    return {
      ...empty,
      songs,
      top: { kind: "track" as const, track: songs[0] },
    };
  });

  const invidiousAttempts = INVIDIOUS_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/api/v1/search?q=${encodeURIComponent(q)}&type=video`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      videoId?: string;
      title?: string;
      author?: string;
      lengthSeconds?: number;
      videoThumbnails?: { url?: string }[];
    }[];
    const songs: Track[] = [];
    for (const item of Array.isArray(data) ? data : []) {
      const id = extractVideoId(item.videoId);
      if (!id || !item.title) continue;
      songs.push({
        id,
        title: item.title,
        artist: (item.author || "Unknown Artist").replace(/ - Topic$/i, ""),
        album: "",
        duration: typeof item.lengthSeconds === "number" && item.lengthSeconds > 0 ? item.lengthSeconds : 0,
        thumb: item.videoThumbnails?.[0]?.url || `https://i.ytimg.com/vi/${id}/hqdefault.jpg`,
      });
    }
    if (!songs.length) throw new Error("empty");
    return {
      ...empty,
      songs,
      top: { kind: "track" as const, track: songs[0] },
    };
  });

  try {
    return await Promise.any([...pipedAttempts, ...invidiousAttempts]);
  } catch {
    return empty;
  }
}

export async function fallbackMobileSearchPage(query: string, filter = "all"): Promise<SearchPageResult> {
  const q = query.trim();
  if (!q) return { rows: [], continuation: null };
  try {
    const params = SEARCH_FILTER_PARAMS[filter] ?? null;
    const raw = await ytmCall("search", params ? { query: q, params } : { query: q });
    const parsed = parseSearchPage(raw, filter === "videos");
    if (filter === "all" && !parsed.rows.some((r) => r.kind === "browse")) {
      const base = await fallbackMobileSearch(q, "songs").catch(() => null);
      if (base?.songs.length && parsed.rows.length === 0) {
        return {
          rows: base.songs.map((song, idx) =>
            idx === 0 ? { kind: "top" as const, song } : { kind: "track" as const, song }
          ),
          continuation: null,
        };
      }
    }
    return parsed;
  } catch {
    const res = await fallbackMobileSearch(q, filter);
    return {
      rows: res.songs.map((song, idx) =>
        idx === 0 ? { kind: "top" as const, song } : { kind: "track" as const, song }
      ),
      continuation: null,
    };
  }
}

export async function fallbackMobileSearchMore(token: string, filter = "all"): Promise<SearchPageResult> {
  if (!token) return { rows: [], continuation: null };
  const raw = await ytmCall("search", { continuation: token });
  return parseSearchPage(raw, filter === "videos");
}

export async function fallbackMobileSuggestions(query: string): Promise<{ items: SearchSuggestion[] }> {
  const q = query.trim();
  if (!q) return { items: [] };
  try {
    const raw = await ytmCall("music/get_search_suggestions", { input: q });
    const items = parseSearchSuggestions(raw, q);
    if (items.length > 0) {
      if (!items.some((i) => i.track || i.browse)) {
        try {
          const allRaw = await ytmCall("search", { query: q });
          const allParsed = parseSearchPage(allRaw, false);
          return { items: withSearchRows(items, allParsed.rows) };
        } catch {
          return { items };
        }
      }
      return { items };
    }
  } catch {
    /* fall through to Piped suggestions */
  }

  const attempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/opensearch/suggestions?query=${encodeURIComponent(q)}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const list: string[] = Array.isArray(data?.[1]) ? data[1] : Array.isArray(data) ? data : [];
    return {
      items: list
        .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
        .slice(0, 8)
        .map((text) => ({ text })),
    };
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return { items: [] };
  }
}

export async function fallbackMobileArtist(artistId: string): Promise<ArtistPageData> {
  const response = await ytmCall("browse", { browseId: artistId });
  const parsed = parseArtistPage(response);
  const info: Artist = {
    id: artistId,
    name: parsed.name || "Unknown artist",
    thumb: parsed.thumb,
  };
  const songs: Track[] = parsed.songs.map((t) => ({
    ...t,
    artist: t.artist && t.artist !== "Unknown artist" ? t.artist : info.name,
    artistId: t.artistId || artistId,
  }));
  return {
    artist: info,
    description: parsed.description,
    subscriberCount: parsed.subscriberCount,
    monthlyListeners: parsed.monthlyListeners,
    songs,
    shelves: parsed.shelves,
  };
}

async function mobileRestOfShelf(
  token: string | null,
  credit: ReturnType<typeof pageCredit>
): Promise<ParsedSong[]> {
  const out: ParsedSong[] = [];
  let cur = token;
  for (let page = 0; cur && page < 6; page++) {
    const response = await ytmCall("browse", { continuation: cur }).catch(() => null);
    if (!response) break;
    const next = parsePlaylistContinuation(response, credit);
    if (!next.songs.length) break;
    out.push(...next.songs);
    cur = next.continuation;
  }
  return out;
}

export async function fallbackMobileAlbum(albumId: string): Promise<{ album: Album; tracks: Track[] }> {
  const response = await ytmCall("browse", { browseId: albumId });
  const parsed = parseReleasePage(response, albumId);
  if (parsed.continuation) {
    const more = await mobileRestOfShelf(parsed.continuation, pageCredit(response));
    const seen = new Set(parsed.tracks.map((t) => t.id));
    const thumb = parsed.header?.thumb ?? "";
    for (const t of more) {
      if (!seen.has(t.id) && seen.add(t.id)) {
        parsed.tracks.push({ ...t, thumb: t.thumb || thumb });
      }
    }
  }
  const lines = (parsed.header?.subtitle ?? "")
    .split("•")
    .map((p) => p.trim())
    .filter(Boolean);
  const releaseType = lines.find((l) => ["album", "single", "ep"].includes(l.toLowerCase()));
  const year = [...lines].reverse().find((l) => /^\d{4}$/.test(l));
  const artist =
    lines.find((l) => l !== releaseType && l !== year) || parsed.tracks[0]?.artist || "Unknown artist";
  const album: Album = {
    id: albumId,
    title: parsed.header?.title || parsed.tracks[0]?.album || "Unknown album",
    artist,
    year,
    thumb: parsed.header?.thumb || parsed.tracks[0]?.thumb || "",
    releaseType: releaseType ? releaseType[0].toUpperCase() + releaseType.slice(1).toLowerCase() : undefined,
    description: parsed.description,
    artistId: parsed.header?.artistId,
  };
  return { album, tracks: parsed.tracks };
}

export async function fallbackMobilePlaylistPage(playlistId: string): Promise<RemotePlaylistPage> {
  const id = /^VL|^PL|^OLAK5uy/.test(playlistId) ? playlistId : `VL${playlistId}`;
  const response = await ytmCall("browse", { browseId: id });
  const more = await mobileRestOfShelf(parsePlaylistShelf(response)?.continuation ?? null, pageCredit(response));
  return parseRemotePlaylistPage(response, id, more);
}

export async function fallbackMobilePlaylist(playlistId: string): Promise<{ title: string; tracks: Track[] }> {
  const page = await fallbackMobilePlaylistPage(playlistId);
  return { title: page.title, tracks: page.tracks };
}

export async function fallbackMobileHome(): Promise<HomeShelf[]> {
  const res = await ytmCall("browse", { browseId: "FEmusic_home" });
  const moodShelves = parseMoodPage(res).shelves;
  const chartShelves = parseChartsShelves(res) as HomeShelf[];
  const byTitle = new Map<string, HomeShelf>();
  for (const s of [...moodShelves, ...chartShelves]) {
    if (s.items.length >= 3 && !byTitle.has(s.title)) {
      byTitle.set(s.title, s);
    }
  }
  return [...byTitle.values()].slice(0, 8);
}

export async function fallbackMobileRadio(videoId: string, token?: string): Promise<RadioPage> {
  const body: Record<string, unknown> = {
    videoId,
    playlistId: `RDAMVM${videoId}`,
    enablePersistentPlaylistPanel: true,
    tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
    watchEndpointMusicSupportedConfigs: {
      watchEndpointMusicConfig: { hasPersistentPlaylistPanel: true, musicVideoType: "MUSIC_VIDEO_TYPE_ATV" },
    },
  };
  if (token) body.continuation = token;
  const res = await ytmCall("next", body);
  return parseRadioPage(res, videoId);
}

export async function fallbackMobileCharts(): Promise<HomeShelf[]> {
  const [res, explore] = await Promise.all([
    ytmCall("browse", { browseId: "FEmusic_charts" }),
    ytmCall("browse", { browseId: "FEmusic_explore" }).catch(() => null),
  ]);
  const shelves = parseChartsShelves(res) as HomeShelf[];
  const fresh = explore
    ? (parseChartsShelves(explore) as HomeShelf[]).find(
        (s) => s.items.length >= 3 && s.items.every((i) => i.kind === "album")
      )
    : undefined;
  return fresh ? [...shelves, { ...fresh, title: "New releases" }] : shelves;
}

export async function fallbackMobileMoods(): Promise<ParsedMood[]> {
  try {
    const grouped = parseMoods(await ytmCall("browse", { browseId: "FEmusic_moods_and_genres" }));
    if (grouped.length >= 6) return grouped;
  } catch {
    /* fall through to Explore */
  }
  return parseMoods(await ytmCall("browse", { browseId: "FEmusic_explore" }));
}

export async function fallbackMobileMoodCovers(browseId: string, params: string): Promise<string[]> {
  const res = await ytmCall("browse", params ? { browseId, params } : { browseId });
  return parseMoodCovers(res);
}

export async function fallbackMobileMoodPage(browseId: string, params: string): Promise<MoodPage> {
  const res = await ytmCall("browse", params ? { browseId, params } : { browseId });
  return parseMoodPage(res);
}

function parseMobileTimestampSec(minsStr: string, secsStr: string, fracStr: string): number {
  const mins = Number(minsStr);
  const secs = Number(secsStr);
  const ms =
    fracStr.length === 3
      ? Number(fracStr) / 1000
      : fracStr.length === 2
        ? Number(fracStr) / 100
        : fracStr.length === 1
          ? Number(fracStr) / 10
          : 0;
  return mins * 60 + secs + ms;
}

function parseMobileOffsetSec(lrc: string): number {
  const m = /^\[offset:\s*([+-]?\d+)\s*\]$/im.exec(lrc);
  if (!m) return 0;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n / 1000 : 0;
}

export function parseLrcText(lrc: string, trackArtist?: string): { lines: SyncedLyricLine[]; wordSynced: boolean } {
  const offsetSec = parseMobileOffsetSec(lrc);
  const rows: {
    time: number;
    tokens: { start: number; text: string }[];
    text: string;
  }[] = [];

  for (const rawLine of lrc.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    const m = /^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$/.exec(trimmed);
    if (!m) continue;
    const body = m[2];
    const rawWords = [...body.matchAll(/<(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?>([^<]*)/g)].map((w) => ({
      start: Math.max(0, parseMobileTimestampSec(w[1], w[2], w[3] ?? "") - offsetSec),
      text: w[4].trim(),
    }));
    const plainLine = stripSingerPrefix(
      body.replace(/<\d{1,3}:\d{2}(?:[.:]\d{1,3})?>/g, "").trim(),
      trackArtist
    );
    if (!plainLine) continue;

    const stamps: number[] = [];
    const tagRe = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;
    let tag: RegExpExecArray | null;
    while ((tag = tagRe.exec(m[1])) !== null) {
      stamps.push(Math.max(0, parseMobileTimestampSec(tag[1], tag[2], tag[3] ?? "") - offsetSec));
    }
    const baseTime = stamps[0] ?? 0;
    for (const time of stamps) {
      const delta = time - baseTime;
      const tokens =
        delta === 0 ? rawWords : rawWords.map((t) => ({ ...t, start: Math.max(0, t.start + delta) }));
      rows.push({ time, tokens, text: plainLine });
    }
  }

  rows.sort((a, b) => a.time - b.time);
  const hasEnhancedWords = rows.some((r) => r.tokens.some((t) => t.text.length > 0));
  if (!hasEnhancedWords) {
    return {
      wordSynced: false,
      lines: rows.map((r) => ({ time: r.time, text: r.text })),
    };
  }

  const out: SyncedLyricLine[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const lineEnd = rows[i + 1]?.time ?? r.time + 4;
    const words: { start: number; end: number; text: string }[] = [];
    for (let wi = 0; wi < r.tokens.length; wi++) {
      const tok = r.tokens[wi];
      if (!tok.text) continue;
      // Strip singer prefix when it occupies leading word tokens before a colon.
      const cleanedTok = wi === 0 ? tok.text.replace(/^\[[^\]]+\]:\s*$/, "").replace(/^v\d+:\s*$/i, "") : tok.text;
      if (!cleanedTok) continue;
      const nextStart = r.tokens[wi + 1]?.start ?? lineEnd;
      words.push({
        start: tok.start,
        end: Math.max(tok.start, nextStart),
        text: cleanedTok,
      });
    }
    const rebuilt = stripSingerPrefix(words.map((w) => w.text).join(" "), trackArtist);
    if (words.length > 0 && rebuilt) {
      out.push({
        time: Math.min(r.time, words[0].start),
        text: rebuilt,
        words,
        end: words[words.length - 1].end,
      });
    } else {
      out.push({ time: r.time, text: r.text });
    }
  }
  return { wordSynced: out.some((l) => Boolean(l.words?.length)), lines: out };
}

export function cleanTrackTitle(title: string): string {
  return title
    .replace(/\s*[\[(][^\])]*[\])]/g, " ")
    .replace(
      /\s+-\s+(?:official\s+(?:music\s+)?(?:video|audio|lyric(?:s)?\s+video|visuali[sz]er)|remaster(?:ed)?(?:\s+\d{4})?|lyrics?|radio\s+edit|explicit|clean|live(?:\s+at\b.*)?)$/i,
      " "
    )
    .replace(/\s+/g, " ")
    .trim();
}

export function cleanTrackQuery(title: string, artist?: string): { title: string; artist: string } {
  return {
    title: cleanTrackTitle(title),
    artist: leadArtistName(artist ?? ""),
  };
}

function stripTitleExtras(title: string): string {
  return cleanTrackTitle(title);
}

function leadArtistName(artist: string): string {
  return artist
    .replace(/\s*-\s*Topic$/i, "")
    .split(/,|&|\/|\b(?:feat\.?|ft\.?|with)\b/i)[0]
    .trim();
}

export async function fallbackMobileLyrics(track: {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}): Promise<LyricsResult | null> {
  const nativeLyrics = getNativeKeepalive()?.resolveLyrics;
  if (typeof nativeLyrics === "function") {
    try {
      const res = await nativeLyrics({
        videoId: track.id,
        title: track.title,
        artist: track.artist,
        album: track.album ?? "",
        duration: track.duration ?? 0,
      });
      if (res?.found && (res.synced?.length || res.plain)) {
        return {
          synced: res.synced?.length ? res.synced : null,
          plain: res.plain ?? null,
          source: res.source ?? "LyricsPlus",
          wordSynced: Boolean(res.wordSynced),
        };
      }
    } catch {
      /* fall through to pure-JS LRCLIB */
    }
  }

  const cleanTitle = stripTitleExtras(track.title);
  const leadArtist = leadArtistName(track.artist);
  if (!cleanTitle) return null;

  const pickBestLrclibRow = (
    rows: { syncedLyrics?: string; plainLyrics?: string; duration?: number }[]
  ): LyricsResult | null => {
    if (!Array.isArray(rows) || rows.length === 0) return null;
    const dur = track.duration ?? 0;
    const sorted = [...rows].sort((a, b) => {
      const aSync = a.syncedLyrics ? 1 : 0;
      const bSync = b.syncedLyrics ? 1 : 0;
      if (aSync !== bSync) return bSync - aSync;
      return dur > 0 ? Math.abs((a.duration ?? 0) - dur) - Math.abs((b.duration ?? 0) - dur) : 0;
    });
    for (const rec of sorted) {
      const parsed = rec.syncedLyrics ? parseLrcText(rec.syncedLyrics, track.artist) : null;
      if (parsed && parsed.lines.length >= 3) {
        return {
          synced: parsed.lines,
          plain: rec.plainLyrics?.trim() || null,
          source: "LRCLIB",
          wordSynced: parsed.wordSynced,
        };
      }
      if (rec.plainLyrics?.trim()) {
        const cleanedPlain = rec.plainLyrics
          .split(/\r?\n/)
          .map((line) => stripSingerPrefix(line, track.artist))
          .join("\n")
          .trim();
        return { synced: null, plain: cleanedPlain, source: "LRCLIB", wordSynced: false };
      }
    }
    return null;
  };

  // Race LRCLIB exact/structured/search + LyricsPlus in parallel with strict 3.5s AbortController timeouts.
  const tasks: Promise<LyricsResult>[] = [];
  if (leadArtist && (track.duration ?? 0) > 0) {
    const getUrl =
      `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}` +
      `&artist_name=${encodeURIComponent(leadArtist)}` +
      `&duration=${Math.round(track.duration ?? 0)}` +
      (track.album ? `&album_name=${encodeURIComponent(stripTitleExtras(track.album))}` : "");
    tasks.push(
      fetchWithAbort(getUrl, LYRICS_TIMEOUT_MS).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const rec = (await res.json()) as { syncedLyrics?: string; plainLyrics?: string };
        const parsed = rec.syncedLyrics ? parseLrcText(rec.syncedLyrics, track.artist) : null;
        if (parsed && parsed.lines.length >= 3) {
          return {
            synced: parsed.lines,
            plain: rec.plainLyrics?.trim() || null,
            source: "LRCLIB",
            wordSynced: parsed.wordSynced,
          };
        }
        if (rec.plainLyrics?.trim()) {
          const cleanedPlain = rec.plainLyrics
            .split(/\r?\n/)
            .map((line) => stripSingerPrefix(line, track.artist))
            .join("\n")
            .trim();
          return { synced: null, plain: cleanedPlain, source: "LRCLIB", wordSynced: false };
        }
        throw new Error("empty");
      })
    );
  }
  if (leadArtist) {
    tasks.push(
      fetchWithAbort(
        `https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(leadArtist)}`,
        LYRICS_TIMEOUT_MS
      ).then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const picked = pickBestLrclibRow((await res.json()) as { syncedLyrics?: string; plainLyrics?: string; duration?: number }[]);
        if (!picked) throw new Error("empty");
        return picked;
      })
    );
  }
  const q = [cleanTitle, leadArtist].filter(Boolean).join(" ");
  tasks.push(
    fetchWithAbort(`https://lrclib.net/api/search?q=${encodeURIComponent(q)}`, LYRICS_TIMEOUT_MS).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const picked = pickBestLrclibRow((await res.json()) as { syncedLyrics?: string; plainLyrics?: string; duration?: number }[]);
      if (!picked) throw new Error("empty");
      return picked;
    })
  );
  const lpUrl =
    `https://lyricsplus.prjktla.workers.dev/v2/lyrics/get?title=${encodeURIComponent(cleanTitle)}` +
    (leadArtist ? `&artist=${encodeURIComponent(leadArtist)}` : "");
  tasks.push(
    fetchWithAbort(lpUrl, LYRICS_TIMEOUT_MS).then(async (res) => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const lpData = (await res.json()) as {
        lyrics?: Array<{
          time?: number;
          duration?: number;
          text?: string;
          syllabus?: Array<{ time?: number; duration?: number; text?: string }>;
        }>;
      };
      let anyWord = false;
      const lines: SyncedLyricLine[] = (lpData.lyrics ?? [])
        .map((l): SyncedLyricLine | null => {
          const lineStart = (Number(l.time ?? 0) || 0) / 1000;
          const syls = Array.isArray(l.syllabus) ? l.syllabus : [];
          if (syls.length > 0) {
            const words = syls
              .filter((s) => typeof s.text === "string" && s.text.trim().length > 0)
              .map((s) => {
                const start = (Number(s.time ?? l.time ?? 0) || 0) / 1000;
                const end = start + Math.max(0.02, (Number(s.duration ?? 0) || 0) / 1000);
                return { start, end, text: String(s.text).trim() };
              });
            const joined = stripSingerPrefix(words.map((w) => w.text).join(" "), track.artist);
            if (words.length > 0 && joined) {
              anyWord = true;
              return {
                time: Math.min(lineStart, words[0].start),
                text: joined,
                words,
                end: words[words.length - 1].end,
              };
            }
          }
          const clean = stripSingerPrefix(String(l.text ?? ""), track.artist);
          return clean ? { time: lineStart, text: clean } : null;
        })
        .filter((l): l is SyncedLyricLine => l !== null);
      if (lines.length < 3) throw new Error("empty");
      return {
        synced: lines,
        plain: lines.map((l) => l.text).join("\n"),
        source: "LyricsPlus",
        wordSynced: anyWord,
      };
    })
  );

  try {
    return await Promise.any(tasks);
  } catch {
    return null;
  }
}
