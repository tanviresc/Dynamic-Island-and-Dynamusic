import { useEffect, useRef, useState } from "react";
import { shownTrack, usePlayer } from "../stores/player";
import { useArtworkPalette, type ArtworkPalette } from "../lib/palette";

const MOBILE_CROSSFADE_MS = 4200;

interface MobileBackdropLayer {
  id: number;
  trackKey: string;
  thumb: string | null;
  palette: ArtworkPalette;
}

function mobileGradientForPalette(
  palette: ArtworkPalette,
  intensity: "shell" | "fullscreen"
): string {
  if (intensity === "fullscreen") {
    return `
      radial-gradient(56% 46% at 24% 20%, rgb(${palette.accent} / 0.28), transparent 70%),
      radial-gradient(52% 44% at 78% 76%, rgb(${palette.wash} / 0.30), transparent 68%),
      radial-gradient(64% 52% at 50% 42%, rgb(${palette.elevated} / 0.16), transparent 76%),
      linear-gradient(180deg, rgb(${palette.background}) 0%, #0a0a0d 92%)
    `;
  }
  return `
    radial-gradient(95% 58% at 15% -10%, rgb(${palette.accent} / 0.20), transparent 65%),
    radial-gradient(85% 55% at 88% -8%, rgb(${palette.elevated} / 0.16), transparent 62%),
    radial-gradient(110% 60% at 50% 110%, rgb(${palette.wash} / 0.12), transparent 64%),
    linear-gradient(180deg, rgb(${palette.background} / 0.42) 0%, transparent 65%)
  `;
}

export interface MobileCrossfadeBackdropProps {
  trackKey?: string | null;
  thumb?: string | null;
  intensity?: "shell" | "fullscreen";
  className?: string;
}

/**
 * Double-buffered atmospheric weather crossfade backdrop for mobile phones & Android APKs.
 * Melts previous album art hues and palettes slowly into the next (`4.2s`) behind a
 * GPU-composited `backdrop-filter: blur(50px)` veil with zero abrupt snaps.
 */
export function MobileCrossfadeBackdrop({
  trackKey,
  thumb,
  intensity = "shell",
  className = "",
}: MobileCrossfadeBackdropProps) {
  const activeTrack = usePlayer(shownTrack);
  const resolvedThumb = thumb !== undefined ? thumb : (activeTrack?.thumb ?? null);
  const resolvedKey =
    (trackKey !== undefined ? trackKey : (activeTrack?.id ?? null)) ?? resolvedThumb ?? "__default__";

  const palette = useArtworkPalette(resolvedThumb);

  const [curr, setCurr] = useState<MobileBackdropLayer>(() => ({
    id: 1,
    trackKey: resolvedKey,
    thumb: resolvedThumb,
    palette,
  }));
  const [prev, setPrev] = useState<MobileBackdropLayer | null>(null);
  const seqRef = useRef(1);
  const keyRef = useRef(resolvedKey);

  useEffect(() => {
    if (resolvedKey !== keyRef.current) {
      keyRef.current = resolvedKey;
      const nextId = ++seqRef.current;
      setCurr((previous) => {
        setPrev((existingPrev) => existingPrev ?? previous);
        return { id: nextId, trackKey: resolvedKey, thumb: resolvedThumb, palette };
      });
    } else {
      setCurr((c) =>
        c.thumb === resolvedThumb &&
        c.palette.background === palette.background &&
        c.palette.accent === palette.accent &&
        c.palette.wash === palette.wash
          ? c
          : { ...c, thumb: resolvedThumb, palette }
      );
    }
  }, [resolvedKey, resolvedThumb, palette]);

  useEffect(() => {
    if (!prev) return;
    const timer = window.setTimeout(() => {
      setPrev((p) => (p?.id === prev.id ? null : p));
    }, MOBILE_CROSSFADE_MS + 80);
    return () => window.clearTimeout(timer);
  }, [prev]);

  return (
    <div
      aria-hidden="true"
      className={`pointer-events-none absolute inset-0 overflow-hidden ${className}`}
    >
      {prev && (
        <div
          key={`mob-out-${prev.id}`}
          className="ambient-crossfade-layer ambient-crossfade-out"
          style={{ background: mobileGradientForPalette(prev.palette, intensity) }}
        >
          {prev.thumb && intensity === "fullscreen" && (
            <img
              src={prev.thumb}
              alt=""
              className="absolute inset-0 h-full w-full object-cover scale-125 opacity-[0.14] saturate-150"
            />
          )}
        </div>
      )}
      <div
        key={`mob-in-${curr.id}`}
        className={`ambient-crossfade-layer ${prev ? "ambient-crossfade-in" : ""}`}
        style={{ background: mobileGradientForPalette(curr.palette, intensity) }}
      >
        {curr.thumb && intensity === "fullscreen" && (
          <img
            src={curr.thumb}
            alt=""
            className="absolute inset-0 h-full w-full object-cover scale-125 opacity-[0.14] saturate-150"
          />
        )}
      </div>
      <div className="ambient-blur-veil" />
      {intensity === "fullscreen" && (
        <div className="absolute inset-0 bg-gradient-to-b from-black/10 via-black/[0.04] to-black/25" />
      )}
    </div>
  );
}
