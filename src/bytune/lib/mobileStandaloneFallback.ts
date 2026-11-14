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
  "https://pipedapi.kavin.rocks",
  "https://pipedapi.adminforge.de",
  "https://pipedapi.leptons.xyz",
  "https://pipedapi.nosebs.ru",
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

export async function fallbackMobileStreamUrl(videoId: string): Promise<string | null> {
  if (!videoId || videoId.startsWith("local:")) return null;
  const attempts = PIPED_INSTANCES.map(async (host) => {
    const res = await fetch(`${host}/streams/${encodeURIComponent(videoId)}`, {
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = (await res.json()) as {
      audioStreams?: { url?: string; bitrate?: number; mimeType?: string }[];
    };
    const streams = (data.audioStreams ?? [])
      .filter((s) => typeof s.url === "string" && s.url.startsWith("https://"))
      .sort((a, b) => (b.bitrate ?? 0) - (a.bitrate ?? 0));
    if (!streams.length || !streams[0].url) throw new Error("no audioStreams");
    return streams[0].url;
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
