import { LyricLine } from "./types";

export function parseLrc(lrcText: string): LyricLine[] {
  const lines = lrcText.split("\n");
  const result: LyricLine[] = [];
  const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

  for (const line of lines) {
    const match = regex.exec(line);
    if (match && match[1] && match[2] && match[3]) {
      const minutes = parseInt(match[1], 10);
      const seconds = parseInt(match[2], 10);
      const centis = match[3].length === 3 ? parseInt(match[3], 10) : parseInt(match[3], 10) * 10;
      const timeMs = minutes * 60000 + seconds * 1000 + centis;
      const text = match[4]?.trim() || "";
      if (text) {
        result.push({ timeMs, text });
      }
    }
  }

  return result.sort((a, b) => a.timeMs - b.timeMs);
}

export async function fetchLyricsFromLrclib(
  artist: string,
  title: string,
  durationSeconds?: number
): Promise<LyricLine[]> {
  try {
    const cleanArtist = encodeURIComponent(artist.trim());
    const cleanTitle = encodeURIComponent(title.trim());
    let url = `https://lrclib.net/api/get?artist_name=${cleanArtist}&track_name=${cleanTitle}`;
    if (durationSeconds) {
      url += `&duration=${Math.round(durationSeconds)}`;
    }

    const response = await fetch(url, {
      headers: {
        "User-Agent": "Dynamusic/1.0 (https://github.com/rishiteja21/ByTune)",
      },
    });

    if (!response.ok) {
      // Fallback search
      const searchRes = await fetch(
        `https://lrclib.net/api/search?q=${cleanArtist}+${cleanTitle}`
      );
      if (searchRes.ok) {
        const searchData = await searchRes.json();
        if (Array.isArray(searchData) && searchData[0]) {
          const synced = searchData[0].syncedLyrics;
          if (synced) {
            return parseLrc(synced);
          }
        }
      }
      return [];
    }

    const data = await response.json();
    if (data.syncedLyrics) {
      return parseLrc(data.syncedLyrics);
    } else if (data.plainLyrics) {
      // Unsynced fallback lines spaced evenly
      const plainLines = data.plainLyrics.split("\n").filter((l: string) => l.trim());
      const totalDur = (durationSeconds || 180) * 1000;
      const step = totalDur / (plainLines.length || 1);
      return plainLines.map((text: string, i: number) => ({
        timeMs: Math.round(i * step),
        text,
      }));
    }
  } catch (err) {
    console.warn("Could not fetch synced lyrics from LRCLIB:", err);
  }

  return [];
}

export function getCurrentLyric(
  lyrics: LyricLine[],
  currentPositionMs: number
): { current: LyricLine | null; currentIndex: number } {
  if (!lyrics.length) return { current: null, currentIndex: -1 };

  let activeIndex = -1;
  for (let i = 0; i < lyrics.length; i++) {
    const item = lyrics[i];
    if (item && item.timeMs <= currentPositionMs) {
      activeIndex = i;
    } else {
      break;
    }
  }

  return {
    current: activeIndex >= 0 ? lyrics[activeIndex] || null : null,
    currentIndex: activeIndex,
  };
}
