/**
 * Direct client-side fallback for Mobile when the user is outside home
 * (away from the PC sidecar on cellular data or external Wi-Fi).
 *
 * Uses CORS-enabled Piped Music APIs so searching, streaming, liking, and
 * saving tracks offline into the phone's IndexedDB vault work anywhere.
 */
import type { SearchPageResult, SearchResults, SearchSuggestion, Track } from "../types";

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
    const cap = (
      globalThis as { Capacitor?: { Plugins?: { MediaKeepalive?: NativeMediaKeepaliveBridge } } }
    )?.Capacitor;
    const nativeResolve = cap?.Plugins?.MediaKeepalive?.resolveStream;
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

  const attempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/streams/${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      audioStreams?: { url?: string; bitrate?: number; mimeType?: string }[];
    };
    const picked = pickBestPipedAudioUrl(data.audioStreams ?? [], opts?.quality);
    if (!picked) throw new Error("no audioStreams");
    return picked;
  });
  try {
    return await Promise.any(attempts);
  } catch {
    return null;
  }
}

export async function fallbackMobileSearch(query: string, filter = "songs"): Promise<SearchResults> {
  const empty: SearchResults = {
    songs: [],
    videos: [],
    albums: [],
    artists: [],
    playlists: [],
    top: null,
  };
  if (!query.trim()) return empty;

  const pipedFilter = filter === "videos" ? "videos" : "music_songs";
  const pipedAttempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/search?q=${encodeURIComponent(query)}&filter=${pipedFilter}`, {
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
    const res = await fetch(`${host}/api/v1/search?q=${encodeURIComponent(query)}&type=video`, {
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
  const res = await fallbackMobileSearch(query, filter);
  return {
    rows: res.songs.map((song, idx) => (idx === 0 ? { kind: "top" as const, song } : { kind: "track" as const, song })),
    continuation: null,
  };
}

export async function fallbackMobileSuggestions(query: string): Promise<{ items: SearchSuggestion[] }> {
  if (!query.trim()) return { items: [] };
  const attempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/opensearch/suggestions?query=${encodeURIComponent(query)}`, {
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
