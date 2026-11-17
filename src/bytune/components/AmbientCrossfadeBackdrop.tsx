import { useEffect, useRef, useState } from "react";
import { usePlayer } from "../stores/player";
import { useArtworkPalette, type ArtworkPalette } from "../lib/palette";

const CROSSFADE_MS = 4200;

interface BackdropLayer {
  id: number;
  trackKey: string;
  thumb: string | null;
  palette: ArtworkPalette;
}

function buildLayerGradient(palette: ArtworkPalette, intensity: "shell" | "lyrics"): string {
  if (intensity === "lyrics") {
    return `
      radial-gradient(56% 48% at 20% 16%, rgb(${palette.accent} / 0.24), transparent 72%),
      radial-gradient(50% 44% at 82% 84%, rgb(${palette.wash} / 0.28), transparent 70%),
      radial-gradient(64% 56% at 50% 45%, rgb(${palette.elevated} / 0.16), transparent 76%),
      linear-gradient(180deg, rgb(${palette.background}) 0%, rgb(${palette.background} / 0.94) 100%)
    `;
  }
  return `
    radial-gradient(1200px 760px at 12% -14%, rgb(${palette.accent} / 0.16), transparent 64%),
    radial-gradient(1000px 680px at 94% -10%, rgb(${palette.elevated} / 0.14), transparent 60%),
    radial-gradient(1500px 860px at 50% 118%, rgb(${palette.wash} / 0.12), transparent 64%),
    linear-gradient(180deg, rgb(${palette.background} / 0.35) 0%, transparent 65%)
  `;
}

export interface AmbientCrossfadeBackdropProps {
  /** Override track key; defaults to the active player track ID. */
  trackKey?: string | null;
  /** Override artwork URL; defaults to the active player track thumbnail. */
  thumb?: string | null;
  /** Visual prominence: subtle for app shell, richer for focused lyrics view. */
  intensity?: "shell" | "lyrics";
  className?: string;
}

/**
 * Animated double-buffered backdrop wrapper that melts album artwork hues and
 * color palettes over a slow weather-like transition (`4.2s`) using a
 * `backdrop-filter: blur(50px)` atmospheric veil.
 */
export function AmbientCrossfadeBackdrop({
  trackKey,
  thumb,
  intensity = "shell",
  className = "",
}: AmbientCrossfadeBackdropProps) {
  const activeTrack = usePlayer((s) => s.queue[s.index] ?? null);
  const resolvedThumb = thumb !== undefined ? thumb : (activeTrack?.thumb ?? null);
  const resolvedKey =
    (trackKey !== undefined ? trackKey : (activeTrack?.id ?? null)) ?? resolvedThumb ?? "__default__";

  const palette = useArtworkPalette(resolvedThumb);

  const [curr, setCurr] = useState<BackdropLayer>(() => ({
    id: 1,
    trackKey: resolvedKey,
    thumb: resolvedThumb,
    palette,
  }));
  const [prev, setPrev] = useState<BackdropLayer | null>(null);
  const seqRef = useRef(1);
  const keyRef = useRef(resolvedKey);

  useEffect(() => {
    if (resolvedKey !== keyRef.current) {
      keyRef.current = resolvedKey;
      const nextId = ++seqRef.current;
      setCurr((previousCurr) => {
        setPrev((existingPrev) => existingPrev ?? previousCurr);
        return {
          id: nextId,
          trackKey: resolvedKey,
          thumb: resolvedThumb,
          palette,
        };
      });
    } else {
      // Async palette decode settled for the current song: update colors smoothly without resetting the fade.
      setCurr((c) =>
        c.thumb === resolvedThumb &&
        c.palette.background === palette.background &&
        c.palette.accent === palette.accent &&
        c.palette.wash === palette.wash &&
        c.palette.elevated === palette.elevated
          ? c
          : { ...c, thumb: resolvedThumb, palette }
      );
    }
  }, [resolvedKey, resolvedThumb, palette]);

  useEffect(() => {
    if (!prev) return;
    const timer = window.setTimeout(() => {
      setPrev((currentPrev) => (currentPrev?.id === prev.id ? null : currentPrev));
    }, CROSSFADE_MS + 80);
    return () => window.clearTimeout(timer);
  }, [prev]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {prev && (
        <div
          key={`out-${prev.id}`}
          className="ambient-crossfade-layer ambient-crossfade-out"
          style={{ background: buildLayerGradient(prev.palette, intensity) }}
        >
          {prev.thumb && (
            <img
              src={prev.thumb}
              alt=""
              className="absolute inset-0 h-full w-full object-cover scale-125 opacity-[0.12] saturate-150"
            />
          )}
        </div>
      )}
      <div
        key={`in-${curr.id}`}
        className={`ambient-crossfade-layer ${prev ? "ambient-crossfade-in" : ""}`}
        style={{ background: buildLayerGradient(curr.palette, intensity) }}
      >
        {curr.thumb && (
          <img
            src={curr.thumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover scale-125 opacity-[0.12] saturate-150"
          />
        )}
      </div>
      <div className="ambient-blur-veil" />
    </div>
  );
}
