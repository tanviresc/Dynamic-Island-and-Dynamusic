/**
 * ByTune music service — runs in the Electron main process on Node.
 *
 * Uses youtubei.js (InnerTube) for YouTube Music: search, albums, playlists,
 * home feed, lyrics and audio stream URLs.
 *
 * YouTube gates stream URLs behind BotGuard PO tokens for anonymous sessions,
 * so the InnerTube session is bootstrapped in two phases: get visitor data,
 * mint a PO token for it in a hidden Chromium window (see po-token.ts), then
 * create the real session with both attached. If stream resolution still
 * fails, we rotate InnerTube clients, then rebuild the session with a fresh
 * token, and finally fall back to public Piped mirrors.
 */
import { Innertube } from "youtubei.js";
import { app } from "electron";
import * as path from "path";
import { localTrackById } from "./local-library";
import { pickAudio, streamTtlMs } from "./audio-format";
import { embeddedLrc, fetchLyrics } from "./lyrics";
import { largestThumbUrl, upgradeThumb } from "./artwork";
import { getPoToken, invalidatePoToken } from "./po-token";
import { resolveMarket, type ResolvedMarket } from "./market";
import { SEARCH_FILTER_PARAMS, callBrowse, callBrowseContinuation, callSearch, callSearchContinuation, callSearchSuggestions, parseArtistPage, parseChartsShelves, pageCredit, parseMoodCovers, parseMoodPage, parseMoods, parsePodcastEpisodes, parsePodcastPage, parsePodcastShelves, parsePlaylistContinuation, parsePlaylistShelf, parseQueueCredits, parseRadioPage, parseRemotePlaylistPage, parseReleasePage, parseSearchPage, parseSearchSuggestions } from "./ytm";
import type { Credits, ParsedSong } from "./ytm";
import type { MoodEntry } from "./moods";
import type {
  Album,
  PodcastPage,
  PodcastShelf,
  MoodPage,
  Artist,
  ArtistPageData,
  HomeItem,
  HomeShelf,
  LyricsResult,
  PlaylistCard,
  RadioPage,
  RemotePlaylistPage,
  SearchFilter,
  SearchPageResult,
  SearchResults,
  SearchRow,
  SearchSuggestion,
  SyncedLyricLine,
  TopResult,
  Track,
} from "../bytune/types";

/* eslint-disable @typescript-eslint/no-explicit-any */

export type { Album, Artist, ArtistPageData, RemotePlaylistPage, SearchFilter, SearchPageResult, SearchRow, SearchResults, TopResult, Track };

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

// VISIONOS serves plain, fully-streamable URLs without SABR gating;
// the others are fallbacks of varying usefulness.
const STREAM_CLIENTS = ["VISIONOS", "IOS", "ANDROID_VR", "WEB", "YTMUSIC", "ANDROID", "TV"] as const;
const PIPED_INSTANCES = [
  "https://api.piped.private.coffee",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.tokhmi.xyz",
  "https://pipedapi.moomoo.me",
];

let preferredClientIdx = 0;
let ytPromise: Promise<any> | null = null;

/* ------------------------------------------------------------------ */
/* Market — the device's YTM region (InnerTube `gl`).                  */
/* Resolved once per boot from OS signals, never from the auth method: */
/* guest / password / OAuth sessions all get the same treatment.       */
/* ------------------------------------------------------------------ */

let marketValue: ResolvedMarket | null = null;

function resolveDeviceMarket(): ResolvedMarket {
  if (!marketValue) {
    marketValue = resolveMarket({
      osRegion: app.getLocaleCountryCode() || null,
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone ?? null,
      override: process.env.BYTUNE_MARKET ?? null,
      isDev: !app.isPackaged,
    });
    console.log(`[bytune] market: ${marketValue.country} (${marketValue.source})`);
  }
  return marketValue;
}

/** The resolved device market — for diagnostics and feed debugging. */
export function currentMarket(): ResolvedMarket {
  return resolveDeviceMarket();
}

/** The InnerTube display language (hl) — UI wording, never the region. */
function displayLanguage(): string {
  const locale = app.getLocale() || "en";
  const base = locale.split("-")[0].toLowerCase();
  return /^[a-z]{2,3}$/.test(base) ? base : "en";
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

async function withRetry<T>(fn: () => Promise<T>, attempts = 2, delayMs = 600): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < attempts - 1) await sleep(delayMs * (attempt + 1));
    }
  }
  throw lastErr;
}

async function createSession(): Promise<any> {
  const market = resolveDeviceMarket();
  const yt = await Innertube.create({
    retrieve_player: true,
    enable_session_cache: true,
    location: market.country,
    lang: displayLanguage(),
  });
  const visitorData: string | undefined = yt?.session?.context?.client?.visitorData;
  (yt as any).__visitorData = visitorData;
  (yt as any).__market = market.country;

  // Mint PO token asynchronously in the background so search/home/browse are never delayed.
  if (visitorData) {
    void getPoToken(visitorData)
      .then((poToken) => {
        (yt as any).__poToken = poToken;
      })
      .catch(() => undefined);
  }
  return yt;
}

export function getYT(): Promise<any> {
  if (!ytPromise) {
    ytPromise = createSession().catch((err) => {
      ytPromise = null;
      throw err;
    });
  }
  return ytPromise;
}

async function resetSession(): Promise<any> {
  invalidatePoToken();
  ytPromise = null;
  return getYT();
}

/* ------------------------------------------------------------------ */
/* Parsing helpers (defensive — InnerTube shapes change often)         */
/* ------------------------------------------------------------------ */

function text(v: any): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v.text === "string") return v.text;
  if (Array.isArray(v.runs)) return v.runs.map((r: any) => r?.text ?? "").join("");
  return "";
}

export function parseDuration(v: any): number {
  if (v == null) return 0;
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v.seconds === "number") return Math.round(v.seconds);
  const t = text(v);
  const parts = t.split(":").map((p) => parseInt(p, 10));
  if (parts.length >= 2 && parts.every((p) => Number.isFinite(p))) {
    return parts.reduce((acc, p) => acc * 60 + p, 0);
  }
  return 0;
}

/**
 * Largest offered rendition, at original quality — the rows only carry small
 * placeholders (`=w60-h60`, `=s60`, …) while the same photo serves up to
 * 1200px, so the URL is upgraded rather than taken verbatim.
 */
function pickThumb(th: any): string {
  if (typeof th === "string") return upgradeThumb(th);
  if (Array.isArray(th)) return upgradeThumb(largestThumbUrl(th));
  if (Array.isArray(th?.contents)) return upgradeThumb(largestThumbUrl(th.contents));
  if (Array.isArray(th?.thumbnails)) return upgradeThumb(largestThumbUrl(th.thumbnails));
  if (typeof th?.url === "string") return upgradeThumb(th.url);
  return "";
}

/** Swap low-res placeholder sizes for the original (both URL formats). */
function biggerThumb(url: string): string {
  return upgradeThumb(url);
}

function itemKind(item: any): string {
  return String(item?.item_type ?? item?.type ?? "").toLowerCase();
}

/**
 * A video upload hiding among songs — BitChord mobile's rule: the row's kind
 * word ("Video") is the clean signal when the surface provides one, and a
 * widescreen (non-square) thumbnail gives a video upload away where a
 * catalogue track always carries square cover art.
 */
function isVideoItem(item: any): boolean {
  if (itemKind(item) === "video") return true;
  const thumbs = item?.thumbnail?.contents ?? item?.thumbnail?.thumbnails ?? item?.thumbnails ?? [];
  for (const t of thumbs) {
    const w = Number(t?.width);
    const h = Number(t?.height);
    if (w > 0 && h > 0 && w !== h) return true;
  }
  return false;
}

function authorNames(item: any): string {
  const listed = item?.authors ?? item?.artists;
  if (Array.isArray(listed) && listed.length) {
    const names = listed.map((a: any) => a?.name ?? text(a)).filter(Boolean);
    if (names.length) return names.join(", ");
  }
  // Fall back to the "Artist • Album • Year" subtitle column.
  const runs = item?.flex_columns?.[1]?.title?.runs;
  const joined = Array.isArray(runs) ? runs.map((r: any) => r?.text ?? "").join("") : text(item?.subtitle);
  return (joined.split(" • ")[0] ?? "").trim();
}

function parseTrackItem(item: any, kinds: string[] = ["song", "video"]): Track | null {
  try {
    // Mislabeled uploads (a video tagged "song", or a non-square thumbnail on
    // a songs-filter row) resolve to their true kind before the check — a
    // caller asking for songs therefore never receives a YouTube video.
    const kind = isVideoItem(item) ? "video" : itemKind(item);
    if (!kinds.includes(kind)) return null;
    const id = item?.id;
    if (!id) return null;
    const title = text(item?.title) || text(item?.flex_columns?.[0]?.title) || "";
    if (!title || /video unavailable/i.test(title)) return null;
    const duration = parseDuration(item?.duration) || parseDuration(item?.fixed_columns?.[0]?.title);
    return {
      id,
      title,
      artist: authorNames(item) || "Unknown artist",
      artistId: item?.authors?.[0]?.channel_id ?? item?.artists?.[0]?.channel_id ?? undefined,
      album: item?.album?.name ?? (text(item?.album) || undefined),
      albumId: item?.album?.id ?? undefined,
      duration,
      thumb: pickThumb(item?.thumbnail ?? item?.thumbnails),
    };
  } catch {
    return null;
  }
}

function parseAlbumItem(item: any): Album | null {
  try {
    if (itemKind(item) !== "album") return null;
    const id = item?.id;
    if (!id) return null;
    const title = text(item?.title) || text(item?.flex_columns?.[0]?.title) || "Unknown album";
    return {
      id,
      title,
      artist: authorNames(item) || "Unknown artist",
      year: item?.year ? String(item.year) : undefined,
      thumb: pickThumb(item?.thumbnail ?? item?.thumbnails),
    };
  } catch {
    return null;
  }
}

function parseArtistItem(item: any): Artist | null {
  try {
    if (itemKind(item) !== "artist") return null;
    const id = item?.id;
    if (!id) return null;
    return {
      id,
      name: text(item?.title) || text(item?.flex_columns?.[0]?.title) || "Unknown artist",
      thumb: pickThumb(item?.thumbnail ?? item?.thumbnails),
      subtitle: text(item?.subtitle) || undefined,
    };
  } catch {
    return null;
  }
}

function parsePlaylistItem(item: any): PlaylistCard | null {
  try {
    if (itemKind(item) !== "playlist") return null;
    const id = item?.id;
    if (!id) return null;
    // "Arijit Singh, Pritam, …" on YouTube's own playlists; "Name • 15M views" on community ones.
    const subtitle = text(item?.subtitle).trim();
    return {
      id,
      title: text(item?.title).trim() || "Playlist",
      thumb: pickThumb(item?.thumbnail ?? item?.thumbnails),
      count: undefined,
      ...(subtitle ? { subtitle } : {}),
    };
  } catch {
    return null;
  }
}

/** Walk any InnerTube payload and collect list items in encounter order. */
function collectItems(root: any): any[] {
  const items: any[] = [];
  const seen = new Set<any>();
  const visit = (node: any) => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      node.forEach(visit);
      return;
    }
    const type = String(node.type ?? "");
    if (type === "MusicResponsiveListItem" || type === "MusicTwoRowItem") {
      items.push(node);
      return;
    }
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") visit(value);
    }
  };
  visit(root);
  return items;
}

/**
 * Locate YouTube's "Top result" card (MusicCardShelf) in a raw response.
 * collectItems deliberately skips it — it isn't a list item — so the card
 * needs its own walk.
 */
function findCardShelf(root: any): any {
  const seen = new Set<any>();
  const visit = (node: any): any => {
    if (!node || typeof node !== "object" || seen.has(node)) return null;
    seen.add(node);
    if (Array.isArray(node)) {
      for (const n of node) {
        const hit = visit(n);
        if (hit) return hit;
      }
      return null;
    }
    if (String(node.type ?? "") === "MusicCardShelf") return node;
    for (const value of Object.values(node)) {
      if (value && typeof value === "object") {
        const hit = visit(value);
        if (hit) return hit;
      }
    }
    return null;
  };
  return visit(root);
}

/** Home feed / shelf items → playable cards. */
function parseHomeItem(item: any): HomeItem | null {
  const kind = itemKind(item);
  // Home shelves stay music-only — video uploads are the version-mismatch
  // (intro before the vocals) that breaks sync, exactly as on BitChord mobile.
  if (kind === "song") {
    const track = parseTrackItem(item, ["song"]);
    if (track) return { kind: "track", track };
  } else if (kind === "album") {
    const album = parseAlbumItem(item);
    if (album) return { kind: "album", album };
  } else if (kind === "artist") {
    const artist = parseArtistItem(item);
    if (artist) return { kind: "artist", artist };
  } else if (kind === "playlist") {
    const playlist = parsePlaylistItem(item);
    if (playlist) return { kind: "playlist", playlist };
  }
  return null;
}

function dedupeBy<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const k = key(item);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(item);
  }
  return out;
}

function dedupeById<T extends { id: string }>(list: T[]): T[] {
  const seen = new Set<string>();
  return list.filter((x) => (seen.has(x.id) ? false : (seen.add(x.id), true)));
}

/* ------------------------------------------------------------------ */
/* Search — BitChord mobile's pipeline, exactly                        */
/* ------------------------------------------------------------------ */

/**
 * One page of search results: YouTube Music's own endpoint with the mobile
 * app's filter params, parsed by the ported InnertubeParser. The rows come
 * back in YouTube's own order and count — no re-ranking, no source mixing,
 * nothing added and nothing taken away.
 */
export async function searchPage(query: string, filter: SearchFilter): Promise<SearchPageResult> {
  const q = query.trim();
  if (!q) return { rows: [], continuation: null };
  const yt = await getYT();
  const response = await withRetry(() => callSearch(yt, q, SEARCH_FILTER_PARAMS[filter] ?? null));
  return parseSearchPage(response, filter === "videos");
}

/** The next page of the same search, via its continuation token. */
export async function searchMore(token: string, filter: SearchFilter): Promise<SearchPageResult> {
  const yt = await getYT();
  const response = await withRetry(() => callSearchContinuation(yt, token));
  return parseSearchPage(response, filter === "videos");
}

function emptySearch(): SearchResults {
  return { songs: [], videos: [], albums: [], artists: [], playlists: [], top: null, related: [] };
}

/**
 * Legacy combined search — still served to the few callers that want a flat
 * `SearchResults` (artist-album backfill), built on the same faithful parse.
 * Search is YouTube's alone: the catalogue has no other source.
 */
export async function searchAll(query: string, light = false): Promise<SearchResults> {
  const q = query.trim();
  if (!q) return emptySearch();
  const page = await searchPage(q, "all").catch(() => null);
  if (!page) return emptySearch();

  const topRow = page.rows.find((row): row is Extract<SearchRow, { kind: "top" }> => row.kind === "top") ?? null;
  const songs: Track[] = [
    ...(topRow ? [topRow.song] : []),
    ...page.rows.filter((r): r is Extract<SearchRow, { kind: "track" }> => r.kind === "track").map((r) => r.song),
  ];
  const browseOf = <K extends "album" | "artist" | "playlist">(type: K) =>
    page.rows.filter((r): r is Extract<SearchRow, { kind: "browse" }> => r.kind === "browse" && r.item.type === type);

  const result: SearchResults = {
    songs,
    videos: [],
    albums: browseOf("album").map((r) => ({
      id: r.item.browseId,
      title: r.item.title,
      artist: r.item.subtitle,
      thumb: r.item.thumb,
    })),
    artists: browseOf("artist").map((r) => ({
      id: r.item.browseId,
      name: r.item.title,
      thumb: r.item.thumb,
      subtitle: r.item.subtitle,
    })),
    playlists: browseOf("playlist").map((r) => ({
      id: r.item.browseId,
      title: r.item.title,
      thumb: r.item.thumb,
    })),
    top: topRow ? { kind: "track", track: topRow.song } : null,
    related: [],
  };
  // The shelves (per-filter pages) belong to the search page itself now; the
  // `light` flag is kept for signature compatibility and changes nothing.
  void light;
  return result;
}

export interface SuggestionsResult {
  items: SearchSuggestion[];
}

/**
 * Type-ahead suggestions — YouTube Music's own typeahead: a few text
 * completions, then its rich rows (songs, videos, albums, artists, playlists,
 * podcasts, episodes) read by the search page's row parsers. The dropdown
 * tops the rich rows up from the search page itself (ytm.withSearchRows).
 */
export async function getSuggestions(query: string): Promise<SuggestionsResult> {
  const q = query.trim();
  if (!q) return { items: [] };
  const yt = await getYT();
  try {
    const response = await withRetry(() => callSearchSuggestions(yt, q));
    return { items: parseSearchSuggestions(response, q) };
  } catch {
    return { items: [] };
  }
}

/**
 * Artist page — the mobile app's parseArtistPage: profile (photo, subscribers,
 * monthly listeners), the "About the artist" blurb, the "Top songs" shelf and
 * the section carousels (Albums, Singles & EPs, Featured on, …) in YouTube's
 * own order.
 */
export async function getArtistPage(artistId: string): Promise<ArtistPageData> {
  const yt = await getYT();
  const response = await withRetry(() => callBrowse(yt, artistId));
  const parsed = parseArtistPage(response);
  const info: Artist = {
    id: artistId,
    name: parsed.name || "Unknown artist",
    thumb: parsed.thumb,
  };
  const songs: Track[] = parsed.songs.map((t) => ({
    ...t,
    // Rows on the artist's own shelf can ship without a credit — the page's
    // own header is the missing one, as on mobile.
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

const PODCAST_EPISODES_MAX = 100;

/** A podcast show with its episodes — the first page plus a few more, newest 100 at most. */
export async function getPodcast(browseId: string): Promise<PodcastPage> {
  const yt = await getYT();
  const response = await withRetry(() => callBrowse(yt, browseId));
  const { continuation, ...page } = parsePodcastPage(response, browseId);
  const seen = new Set(page.episodes.map((e) => e.id));
  let token = continuation;
  for (let n = 0; token && n < 4 && page.episodes.length < PODCAST_EPISODES_MAX; n++) {
    const more = await withRetry(() => callBrowseContinuation(yt, token as string)).catch(() => null);
    if (!more) break;
    const next = parsePodcastEpisodes(more, page);
    const fresh = next.episodes.filter((e) => !seen.has(e.id) && seen.add(e.id));
    if (!fresh.length) break;
    page.episodes.push(...fresh);
    token = next.continuation;
  }
  // Long-running shows have hundreds of episodes; the newest 100 keep the page light.
  page.episodes = page.episodes.slice(0, PODCAST_EPISODES_MAX);
  return page;
}

/**
 * YouTube Music's podcasts page (music.youtube.com/podcasts) for the device
 * market: popular shows, popular episodes and topic shelves. Anonymous, like
 * every other browse; any failure throws and Explore hides the section.
 */
export async function getPodcasts(): Promise<PodcastShelf[]> {
  const yt = await getYT();
  return parsePodcastShelves(await withRetry(() => callBrowse(yt, "FEmusic_non_music_audio")));
}

/** A long playlist/album is paged; this many pages (~100 songs each) at most. */
const MAX_SHELF_PAGES = 50;

/**
 * The rest of a paged shelf, following continuation tokens. A page that still
 * fails after its retry ends the list: the songs already fetched still show.
 */
async function restOfShelf(yt: any, token: string | null, credit: Credits): Promise<ParsedSong[]> {
  const out: ParsedSong[] = [];
  for (let page = 0; token && page < MAX_SHELF_PAGES; page++) {
    const response = await withRetry(() => callBrowseContinuation(yt, token as string)).catch(() => null);
    if (!response) break;
    const next = parsePlaylistContinuation(response, credit);
    if (!next.songs.length) break;
    out.push(...next.songs);
    token = next.continuation;
  }
  return out;
}

/**
 * Album page — the mobile app's pageOf: the page's own header (title, credit
 * line, cover, artist link), its track list and the "About the album" blurb.
 */
export async function getAlbum(albumId: string): Promise<{ album: Album; tracks: Track[] }> {
  const yt = await getYT();
  const response = await withRetry(() => callBrowse(yt, albumId));
  const parsed = parseReleasePage(response, albumId);
  if (parsed.continuation) {
    const more = await restOfShelf(yt, parsed.continuation, pageCredit(response));
    const seen = new Set(parsed.tracks.map((t) => t.id));
    const thumb = parsed.header?.thumb ?? "";
    for (const t of more) if (!seen.has(t.id) && seen.add(t.id)) parsed.tracks.push({ ...t, thumb: t.thumb || thumb });
  }
  // The header line reads "Album • Artist • 2014" (older shape) or the strapline
  // carries the artist while the subtitle keeps "Album • 2014". Split like the
  // mobile DetailScreen does.
  const lines = (parsed.header?.subtitle ?? "")
    .split("•")
    .map((p) => p.trim())
    .filter(Boolean);
  const releaseType = lines.find((l) => ["album", "single", "ep"].includes(l.toLowerCase()));
  const year = [...lines].reverse().find((l) => /^\d{4}$/.test(l));
  const artist = lines.find((l) => l !== releaseType && l !== year) || parsed.tracks[0]?.artist || "Unknown artist";
  const albumInfo: Album = {
    id: albumId,
    title: parsed.header?.title || parsed.tracks[0]?.album || "Unknown album",
    artist,
    year,
    thumb: parsed.header?.thumb || parsed.tracks[0]?.thumb || "",
    releaseType: releaseType ? releaseType[0].toUpperCase() + releaseType.slice(1).toLowerCase() : undefined,
    description: parsed.description,
    artistId: parsed.header?.artistId,
  };
  return { album: albumInfo, tracks: parsed.tracks };
}

/**
 * A remote (YouTube) playlist page — title, curator/views credit line,
 * "PLAYLIST • N TRACKS" metadata and its own track list, scoped so YouTube's
 * "Suggestions" shelf stays out (the mobile app's parsePlaylistShelf).
 */
export async function getPlaylistPage(playlistId: string): Promise<RemotePlaylistPage> {
  const yt = await getYT();
  const id = /^VL|^PL|^OLAK5uy/.test(playlistId) ? playlistId : `VL${playlistId}`;
  const response = await withRetry(() => callBrowse(yt, id));
  const more = await restOfShelf(yt, parsePlaylistShelf(response)?.continuation ?? null, pageCredit(response));
  return parseRemotePlaylistPage(response, id, more);
}

export async function getPlaylist(
  playlistId: string
): Promise<{ title: string; tracks: Track[] }> {
  const yt = await getYT();
  const pl: any = await withRetry(() => (yt.music as any).getPlaylist(playlistId));
  const items = [...collectItems(pl)];
  // Follow the pages: imports and Home playlist cards used to stop at ~100 songs.
  let page: any = pl;
  for (let n = 0; page?.has_continuation && n < MAX_SHELF_PAGES; n++) {
    page = await withRetry(() => page.getContinuation()).catch(() => null);
    if (!page) break;
    items.push(...collectItems(page));
  }
  const tracks = dedupeById(
    items
      .map((i) => parseTrackItem(i, ["song", "video"]))
      .filter(Boolean) as Track[]
  );
  const title = text(pl?.header?.title) || text(pl?.title) || "Playlist";
  return { title, tracks };
}

/** The feed's first page is Quick picks and community playlists; YouTube's own playlist shelves follow on the next ones. */
const HOME_PAGES = 4;

export async function getHome(): Promise<HomeShelf[]> {
  const yt = await getYT();
  let feed: any = await withRetry(() => (yt.music as any).getHomeFeed());
  const sections: any[] = [];
  for (let page = 0; feed; page++) {
    if (Array.isArray(feed.sections)) sections.push(...feed.sections);
    // A later page that fails just ends the feed: the shelves already read still show.
    feed = page + 1 < HOME_PAGES && feed.has_continuation ? await feed.getContinuation().catch(() => null) : null;
  }
  const shelves: HomeShelf[] = [];
  for (const section of sections) {
    const title = text(section?.header?.title) || text(section?.title) || "For you";
    const items: HomeItem[] = [];
    for (const item of collectItems(section)) {
      const parsed = parseHomeItem(item);
      if (parsed) items.push(parsed);
      if (items.length >= 24) break;
    }
    if (items.length >= 3) shelves.push({ title, items });
  }
  return shelves.slice(0, 8);
}

/**
 * YouTube Music's Charts page — the provider's own per-region popularity
 * ranking. The region comes from the session's `gl` (the resolved device
 * market), so this is REAL market data, not a hand-built list. Any failure
 * throws — the feed composes without the shelf.
 */
export async function getCharts(): Promise<HomeShelf[]> {
  const yt = await getYT();
  const [res, explore] = await Promise.all([
    withRetry(() => callBrowse(yt, "FEmusic_charts")),
    // New albums & singles for this market ride along as "New releases".
    withRetry(() => callBrowse(yt, "FEmusic_explore")).catch(() => null),
  ]);
  const shelves = parseChartsShelves(res) as HomeShelf[];
  const fresh = explore
    ? (parseChartsShelves(explore) as HomeShelf[]).find((s) => s.items.length >= 3 && s.items.every((i) => i.kind === "album"))
    : undefined;
  return fresh ? [...shelves, { ...fresh, title: "New releases" }] : shelves;
}

/**
 * The provider's per-region moods & genres catalog (Explore page). The list
 * follows the session's `gl` — the resolved device market — so each market
 * gets its own browse suggestions. Any failure throws; callers fall back.
 */
export async function getMoods(): Promise<MoodEntry[]> {
  const yt = await getYT();
  // The moods page heads its grids ("Moods & moments", "Genres"); Explore's
  // carousel, the same buttons without headings, is the fallback.
  try {
    const grouped = parseMoods(await withRetry(() => callBrowse(yt, "FEmusic_moods_and_genres")));
    if (grouped.length >= 6) return grouped;
  } catch {
    /* the carousel below */
  }
  const res = await withRetry(() => callBrowse(yt, "FEmusic_explore"));
  return parseMoods(res);
}

/** A mood or genre page: its title and every shelf, for the category's own page. */
export async function getMoodPage(browseId: string, params: string): Promise<MoodPage> {
  const yt = await getYT();
  return parseMoodPage(await withRetry(() => callBrowse(yt, browseId, params)));
}

/** A mood or genre page's first playlist covers: the art on its Explore card. */
export async function getMoodCovers(browseId: string, params: string): Promise<string[]> {
  const yt = await getYT();
  return parseMoodCovers(await withRetry(() => callBrowse(yt, browseId, params)));
}

/* ------------------------------------------------------------------ */
/* Lyrics: BitChord mobile's provider sweep — word-synced Apple TTML   */
/* (lrc.red/BetterLyrics/PaxSenix/LyricsPlus), QQ karaoke, then the   */
/* video's captions, line-synced KuGou/LRCLIB, and Genius's plain    */
/* text last. Returns time-synced lines when any source has them.     */
/* ------------------------------------------------------------------ */

export interface LyricsMeta {
  id: string;
  title: string;
  artist: string;
  album?: string;
  duration?: number;
}

const lyricCache = new Map<string, LyricsResult | null>();
const LYRIC_CACHE_MAX = 400;
const QUEUE_CREDITS_CACHE_MAX = 600;
const DURATION_CACHE_MAX = 2000;
const RESOLVE_CACHE_MAX = 500;

/** Keep session Maps bounded: FIFO-evict the oldest entry past max. */
export function evictOldest<T>(map: Map<string, T>, max: number): void {
  while (map.size > max) {
    const oldest = map.keys().next().value;
    if (oldest === undefined) return;
    map.delete(oldest);
  }
}

/** Credit placeholders a bare search row can carry — never a real artist. */
const PLACEHOLDER_ARTISTS = new Set(["unknown artist", "unknown", "various artists", "artist"]);

const queueCreditsCache = new Map<string, { artist: string; album?: string; durationSec: number } | null>();

/**
 * The track's real artist/album/duration off its own watch-queue row — one
 * `next` call, cached for the session. This is what makes lyrics resolve for
 * tracks the search page could only credit "Unknown artist".
 */
async function resolveQueueCredits(
  videoId: string
): Promise<{ artist: string; album?: string; durationSec: number } | undefined> {
  if (!videoId) return undefined;
  if (queueCreditsCache.has(videoId)) return queueCreditsCache.get(videoId) ?? undefined;
  try {
    const yt = await getYT();
    const res = await yt.actions.execute("next", {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      client: "YTMUSIC",
    });
    const credits = parseQueueCredits(res?.data ?? null, videoId);
    queueCreditsCache.set(videoId, credits ?? null);
    evictOldest(queueCreditsCache, QUEUE_CREDITS_CACHE_MAX);
    return credits ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * One page of YouTube Music's radio for a song — the endless AutoPlay source.
 * The first page asks for the RDAMVM<id> station; later pages resend the same
 * request with the continuation token the previous page returned.
 */
export async function getRadio(videoId: string, token?: string): Promise<RadioPage> {
  const yt = await getYT();
  const res: any = await withRetry(() =>
    yt.actions.execute("next", {
      videoId,
      playlistId: `RDAMVM${videoId}`,
      enablePersistentPlaylistPanel: true,
      tunerSettingValue: "AUTOMIX_SETTING_NORMAL",
      watchEndpointMusicSupportedConfigs: {
        watchEndpointMusicConfig: { hasPersistentPlaylistPanel: true, musicVideoType: "MUSIC_VIDEO_TYPE_ATV" },
      },
      ...(token ? { continuation: token } : {}),
      client: "YTMUSIC",
    })
  );
  return parseRadioPage(res?.data ?? null, videoId);
}

const lyricCacheAt = new Map<string, number>();
const LRCLIB_UA = "ByTune/1.0.0";

function primaryArtist(artist: string): string {
  return artist.split(/,|&|feat\.|ft\./i)[0].trim();
}

/** Strip parenthetical/bracket extras ("(From ...)", "(feat. X)", "[2012 Mix]") for better matching. */
function cleanTitle(title: string): string {
  return title
    .replace(/\([^)]*\)/g, " ")
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/["“”']/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripSyncedTimestamps(synced: string): string {
  return synced
    .replace(/\[\d+:\d+(?:[.:]\d+)?\]/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Plain lyrics from YT Music's own Lyrics tab — ranked source and final fallback. */
async function ytMusicPlain(videoId: string): Promise<string | null> {
  try {
    const yt = await getYT();
    // A MusicDescriptionShelf: the words are its description (the footer names the licensor).
    const ytl: any = await withRetry(() => (yt.music as any).getLyrics(videoId));
    const text = ytl?.description?.toString()?.trim();
    return text || null;
  } catch {
    return null;
  }
}

function collectByName(node: unknown, key: string, out: any[] = []): any[] {
  if (!node || typeof node !== "object") return out;
  if (Array.isArray(node)) {
    for (const item of node) collectByName(item, key, out);
    return out;
  }
  const obj = node as Record<string, unknown>;
  const value = obj[key];
  if (value && typeof value === "object" && !Array.isArray(value)) out.push(value);
  for (const item of Object.values(obj)) collectByName(item, key, out);
  return out;
}

function runsText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") return node;
  if (typeof node.simpleText === "string") return node.simpleText;
  if (Array.isArray(node.runs)) return node.runs.map((r: any) => (typeof r?.text === "string" ? r.text : "")).join("");
  return "";
}

function msToSeconds(value: unknown): number | null {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseInt(value, 10) : NaN;
  return Number.isFinite(n) ? n / 1000 : null;
}

/** Caption lines that say nothing about the song. */
const CAPTION_NOISE = /^(\[(music|applause|laughter|cheering|instrumental)\]|[♪♫\s]*)$/i;

/**
 * Timed captions for the exact playing video — innertube's get_transcript,
 * asked the way BitChord asks: straight from the video id (a tiny protobuf,
 * field 1 = the id), no watch-page lookup first. A video without captions is
 * a miss for that video only — nothing is switched off for the session.
 */
async function fetchYouTubeTranscriptCues(videoId: string): Promise<SyncedLyricLine[] | null> {
  if (!/^[A-Za-z0-9_-]{11}$/.test(videoId)) return null;
  try {
    const yt = await getYT();
    const params = Buffer.concat([Buffer.from([10, videoId.length]), Buffer.from(videoId)]).toString("base64");
    const res: any = await yt.actions.execute("/get_transcript", { params });
    const body = res?.data ?? res;
    if (!body) return null;
    let lines: SyncedLyricLine[] = [];
    const segments = collectByName(body, "transcriptSegmentRenderer");
    if (segments.length) {
      for (const seg of segments) {
        const time = msToSeconds(seg.startMs);
        if (time == null) continue;
        const text = runsText(seg.snippet).replace(/[♪♫]/g, "").trim();
        if (!text || CAPTION_NOISE.test(text)) continue;
        const end = msToSeconds(seg.endMs);
        lines.push({ time, text, end: end != null && end > time ? end : undefined });
      }
    } else {
      for (const cue of collectByName(body, "transcriptCueRenderer")) {
        const time = msToSeconds(cue.startOffsetMs);
        if (time == null) continue;
        const text = runsText(cue.cue).replace(/[♪♫]/g, "").trim();
        if (!text || CAPTION_NOISE.test(text)) continue;
        lines.push({ time, text });
      }
    }
    lines = lines.filter((l) => Number.isFinite(l.time)).sort((a, b) => a.time - b.time);
    return lines.length ? lines : null;
  } catch {
    return null;
  }
}

/** Parse LRC-format synced lyrics into (time, text) lines. */
export async function getLyrics(meta: LyricsMeta): Promise<LyricsResult | null> {
  if (!meta?.id) return null;

  // A cached answer that only LINE-synced is retried after 10 minutes: the
  // word-synced providers are rate-limited flakier than KuGou/LRCLIB, and a
  // mediocre answer should never stick for the whole session.
  const cachedAt = lyricCacheAt.get(meta.id) ?? 0;
  if (lyricCache.has(meta.id)) {
    const cached = lyricCache.get(meta.id) ?? null;
    // A cached answer that only LINE-synced is retried after 10 minutes: the
    // word-synced providers are rate-limited flakier than KuGou/LRCLIB, and a
    // mediocre answer should never stick for the whole session. A MISS is
    // cached the same way — a track with no lyrics must not re-run the full
    // provider sweep every single play, but it stays retryable.
    if (cached && cached.synced && cached.wordSynced) return cached;
    if (Date.now() - cachedAt < 10 * 60 * 1000) return cached;
  }

  // BitChord reads a local file's own timed lyrics before asking anybody; an untimed tag falls through to the sweep.
  const file = meta.id.startsWith("local:") ? localTrackById(meta.id)?.path : undefined;
  const embedded = file ? await readEmbeddedLyrics(file) : null;
  if (embedded) return rememberLyrics(meta.id, embedded);

  // The mixed "All" search page credits rows it has no links for "Unknown
  // artist" (BitChord mobile prints the same). The lyric databases key on
  // artist + title, so recover the track's real credits from its own
  // watch-queue row before the lookup — the same fully-credited line the
  // mobile player is served for the same track.
  let artist = (meta.artist ?? "").trim();
  let album = meta.album;
  // A NaN duration serializes to JSON `null`, which the cloud validator (and
  // any consumer) reads back as a broken track — never let one through.
  let duration = typeof meta.duration === "number" && Number.isFinite(meta.duration) ? Math.round(meta.duration) : 0;
  const placeholder = !artist || PLACEHOLDER_ARTISTS.has(artist.toLowerCase());
  // BitChord never matches without the length, and the "All" search tab and Home's quick picks queue songs with
  // none — so a YouTube track's length comes from the same row. Its album doesn't: a credited row keeps its own.
  if (placeholder || (!duration && /^[A-Za-z0-9_-]{11}$/.test(meta.id))) {
    const credits = await resolveQueueCredits(meta.id);
    if (credits) {
      if (placeholder) {
        if (credits.artist) artist = credits.artist;
        album = album || credits.album;
      }
      duration = duration || credits.durationSec;
    }
  }

  const found = await fetchLyrics(
    {
      id: meta.id,
      title: meta.title || "",
      artist,
      album,
      duration,
    },
    // BitChord's default: the highest-priority source with timed lyrics wins, word or line timing.
    { prioritizeWordSync: false },
    { ytMusicPlain, ytTranscript: fetchYouTubeTranscriptCues }
  );
  return rememberLyrics(
    meta.id,
    found ? { synced: found.synced, plain: found.plain, source: found.source, wordSynced: found.wordSynced } : null
  );
}

function rememberLyrics(id: string, result: LyricsResult | null): LyricsResult | null {
  // Misses included — see the read path in getLyrics.
  lyricCache.set(id, result);
  lyricCacheAt.set(id, Date.now());
  evictOldest(lyricCache, LYRIC_CACHE_MAX);
  evictOldest(lyricCacheAt, LYRIC_CACHE_MAX);
  return result;
}

/** A local file's own timed lyrics tag (BitChord's EmbeddedLyrics); null when untagged, unreadable or untimed. */
async function readEmbeddedLyrics(file: string): Promise<LyricsResult | null> {
  try {
    const { parseFile } = await import("music-metadata");
    const { common } = await parseFile(file, { duration: false, skipCovers: true });
    for (const tag of common.lyrics ?? []) {
      // Tag text is untrusted (crafted frames can be multi-MB): bound it. A SYLT frame carries no text, and may be
      // timed in MPEG frames rather than milliseconds — BitChord reads no ID3 at all.
      if (typeof tag.text !== "string" || tag.text.length > 256 * 1024) continue;
      // music-metadata already split an LRC string into millisecond rows (word stamps left in the text): rebuilt as
      // LRC so lyrics.ts keeps the word timing.
      const stamp = (t: number): string =>
        `[${Math.floor(t / 60000)}:${String(Math.floor(t / 1000) % 60).padStart(2, "0")}.${String(t % 1000).padStart(3, "0")}]`;
      const raw = tag.syncText?.length
        ? tag.syncText.map(({ timestamp, text }) => stamp(Math.round(timestamp ?? 0)) + text).join("\n")
        : tag.text;
      const found = embeddedLrc(raw);
      if (found) return { synced: found.synced, plain: null, source: found.source, wordSynced: found.wordSynced };
    }
  } catch {
    /* unreadable or untagged: the sources answer as before */
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Duration enrichment                                                 */
/* ------------------------------------------------------------------ */

const durationCache = new Map<string, number>();

/**
 * YT Music search results for songs no longer include durations, so we look
 * them up via /player in small concurrent batches and cache the result.
 */
export async function enrichDurations(ids: string[]): Promise<Record<string, number>> {
  const result: Record<string, number> = {};
  const pending = [...new Set(ids.filter((id) => id && !durationCache.has(id)))].slice(0, 60);
  let cursor = 0;
  const worker = async (): Promise<void> => {
    while (cursor < pending.length) {
      const id = pending[cursor++];
      try {
        const yt = await getYT();
        const info = await yt.getBasicInfo(id, { client: "VISIONOS" });
        const secs = Math.round(info?.basic_info?.duration ?? 0);
        if (secs > 0) {
          durationCache.set(id, secs);
          evictOldest(durationCache, DURATION_CACHE_MAX);
          result[id] = secs;
        }
      } catch {
        /* leave this one unknown */
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, pending.length) }, worker));
  for (const id of ids) {
    const cached = durationCache.get(id);
    if (cached) result[id] = cached;
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Stream URL resolution                                               */
/* ------------------------------------------------------------------ */

/* Rendition ranking, loudness extraction and url deciphering live in
   audio-format.ts — pure logic, unit-tested in tests/format-pick.test.mjs. */

/**
 * Validate that a URL actually streams: request a small 1KB range for rapid response.
 */
async function probeUrl(url: string, timeoutMs = 6000): Promise<boolean> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": UA, Range: "bytes=0-1024" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (res.status === 206 || res.status === 200) {
      try {
        const reader = res.body?.getReader();
        if (reader) await reader.cancel().catch(() => undefined);
      } catch {
        /* treat as status check */
      }
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/** Strictly verify that a candidate song title and artist match the requested track */
function isMatchingTrack(reqTitle: string, reqArtist: string, candTitle: string, candArtist: string): boolean {
  const clean = (s: string) =>
    s
      .toLowerCase()
      .replace(/\([^)]*\)|\[[^\]]*\]/g, "")
      .replace(/[^a-z0-9]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  const rt = clean(reqTitle);
  const ct = clean(candTitle);
  if (!rt || !ct) return false;

  const titleMatch = rt === ct || rt.includes(ct) || ct.includes(rt);
  const rWords = rt.split(" ").filter((w) => w.length > 2);
  const cWords = new Set(ct.split(" ").filter((w) => w.length > 2));
  let titleOverlap = 0;
  for (const w of rWords) {
    if (cWords.has(w)) titleOverlap++;
  }
  const titleRatio = rWords.length > 0 ? titleOverlap / rWords.length : 0;
  const isTitleMatch = titleMatch || titleRatio >= 0.6;

  const ra = clean(reqArtist);
  const ca = clean(candArtist);
  let isArtistMatch = true;
  if (ra && ca) {
    const raWords = ra.split(" ").filter((w) => w.length > 2);
    const caWords = new Set(ca.split(" ").filter((w) => w.length > 2));
    let aMatches = 0;
    for (const w of raWords) {
      if (caWords.has(w)) aMatches++;
    }
    isArtistMatch = raWords.length === 0 || aMatches > 0 || ra.includes(ca) || ca.includes(ra);
  }

  return isTitleMatch && isArtistMatch;
}

/** Last-resort stream source: public Piped mirrors. */
async function resolveViaPiped(videoId: string): Promise<string> {
  // The id lands in a URL path segment — a renderer- or cloud-supplied value
  // with separators or query syntax must never reshape the request.
  if (!/^[\w-]{6,20}$/.test(videoId)) throw new Error("Invalid video id");
  for (const base of PIPED_INSTANCES) {
    try {
      const res = await fetch(`${base}/streams/${videoId}`, {
        headers: { "User-Agent": UA },
        signal: AbortSignal.timeout(12000),
      });
      if (!res.ok) continue;
      const data: any = await res.json();
      const audio: any[] = (data?.audioStreams ?? []).filter((s: any) => typeof s?.url === "string");
      if (!audio.length) continue;
      audio.sort((a, b) => (b?.bitrate ?? 0) - (a?.bitrate ?? 0));
      const pick = audio.find((s) => /mp4|aac/i.test(String(s?.mimeType ?? ""))) ?? audio[0];
      if (await probeUrl(pick.url)) return pick.url;
    } catch {
      /* try next instance */
    }
  }
  throw new Error("No Piped mirror had a playable stream");
}

/* Pure-JS DES-ECB decryptor for 320kbps fallback CDN when YouTube/Piped block a stream */
const DES_IP = [
  58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4,
  62, 54, 46, 38, 30, 22, 14, 6, 64, 56, 48, 40, 32, 24, 16, 8,
  57, 49, 41, 33, 25, 17, 9, 1, 59, 51, 43, 35, 27, 19, 11, 3,
  61, 53, 45, 37, 29, 21, 13, 5, 63, 55, 47, 39, 31, 23, 15, 7,
];
const DES_FP = [
  40, 8, 48, 16, 56, 24, 64, 32, 39, 7, 47, 15, 55, 23, 63, 31,
  38, 6, 46, 14, 54, 22, 62, 30, 37, 5, 45, 13, 53, 21, 61, 29,
  36, 4, 44, 12, 52, 20, 60, 28, 35, 3, 43, 11, 51, 19, 59, 27,
  34, 2, 42, 10, 50, 18, 58, 26, 33, 1, 41, 9, 49, 17, 57, 25,
];
const DES_PC1 = [
  57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18,
  10, 2, 59, 51, 43, 35, 27, 19, 11, 3, 60, 52, 44, 36,
  63, 55, 47, 39, 31, 23, 15, 7, 62, 54, 46, 38, 30, 22,
  14, 6, 61, 53, 45, 37, 29, 21, 13, 5, 28, 20, 12, 4,
];
const DES_PC2 = [
  14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10,
  23, 19, 12, 4, 26, 8, 16, 7, 27, 20, 13, 2,
  41, 52, 31, 37, 47, 55, 30, 40, 51, 45, 33, 48,
  44, 49, 39, 56, 34, 53, 46, 42, 50, 36, 29, 32,
];
const DES_SHIFTS = [1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1];
const DES_E = [
  32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9,
  8, 9, 10, 11, 12, 13, 12, 13, 14, 15, 16, 17,
  16, 17, 18, 19, 20, 21, 20, 21, 22, 23, 24, 25,
  24, 25, 26, 27, 28, 29, 28, 29, 30, 31, 32, 1,
];
const DES_P = [
  16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10,
  2, 8, 24, 14, 32, 27, 3, 9, 19, 13, 30, 6, 22, 11, 4, 25,
];
const DES_SBOX = [
  [14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7,0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8,4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0,15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13],
  [15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10,3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5,0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15,13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9],
  [10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8,13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1,13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7,1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12],
  [7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15,13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9,10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4,3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14],
  [2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9,14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6,4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14,11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3],
  [12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11,10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8,9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6,4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13],
  [4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1,13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6,1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2,6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12],
  [13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7,1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2,7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8,2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11],
];

function decryptDesUrl(encryptedBase64: string): string {
  const keyStr = "38346591";
  const keyBits: number[] = [];
  for (let i = 0; i < 8; i++) {
    const c = keyStr.charCodeAt(i);
    for (let b = 7; b >= 0; b--) keyBits.push((c >> b) & 1);
  }
  const k56 = DES_PC1.map((p) => keyBits[p - 1]);
  let cBits = k56.slice(0, 28);
  let dBits = k56.slice(28, 56);
  const subkeys: number[][] = [];
  for (let round = 0; round < 16; round++) {
    const s = DES_SHIFTS[round];
    cBits = cBits.slice(s).concat(cBits.slice(0, s));
    dBits = dBits.slice(s).concat(dBits.slice(0, s));
    const cd = cBits.concat(dBits);
    subkeys.push(DES_PC2.map((p) => cd[p - 1]));
  }
  const bytes = Buffer.from(encryptedBase64, "base64");
  const outBytes: number[] = [];
  for (let offset = 0; offset < bytes.length; offset += 8) {
    const blockBits: number[] = [];
    for (let i = 0; i < 8; i++) {
      const byte = bytes[offset + i] ?? 0;
      for (let b = 7; b >= 0; b--) blockBits.push((byte >> b) & 1);
    }
    const perm = DES_IP.map((p) => blockBits[p - 1]);
    let L = perm.slice(0, 32);
    let R = perm.slice(32, 64);
    for (let round = 15; round >= 0; round--) {
      const prevR = R;
      const expR = DES_E.map((p) => R[p - 1]);
      const xored = expR.map((bit, idx) => bit ^ subkeys[round][idx]);
      const sOut: number[] = [];
      for (let box = 0; box < 8; box++) {
        const six = xored.slice(box * 6, box * 6 + 6);
        const row = (six[0] << 1) | six[5];
        const col = (six[1] << 3) | (six[2] << 2) | (six[3] << 1) | six[4];
        const val = DES_SBOX[box][row * 16 + col];
        sOut.push((val >> 3) & 1, (val >> 2) & 1, (val >> 1) & 1, val & 1);
      }
      const fOut = DES_P.map((p) => sOut[p - 1]);
      R = L.map((bit, idx) => bit ^ fOut[idx]);
      L = prevR;
    }
    const rl = R.concat(L);
    const fp = DES_FP.map((p) => rl[p - 1]);
    for (let i = 0; i < 8; i++) {
      let byte = 0;
      for (let b = 0; b < 8; b++) byte = (byte << 1) | fp[i * 8 + b];
      outBytes.push(byte);
    }
  }
  while (outBytes.length > 0 && outBytes[outBytes.length - 1] < 16) outBytes.pop();
  return Buffer.from(outBytes).toString("utf8").trim().replace("_96.mp4", "_320.mp4").replace("http://", "https://");
}

async function resolveViaFallbackCdn(videoId: string, reqTitle?: string, reqArtist?: string): Promise<string> {
  let title = (reqTitle || "").replace(/\(Official.*?\)|\[Official.*?\]/gi, "").trim();
  let author = (reqArtist || "").replace(/\s*-\s*Topic$/i, "").trim();

  if (!title) {
    try {
      const oembedRes = await fetch(
        `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}&format=json`,
        { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(3000) }
      );
      if (oembedRes.ok) {
        const meta: any = await oembedRes.json();
        title = String(meta?.title ?? "").replace(/\(Official.*?\)|\[Official.*?\]/gi, "").trim();
        author = String(meta?.author_name ?? "").replace(/\s*-\s*Topic$/i, "").trim();
      }
    } catch {
      /* ignore oembed lookup failure */
    }
  }

  const q = `${title} ${author}`.trim();
  if (!q) throw new Error("Empty fallback query");
  const res = await fetch(
    `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&_marker=0&api_version=4&ctx=web6dot0&n=5&q=${encodeURIComponent(q)}`,
    { headers: { "User-Agent": UA }, signal: AbortSignal.timeout(4000) }
  );
  if (!res.ok) throw new Error("Fallback CDN search failed");
  const data: any = await res.json();
  for (const item of data?.results ?? []) {
    const itemTitle = String(item?.title ?? item?.song ?? "").replace(/&quot;/g, '"').replace(/&#039;/g, "'").trim();
    const itemArtist = String(item?.more_info?.artistMap?.primary_artists?.[0]?.name ?? item?.primary_artists ?? item?.singers ?? "").trim();
    // Strictly verify title & artist match so unrelated Hindi songs never play for requested tracks!
    if (!isMatchingTrack(title, author, itemTitle, itemArtist)) {
      continue;
    }
    const enc = item?.more_info?.encrypted_media_url;
    if (typeof enc === "string" && enc.length > 10) {
      const url = decryptDesUrl(enc);
      if (url.startsWith("https://") && (await probeUrl(url, 4000))) return url;
    }
  }
  throw new Error("No verified fallback CDN stream matched");
}

export interface ResolvedStream {
  url: string;
  /** Container/codec of the picked rendition, e.g. `audio/mp4; codecs=...`. */
  mime: string;
  /** Integrated loudness in LUFS when YouTube reports it (null = unknown). */
  lufs: number | null;
  /** the picked file (see PickedAudio) */
  itag?: number;
  clen?: number;
}

/**
 * Resolved-stream cache. The media element re-requests the proxy for every
 * seek and buffer refill, and each request used to run the full client
 * rotation again; a URL is valid for hours, so the cache keeps it until a
 * little before its own expiry, makes repeat requests instant and lets the
 * renderer's `?meta=1` loudness lookup share a single resolution with the
 * playback request. `refresh` (the 403 self-heal) bypasses it, and both an
 * expired and a refreshed entry ask for the same file again.
 */
const resolveCache = new Map<string, { value: ResolvedStream; ts: number; expiresAt: number }>();
const resolving = new Map<string, Promise<ResolvedStream>>();

/** A local file's ReplayGain track gain from its tags, dB (null when it has none). */
export function localGainDb(id: string): number | null {
  return localTrackById(id)?.gainDb ?? null;
}

export function resolveStream(
  videoId: string,
  refresh = false,
  maxKbps?: number,
  mp4Only = false,
  title?: string,
  artist?: string
): Promise<ResolvedStream> {
  const key = `${videoId}|${maxKbps ?? ""}|${mp4Only ? "mp4" : ""}`;
  if (!refresh) {
    const hit = resolveCache.get(key);
    if (hit && Date.now() < hit.expiresAt) return Promise.resolve(hit.value);
    const pending = resolving.get(key);
    if (pending) return pending;
  }
  const pin = resolveCache.get(key)?.value;
  const run = (async (): Promise<ResolvedStream> => {
    const cacheAndReturn = (value: ResolvedStream, ttlMs: number): ResolvedStream => {
      const ts = Date.now();
      resolveCache.set(key, { value, ts, expiresAt: ts + ttlMs });
      evictOldest(resolveCache, RESOLVE_CACHE_MAX);
      return value;
    };

    const tryInnerTube = async (): Promise<ResolvedStream> => {
      const yt = await getYT();
      const poToken: string | undefined = (yt as any).__poToken;
      // IOS, VISIONOS and ANDROID_VR return reliable non-gated streams with deciphering
      const clients = ["IOS", "VISIONOS", "ANDROID_VR", "YTMUSIC", "WEB", "ANDROID"] as const;
      let lastErr: unknown = null;
      for (const client of clients) {
        try {
          const opts: any = { client };
          if (poToken && client === "ANDROID") opts.po_token = poToken;
          const info = await Promise.race([
            yt.getBasicInfo(videoId, opts),
            new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Timeout")), 6000)),
          ]);
          const picked = await pickAudio(info, yt, maxKbps, mp4Only, pin);
          if (!picked) continue;
          if (!(await probeUrl(picked.url, 6000))) continue;
          return {
            url: picked.url,
            mime: picked.mime,
            lufs: picked.lufs,
            itag: picked.itag,
            clen: picked.clen,
          };
        } catch (err) {
          lastErr = err;
        }
      }
      throw lastErr instanceof Error ? lastErr : new Error("InnerTube clients failed");
    };

    const tryFallback = async (): Promise<ResolvedStream> => {
      const url = await resolveViaFallbackCdn(videoId, title, artist);
      return { url, mime: "audio/mp4", lufs: null };
    };

    try {
      // Race InnerTube against strictly-verified fallback CDN:
      // When title & artist match, fallback CDN returns verified 320kbps streams in ~200ms.
      // If candidate is a mismatched track (e.g. Hindi song for Kendrick Lamar), isMatchingTrack rejects it and InnerTube answers with verified YouTube audio.
      const winner = await Promise.any([tryInnerTube(), tryFallback()]);
      return cacheAndReturn(winner, streamTtlMs(winner.url, Date.now()));
    } catch {
      /* continue to fallback attempts */
    }

    try {
      const stream = await tryInnerTube();
      return cacheAndReturn(stream, streamTtlMs(stream.url, Date.now()));
    } catch {
      /* continue */
    }

    try {
      const stream = await tryFallback();
      return cacheAndReturn(stream, streamTtlMs(stream.url, Date.now()));
    } catch {
      /* continue */
    }

    // High-speed Piped YouTube mirror for the exact videoId as emergency fallback
    try {
      const url = await resolveViaPiped(videoId);
      return cacheAndReturn({ url, mime: "audio/mp4", lufs: null }, streamTtlMs(url, Date.now()));
    } catch {
      /* exhausted */
    }

    throw new Error(`Could not resolve stream for ${videoId}`);
  })();
  resolving.set(key, run);
  // Drop the in-flight entry once settled; the side chain swallows the
  // rejection so the bookkeeping itself never goes unhandled — callers
  // awaiting `run` still see the error.
  void run
    .catch(() => undefined)
    .finally(() => {
      if (resolving.get(key) === run) resolving.delete(key);
    });
  return run;
}

/**
 * A fresh load after a playback error: forget this song's renditions (it may
 * take the best one again) and start from the next client.
 */
export function retryStream(videoId: string): void {
  for (const key of [...resolveCache.keys()]) if (key.startsWith(`${videoId}|`)) resolveCache.delete(key);
  preferredClientIdx = (preferredClientIdx + 1) % STREAM_CLIENTS.length;
}
