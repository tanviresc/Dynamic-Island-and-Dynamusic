/**
 * LyricsCenter — synced lyrics in the centre pane, Spotify-style.
 *
 * Toggled by the lyrics button in the player bar: the whole content area
 * becomes a artwork-tinted lyrics surface (solid palette floor + subtle
 * accent blobs — no blurred sleeve, matching the flat tint of Spotify's
 * lyrics view) with the large synced-lines treatment from LyricsView.
 */
import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { LyricsView } from "./SyncedLyrics";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";
import { useArtworkPalette } from "../lib/palette";
import { useLyricsOffset } from "../lib/lyricsOffset";
import { getCachedLyrics, saveCachedLyrics } from "../lib/lyricsCache";
import { LyricsTiming } from "./LyricsTiming";
import type { LyricsResult, Track } from "../types";

/* Lyrics are fetched the moment a track starts (see prefetchLyrics) so the
   view opens with words already on screen instead of a spinner over silence.
   Persistent IndexedDB/localStorage caching makes repeat & offline loads instant. */
const lyricsCache = new Map<string, Promise<LyricsResult | null>>();

export function invalidateLyricsCache(trackId: string): void {
  lyricsCache.delete(trackId);
}

export function requestLyrics(
  track: Track,
  opts?: { force?: boolean; customTitle?: string; customArtist?: string }
): Promise<LyricsResult | null> {
  const bypassMem = Boolean(opts?.force || opts?.customTitle || opts?.customArtist);
  let p = !bypassMem ? lyricsCache.get(track.id) : undefined;
  if (!p) {
    p = (async (): Promise<LyricsResult | null> => {
      if (!bypassMem) {
        const stored = await getCachedLyrics(track);
        if (stored) return stored;
      }
      if (!window.bytune) return null;
      const res = await window.bytune.getLyrics({
        id: track.id,
        title: opts?.customTitle?.trim() || track.title,
        artist: opts?.customArtist?.trim() || track.artist,
        album: track.album,
        duration: track.duration || undefined,
      });
      if (res && (res.synced?.length || res.plain)) {
        void saveCachedLyrics(track, res);
        return res;
      }
      if (!bypassMem) lyricsCache.delete(track.id);
      return res ?? null;
    })().catch(() => {
      if (!bypassMem) lyricsCache.delete(track.id);
      return null;
    });
    if (!bypassMem) {
      lyricsCache.set(track.id, p);
      if (lyricsCache.size > 24) {
        const oldest = lyricsCache.keys().next().value;
        if (oldest) lyricsCache.delete(oldest);
      }
    }
  }
  return p;
}

export async function searchLyricsManually(
  track: Track,
  query: { title: string; artist: string }
): Promise<LyricsResult | null> {
  invalidateLyricsCache(track.id);
  const res = await requestLyrics(track, {
    force: true,
    customTitle: query.title,
    customArtist: query.artist,
  });
  if (res && (res.synced?.length || res.plain)) {
    lyricsCache.set(track.id, Promise.resolve(res));
  }
  return res;
}

/** Fire-and-forget: warm the lyrics cache when a track starts playing. */
export function prefetchLyrics(track: Track | null): void {
  if (track) void requestLyrics(track);
}

export function LyricsCenter() {
  const track = usePlayer((s) => s.queue[s.index] ?? null);
  const close = () => useUI.setState({ lyricsCenter: false });

  const [lyrics, setLyrics] = useState<LyricsResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    if (!track?.id) {
      setLyrics(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    void requestLyrics(track, reloadNonce > 0 ? { force: true } : undefined).then((r) => {
      if (!cancelled) {
        setLyrics(r ?? null);
        setLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [track?.id, reloadNonce]);

  // The listener's own timing: this song's nudge and this device's setting.
  const offset = useLyricsOffset(track?.id);

  const palette = useArtworkPalette(track?.thumb ?? null);

  return (
    <div
      className="group relative flex-1 min-h-0 rounded-2xl overflow-hidden animate-fade-in"
      style={{ background: `rgb(${palette.background})` }}
    >
      {/* Subtle artwork-coloured blobs over the palette floor. */}
      <div
        className="absolute -inset-[10%] pointer-events-none"
        style={{
          background: `radial-gradient(46% 40% at 24% 18%, rgb(${palette.accent} / 0.16), transparent 70%),
                       radial-gradient(42% 38% at 78% 82%, rgb(${palette.wash} / 0.22), transparent 68%)`,
        }}
      />

      <button
        onClick={close}
        title="Close lyrics (Esc)"
        aria-label="Close lyrics"
        className="absolute top-4 right-4 z-10 w-9 h-9 grid place-items-center rounded-full bg-black/40 text-ink-hi/75 hover:text-ink-hi hover:bg-black/60 transition-colors"
      >
        <X className="w-[18px] h-[18px]" />
      </button>
      {track && <LyricsTiming trackId={track.id} className="absolute top-4 right-16 z-10" />}

      <div className="relative h-full flex flex-col px-10 pt-14 pb-6">
        {track ? (
          /* Keyed by track: a new song remounts the view, so the scroll
             position resets to the top instead of staying where the previous
             song's lyrics ended. */
          <LyricsView
            key={track.id}
            trackKey={track.id}
            track={track}
            lyrics={lyrics}
            loading={loading}
            large
            offset={offset}
            onRetry={() => {
              invalidateLyricsCache(track.id);
              setReloadNonce((n) => n + 1);
            }}
            onLyricsOverride={(r) => setLyrics(r)}
          />
        ) : (
          <div className="flex-1 grid place-items-center">
            <p className="text-[15px] text-ink-hi/60">Play something to sing along.</p>
          </div>
        )}
      </div>
    </div>
  );
}
