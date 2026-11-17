/**
 * Time-synced lyrics — the premium pass.
 *
 * Only a handful of lines are readable at once: the active line is large,
 * bright and softly glowing, and every line away from it loses size, opacity
 * and focus progressively, so the panel reads as depth rather than a list.
 * Word-synced providers get the karaoke sweep; silence gaps render as
 * breathing dots. Click a line to seek there.
 *
 * The store's position updates on `timeupdate` (~4Hz) — too coarse for a
 * word sweep, so the active word-synced line advances off its own rAF loop
 * reading the live element clock.
 */
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { RefreshCw, Search } from "lucide-react";
import { getPlaybackPosition } from "../lib/audio";
import { getPlaybackClock, setPlaybackClock, subscribePlaybackClock } from "../lib/playbackClock";
import { visibleLyricLines, cleanMobileLyricLines } from "../lib/lyricsLines";
import { cleanTrackQuery } from "../lib/mobileStandaloneFallback";
import { romanize } from "../lib/romanize";
import { LYRICS_LOADING_LINES, pickLyricsLine } from "../lib/lyricsPhrases";
import { usePlayer } from "../stores/player";
import { useSettings } from "../stores/settings";
import { getInterpolatedPcPosition, useMobileMode } from "../stores/mobileMode";
import { ACTIVE_LINE_LEAD_SEC, LYRICS_LINE_CHUNK_SIZE, buildLineWordModel, computeActiveLyricIndex, easeMelodyProgress } from "../lib/wordTiming";
import type { LyricsResult, SyncedLyricWord, Track } from "../types";

/** How long the GPU transform glide takes to ease to the next lyric line. */
const GLIDE_MS = 540;

interface LyricsViewProps {
  lyrics: LyricsResult | null;
  loading: boolean;
  large?: boolean;
  /** Fullscreen scale — the same treatments as `large`, sized for the
      fullscreen panel's height. Container, spacing and type only. */
  hero?: boolean;
  /** Where the live line's centre rests, as a fraction of the container's
      height (0.5 = dead centre). The fullscreen player measures the album
      cover's centre and passes that fraction, so the live line sits exactly
      beside it; everything else keeps the centred anchor. */
  anchor?: number;
  /** The playing track's id — pins the loading copy to one line per track. */
  trackKey?: string;
  track?: Track | null;
  onRetry?: () => void;
  onLyricsOverride?: (res: LyricsResult | null) => void;
}

type LyricsVariant = "compact" | "large" | "hero";

/** Line type scale — `hero` is the fullscreen variant of `large`. */
/** Background vocals and romanized readings: a quieter line under the lyric. */
function subLineClass(variant: LyricsVariant): string {
  switch (variant) {
    case "hero":
      return "font-display text-[clamp(17px,1.9vw,28px)] leading-[1.3] font-bold";
    case "large":
      return "font-display text-[22px] leading-[1.3] font-bold";
    default:
      return "font-display text-[15px] leading-[1.35] font-bold";
  }
}

function lineSizeClass(variant: LyricsVariant): string {
  switch (variant) {
    case "hero":
      return "font-display text-[clamp(24px,3.4vw,54px)] leading-[1.22] tracking-[-0.03em] font-extrabold break-words";
    case "large":
      return "font-display text-[clamp(24px,3.4vw,40px)] leading-[1.25] tracking-[-0.03em] font-extrabold break-words";
    default:
      return "font-display text-[22px] sm:text-[24px] leading-[1.4] tracking-[-0.02em] font-extrabold break-words";
  }
}

/** Karaoke sweep across one line's words locked smoothly to vocal phrasing. */
function WordLine({
  words,
  spans,
  spaced = true,
  variant,
  glow,
  offset,
  isPlaying,
  isPcRemote = false,
  isMobileDevice = false,
}: {
  words: SyncedLyricWord[];
  spans: Array<{ start: number; end: number }>;
  spaced?: boolean;
  variant: LyricsVariant;
  glow: boolean;
  offset: number;
  isPlaying: boolean;
  isPcRemote?: boolean;
  isMobileDevice?: boolean;
}) {
  const [, force] = useState(0);
  useEffect(() => {
    // Pause rAF when paused or backgrounded so idle/minimized windows burn zero CPU.
    if (!isPlaying) return;
    let raf = 0;
    let lastTick = 0;
    // 60fps on desktop (~16ms) and crisp ~30fps step on mobile APK with smooth CSS interpolation.
    const frameIntervalMs = isMobileDevice ? 28 : 16;
    const stop = (): void => {
      if (raf) {
        window.cancelAnimationFrame(raf);
        raf = 0;
      }
    };
    const tick = (now: number): void => {
      if (document.hidden) {
        raf = 0;
        return;
      }
      if (now - lastTick >= frameIntervalMs) {
        lastTick = now;
        force((n) => (n + 1) % 1000000);
      }
      raf = window.requestAnimationFrame(tick);
    };
    const onVisibility = (): void => {
      if (document.hidden) {
        stop();
      } else if (!raf) {
        raf = window.requestAnimationFrame(tick);
      }
    };
    if (!document.hidden) {
      raf = window.requestAnimationFrame(tick);
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [isPlaying, isMobileDevice]);

  const rawPos = isPcRemote
    ? getInterpolatedPcPosition(useMobileMode.getState().pcState)
    : (() => {
        const liveClock = getPlaybackPosition();
        return liveClock > 0 ? liveClock : getPlaybackClock().position;
      })();
  const pos = rawPos - offset + 0.08;
  return (
    <span
      className={`${lineSizeClass(variant)} text-white`}
      style={glow ? { filter: "drop-shadow(0 0 24px rgba(255,255,255,0.45))" } : undefined}
    >
      {words.map((w, i) => {
        const span = spans[i] ?? { start: w.start, end: w.end };
        const rawP =
          span.end > span.start
            ? Math.min(1, Math.max(0, (pos - span.start) / (span.end - span.start)))
            : pos >= span.start
              ? 1
              : 0;
        const p = easeMelodyProgress(rawP);
        const pct = Math.round(p * 100);
        const singingNow = rawP > 0 && rawP < 1;
        return (
          <span
            key={i}
            style={
              isMobileDevice
                ? {
                    backgroundImage: "linear-gradient(90deg, #ffffff 50%, rgba(255,255,255,0.46) 50%)",
                    backgroundSize: "200% 100%",
                    backgroundPosition: `${100 - pct}% 0`,
                    transition: isPlaying && singingNow ? "background-position 40ms linear" : undefined,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                  }
                : {
                    backgroundImage: `linear-gradient(90deg, #ffffff ${pct}%, rgba(255,255,255,0.46) ${pct}%)`,
                    WebkitBackgroundClip: "text",
                    backgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    filter: singingNow ? "drop-shadow(0 0 12px rgba(255,255,255,0.6))" : undefined,
                  }
            }
          >
            {spaced && i > 0 ? " " : ""}
            {w.text}
          </span>
        );
      })}
    </span>
  );
}

/** Distance-from-active → the depth treatment: opacity, dynamic blur (up to 4px), scale.
 * Active line (dist === 0) stays razor-sharp and prominent while surrounding past and
 * upcoming lines softly recede with smooth opacity and blur transitions. */
function depthStyle(
  dist: number,
  past: boolean,
  blur: boolean,
  centered = false,
): { className: string; style: React.CSSProperties } {
  const d = Math.min(Math.abs(dist), 4);
  const opacity = (centered ? [1, 0.34, 0.24, 0.17, 0.12][d] : [1, 0.56, 0.38, 0.28, 0.20][d]) * (past && d > 0 ? 0.85 : 1);
  const blurPx = blur ? [0, 1.5, 2.6, 3.4, 4.0][d] : 0;
  const scale = [1.04, 0.98, 0.96, 0.94, 0.92][d];
  return {
    className: "transition-[opacity,transform,filter] duration-500 ease-out",
    style: {
      opacity,
      filter: d === 0 || blurPx === 0 ? "none" : `blur(${blurPx}px)`,
      transform: `translateZ(0) scale(${scale})`,
      transformOrigin: centered ? "center center" : "left center",
      willChange: d <= 2 ? "transform, opacity, filter" : undefined,
    },
  };
}

export function LyricsView({
  lyrics,
  loading,
  large = false,
  hero = false,
  anchor = 0.5,
  offset = 0,
  trackKey,
  track = null,
  onRetry,
  onLyricsOverride,
}: LyricsViewProps & { offset?: number }) {
  const variant: LyricsVariant = hero ? "hero" : large ? "large" : "compact";
  const mobileMode = useMobileMode((s) => s.mode);
  const isMobileDevice = useMobileMode((s) => s.isMobileDevice);
  const pcState = useMobileMode((s) => s.pcState);
  const isPcRemote = mobileMode === "pc_remote" && !!pcState?.track;

  const [manualOpen, setManualOpen] = useState(false);
  const [manualTitle, setManualTitle] = useState(() =>
    cleanTrackQuery(track?.title ?? "", track?.artist ?? "").title
  );
  const [manualArtist, setManualArtist] = useState(() =>
    cleanTrackQuery(track?.title ?? "", track?.artist ?? "").artist
  );
  const [manualBusy, setManualBusy] = useState(false);
  const [manualMiss, setManualMiss] = useState(false);

  const localPlaying = usePlayer((s) => s.playing);
  const playing = isPcRemote ? Boolean(pcState?.playing) : localPlaying;

  const seek = (targetTime: number) => {
    if (isPcRemote) {
      useMobileMode.getState().sendPcCommand("seek", targetTime);
    } else {
      usePlayer.getState().seek(targetTime);
    }
  };
  // Appearance switches with defined mobile behavior: synced lyrics gates
  // the whole synced treatment, blur de-emphasis is separately toggled,
  // and the glow yields to reduced motion / reduced blur.
  const syncedOn = useSettings((s) => s.syncedLyrics);
  const blurOn = useSettings((s) => s.blurUnfocusedLyrics);
  const romanOn = useSettings((s) => s.romanizeLyrics);
  const reduceMotion = useSettings((s) => s.reduceAnimation);
  const reduceBlur = useSettings((s) => s.reduceDynamicBlur);
  const blurLines = blurOn && !reduceBlur;
  const glowLines = blurOn && !reduceMotion && !reduceBlur && !isMobileDevice;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const translateYRef = useRef(0);
  const lastIndex = useRef(-1);
  const [manualScroll, setManualScroll] = useState(false);

  useEffect(() => {
    setManualScroll(false);
    translateYRef.current = 0;
    lastIndex.current = -1;
    if (containerRef.current) containerRef.current.scrollTop = 0;
    if (listRef.current) {
      listRef.current.style.transition = "none";
      listRef.current.style.transform = "translate3d(0, 0px, 0)";
    }
  }, [trackKey]);

  // BitChord mobile's LyricsLoadingLine: the lookup's stand-in is one of the
  // loading phrases — no spinner — picked once per track and held there.
  const loadingPhrase = useMemo(() => pickLyricsLine(LYRICS_LOADING_LINES), [trackKey]);

  const synced = lyrics?.synced ?? null;

  const lines = useMemo(
    () => (synced ? cleanMobileLyricLines(visibleLyricLines(synced), isMobileDevice, track?.artist) : null),
    [synced, isMobileDevice, track?.artist]
  );

  // Static text for the plain (unsynced) treatment: the provider's plain
  // lyrics when they exist, otherwise the synced lines' own words joined in
  // order — so switching synced lyrics OFF never blanks the panel on tracks
  // that only shipped synced lines. Gap/instrumental markers carry no words.
  const staticText = useMemo(() => {
    if (lyrics?.plain && lyrics.plain.trim()) return lyrics.plain;
    const fromSynced = (lines ?? [])
      .map((l) => l.text.trim())
      .filter((t) => t.length > 0)
      .join("\n")
      .trim();
    return fromSynced || null;
  }, [lyrics, lines]);

  // Lyric times live on the matched recording's timeline; the playing upload
  // may prepend an intro (music videos). offset converts element position →
  // Quantized scalar activeIndex subscription: LyricsView only re-renders when
  // the sung line actually changes, not on every clock tick.
  const localActiveIndex = useSyncExternalStore(subscribePlaybackClock, () =>
    isPcRemote ? -1 : computeActiveLyricIndex(lines, getPlaybackClock().position, offset)
  );
  const [remoteActiveIndex, setRemoteActiveIndex] = useState(() =>
    isPcRemote ? computeActiveLyricIndex(lines, getInterpolatedPcPosition(pcState), offset) : -1
  );
  useEffect(() => {
    if (!isPcRemote) {
      setRemoteActiveIndex(-1);
      return;
    }
    const update = (): void => {
      const next = computeActiveLyricIndex(
        lines,
        getInterpolatedPcPosition(useMobileMode.getState().pcState),
        offset
      );
      setRemoteActiveIndex((prev) => (prev === next ? prev : next));
    };
    update();
    if (!pcState?.playing) return;
    const id = window.setInterval(update, 120);
    return () => window.clearInterval(id);
  }, [isPcRemote, lines, offset, pcState?.playing, pcState?.position, pcState?.serverTimestamp, pcState?.track?.id]);

  const activeIndex = isPcRemote ? remoteActiveIndex : localActiveIndex;
  const playbackSpeed = useSettings((s) => s.playbackSpeed || 1);

  // Lazy-mount lyric lines in small chunks (LYRICS_LINE_CHUNK_SIZE = 20) so long
  // enhanced-LRC tracks never block main-thread layout on start or track switch.
  const totalLines = lines?.length ?? 0;
  const [renderedLinesCount, setRenderedLinesCount] = useState(() =>
    Math.min(totalLines, Math.max(LYRICS_LINE_CHUNK_SIZE, activeIndex + LYRICS_LINE_CHUNK_SIZE))
  );
  useEffect(() => {
    const needed = Math.min(totalLines, Math.max(LYRICS_LINE_CHUNK_SIZE, activeIndex + LYRICS_LINE_CHUNK_SIZE));
    setRenderedLinesCount((prev) => (prev >= needed ? prev : needed));
  }, [activeIndex, totalLines]);
  useEffect(() => {
    setRenderedLinesCount(Math.min(totalLines, LYRICS_LINE_CHUNK_SIZE));
  }, [trackKey, totalLines]);
  useEffect(() => {
    if (renderedLinesCount >= totalLines) return;
    const timer = window.setTimeout(() => {
      setRenderedLinesCount((prev) => Math.min(totalLines, prev + LYRICS_LINE_CHUNK_SIZE));
    }, 80);
    return () => window.clearTimeout(timer);
  }, [renderedLinesCount, totalLines]);

  // Wake up on the exact next lyric boundary instead of waiting up to ~300ms for HTML5 `timeupdate`,
  // keeping zero background polling timers while switching lines right on beat.
  useEffect(() => {
    if (isPcRemote || !playing || !syncedOn || !lines || lines.length === 0) return;
    const nextIdx = activeIndex + 1;
    if (nextIdx < 0 || nextIdx >= lines.length) return;
    const targetSec = lines[nextIdx].time;
    const livePos = getPlaybackPosition();
    const curPos = livePos > 0 ? livePos : getPlaybackClock().position;
    const secUntil = targetSec - (curPos - offset + ACTIVE_LINE_LEAD_SEC);
    const delayMs = Math.max(8, Math.round((secUntil / playbackSpeed) * 1000) + 6);
    if (delayMs > 60_000) return;
    const timer = window.setTimeout(() => {
      const fresh = getPlaybackPosition();
      if (fresh > 0) setPlaybackClock(fresh);
    }, delayMs);
    return () => window.clearTimeout(timer);
  }, [activeIndex, isPcRemote, lines, offset, playbackSpeed, playing, syncedOn]);

  // Keep the active line anchored at 60fps via GPU-composited `translate3d`
  // transforms instead of mutating `scrollTop` inside a per-frame JS loop.
  useEffect(() => {
    if (activeIndex < 0 || manualScroll) return;
    const prevIdx = lastIndex.current;
    const lineChanged = activeIndex !== prevIdx;
    lastIndex.current = activeIndex;

    const raf = window.requestAnimationFrame(() => {
      const container = containerRef.current;
      const list = listRef.current;
      const el = activeRef.current;
      if (!container || !list || !el) return;

      if (container.scrollTop !== 0) {
        const handoffY = -container.scrollTop;
        container.scrollTop = 0;
        translateYRef.current = handoffY;
        list.style.transition = "none";
        list.style.transform = `translate3d(0, ${handoffY}px, 0)`;
        void list.offsetHeight;
      }

      const cRect = container.getBoundingClientRect();
      const eRect = el.getBoundingClientRect();
      const naturalMid = eRect.top - cRect.top - translateYRef.current + eRect.height / 2;
      const targetY = Math.round(Math.min(0, container.clientHeight * anchor - naturalMid));

      const still =
        reduceMotion ||
        document.documentElement.classList.contains("reduce-motion") ||
        window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const jump = Math.abs(targetY - translateYRef.current);
      const instant = still || !lineChanged || prevIdx < 0 || jump > container.clientHeight * 1.4;

      list.style.transition = instant
        ? "none"
        : `transform ${GLIDE_MS}ms cubic-bezier(0.22, 1, 0.36, 1)`;
      translateYRef.current = targetY;
      list.style.transform = `translate3d(0, ${targetY}px, 0)`;
    });
    return () => window.cancelAnimationFrame(raf);
  }, [activeIndex, synced, anchor, manualScroll, reduceMotion]);

  const stopGlide = (): void => {
    setRenderedLinesCount(totalLines);
    if (manualScroll) return;
    const container = containerRef.current;
    const list = listRef.current;
    const currentY = translateYRef.current;
    if (list) {
      list.style.transition = "none";
      list.style.transform = "translate3d(0, 0px, 0)";
    }
    translateYRef.current = 0;
    if (container && currentY < 0) {
      container.scrollTop = Math.max(0, -currentY);
    }
    setManualScroll(true);
  };

  const resumeAutoFollow = (): void => {
    setManualScroll(false);
  };

  if (loading) {
    if (isMobileDevice) {
      return (
        <div
          className="flex-1 w-full flex items-center justify-center text-center px-6 py-12"
          style={{ textAlign: "center" }}
        >
          <span
            className={`font-display font-extrabold text-ink-hi/60 animate-pulse text-center ${
              hero
                ? "text-[28px] tracking-[-0.02em]"
                : large
                  ? "text-[26px] tracking-[-0.02em]"
                  : "text-[18px]"
            }`}
          >
            Getting the words
          </span>
        </div>
      );
    }
    // Words, not a spinner — mobile's LyricsLoadingLine, dimmed like an
    // unsung line.
    return (
      <div className="flex justify-center py-12">
        <span
          className={`font-display font-extrabold text-ink-hi/55 animate-pulse ${
            hero
              ? "text-[30px] tracking-[-0.02em]"
              : large
                ? "text-[28px] tracking-[-0.02em]"
                : "text-[18px]"
          }`}
        >
          {loadingPhrase}
        </span>
      </div>
    );
  }

  if (!lyrics || !staticText) {
    const activeTrack = track ?? usePlayer.getState().currentTrack;
    const handleManualSubmit = async (e: React.FormEvent): Promise<void> => {
      e.preventDefault();
      if (!activeTrack || manualBusy) return;
      const qTitle = manualTitle.trim() || activeTrack.title;
      const qArtist = manualArtist.trim() || activeTrack.artist;
      setManualBusy(true);
      setManualMiss(false);
      try {
        const { searchLyricsManually } = await import("./LyricsCenter");
        const found = await searchLyricsManually(activeTrack, { title: qTitle, artist: qArtist });
        if (found && (found.synced?.length || found.plain)) {
          onLyricsOverride?.(found);
        } else {
          setManualMiss(true);
        }
      } finally {
        setManualBusy(false);
      }
    };

    return (
      <div className={`flex flex-col items-center justify-center text-center px-4 ${hero ? "py-12" : large ? "py-12" : "py-8"}`}>
        <p className={`text-ink-faint ${hero ? "text-lg" : large ? "text-base" : "text-sm"}`}>
          No lyrics available for this track.
        </p>
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.1] hover:bg-white/[0.16] text-white text-[13px] font-medium transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Retry
            </button>
          )}
          {activeTrack && (
            <button
              type="button"
              onClick={() => {
                const cleaned = cleanTrackQuery(activeTrack.title, activeTrack.artist);
                if (!manualTitle) setManualTitle(cleaned.title);
                if (!manualArtist) setManualArtist(cleaned.artist);
                setManualOpen((v) => !v);
                setManualMiss(false);
              }}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/[0.08] hover:bg-white/[0.14] text-white/85 text-[13px] font-medium transition-colors"
            >
              <Search className="w-3.5 h-3.5" />
              Search manually
            </button>
          )}
        </div>
        {manualOpen && (
          <form onSubmit={handleManualSubmit} className="mt-4 w-full max-w-xs flex flex-col gap-2 text-left">
            <input
              type="text"
              value={manualTitle}
              onChange={(e) => setManualTitle(e.target.value)}
              placeholder="Track title"
              className="w-full px-3 py-1.5 rounded-lg bg-white/[0.08] border border-white/15 text-white text-[13px] placeholder:text-white/40 focus:outline-none focus:border-white/35"
            />
            <input
              type="text"
              value={manualArtist}
              onChange={(e) => setManualArtist(e.target.value)}
              placeholder="Artist name"
              className="w-full px-3 py-1.5 rounded-lg bg-white/[0.08] border border-white/15 text-white text-[13px] placeholder:text-white/40 focus:outline-none focus:border-white/35"
            />
            <button
              type="submit"
              disabled={manualBusy}
              className="w-full py-1.5 rounded-lg bg-white text-black text-[13px] font-semibold hover:bg-white/90 disabled:opacity-50 transition-colors"
            >
              {manualBusy ? "Searching..." : "Find lyrics"}
            </button>
            {manualMiss && (
              <p className="text-center text-[12px] text-white/55">
                No match found — try shortening title or artist.
              </p>
            )}
          </form>
        )}
      </div>
    );
  }

  if (synced && syncedOn) {
    // Spacers: the scroll target puts the active line's centre at `anchor` ×
    // container height. The bottom spacer lets the last lines reach the
    // anchor too. % heights resolve against the scroller's own (definite,
    // absolute-positioned) height; the −fudge is ~half a line so the line
    // *centre* lands on the anchor. `max(...,12px)` keeps a sane gap if the
    // anchor ever measures near an edge.
    const headFudge = hero ? 36 : large ? 28 : 20;
    // Both panels park the lyric list at the top of the area: a small fixed
    // head spacer (just under the top melt mask's full-opacity line) instead
    // of the anchor pre-centre, and it never changes size — the intro view and
    // the first active line sit at exactly the same height, so singing
    // starting cannot reposition the list. Later lines glide down to the
    // anchor (fullscreen: beside the cover) and stay on it through the normal
    // auto-scroll once their offset outgrows the scroll clamp.
    const topSpacer = "calc(10% + 4px)";
    const bottomSpacer = `max(12px, calc(${(1 - anchor) * 100}% - ${headFudge}px))`;
    return (
      <div
        className="relative flex-1 min-h-0 -mx-6"
        style={{
          // Horizontal twin of the vertical melt below: the active line's glow
          // halo fades out toward the panel edges instead of stopping on a hard
          // vertical line at the clip boundary. The -mx-6 above gives the halo
          // 24px of room to fade in (px-6 on the scroller keeps text in place).
          maskImage:
            "linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)",
          WebkitMaskImage:
            "linear-gradient(to right, transparent 0%, black 24px, black calc(100% - 24px), transparent 100%)",
        }}
      >
        <div
          ref={containerRef}
          // Scrolling by hand switches seamlessly from GPU transform glide to native scroll.
          onWheel={stopGlide}
          onTouchMove={stopGlide}
          className="absolute inset-0 overflow-y-auto scroll-host px-6 py-0"
          style={{
            // Lines melt into the dark at the panel edges instead of stopping hard.
            maskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
            WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 14%, black 86%, transparent 100%)",
          }}
        >
        <div aria-hidden="true" style={{ height: topSpacer, flexShrink: 0 }} />
        <div
          ref={listRef}
          className={`lyrics-lines will-change-transform ${hero ? "space-y-7" : large ? "space-y-5" : "space-y-4"}`}
        >
          {(lines ?? []).slice(0, renderedLinesCount).map((line, i) => {
            const active = i === activeIndex;
            const dist = i - activeIndex;
            const depth = depthStyle(dist, i < activeIndex, blurLines, isMobileDevice);

            if (line.gap) {
              return (
                <div
                  key={`${line.time}-${i}`}
                  className={`flex items-center gap-2 py-2 px-1 ${isMobileDevice ? "justify-center" : ""}`}
                  title="Instrumental"
                  style={{ opacity: Math.max(0.16, depth.style.opacity as number) }}
                >
                  {[0, 1, 2].map((d) => (
                    <span
                      key={d}
                      className={`w-2 h-2 rounded-full ${
                        active
                          ? "bg-white shadow-[0_0_12px_rgba(255,255,255,0.9)] animate-pulse"
                          : "bg-white/40"
                      }`}
                      style={{
                        animationDelay: `${d * 0.22}s`,
                      }}
                    />
                  ))}
                </div>
              );
            }

            const wordModel = active && line.text.trim().length > 0
              ? buildLineWordModel(line, lines?.[i + 1]?.time)
              : null;
            const wordSynced = Boolean(wordModel && wordModel.words.length > 0);

            // Background vocals and a romanized reading follow as quieter lines.
            const roman = romanOn ? (line.roman ?? romanize(line.text)) : null;
            return (
              <button
                key={`${line.time}-${i}`}
                ref={i === activeIndex ? activeRef : undefined}
                onClick={() => {
                  resumeAutoFollow();
                  seek(Math.max(0, line.time + offset - 0.15));
                }}
                title="Jump here"
                className={`group relative block w-full transition-[opacity,transform,filter] duration-500 ease-out ${
                  isMobileDevice ? "text-center origin-center" : "text-left origin-left"
                } ${
                  active
                    ? "text-white font-extrabold px-3 py-1.5"
                    : "text-white/55 font-semibold px-3 py-1.5 hover:text-white/80"
                } ${depth.className}`}
                style={
                  active
                    ? {
                        opacity: 1,
                        filter: "none",
                        transform: "translateZ(0) scale(1.04)",
                        transformOrigin: isMobileDevice ? "center center" : "left center",
                        willChange: "transform, opacity",
                      }
                    : depth.style
                }
              >
                {wordSynced && wordModel ? (
                  <WordLine
                    words={wordModel.words}
                    spans={wordModel.spans}
                    spaced={wordModel.spaced}
                    variant={variant}
                    glow={glowLines}
                    offset={offset}
                    isPlaying={playing}
                    isPcRemote={isPcRemote}
                    isMobileDevice={isMobileDevice}
                  />
                ) : (
                  <span
                    className={`${lineSizeClass(variant)} ${
                      active ? "text-white font-black" : ""
                    }`}
                    style={
                      active
                        ? {
                            color: "#ffffff",
                            textShadow:
                              "0 0 24px rgba(255,255,255,0.6), 0 0 45px rgba(255,255,255,0.25)",
                          }
                        : undefined
                    }
                  >
                    {line.text}
                  </span>
                )}
                {line.bg && <span className={`block mt-1 opacity-70 ${subLineClass(variant)}`}>{line.bg.text}</span>}
                {roman && (
                  <span className={`block mt-1 text-white/60 ${subLineClass(variant)}`}>
                    {roman}
                  </span>
                )}
              </button>
            );
          })}
          {lyrics?.source && (
            <p className={`pt-4 text-[12px] font-medium text-ink-hi/35 ${isMobileDevice ? "text-center" : ""}`}>
              Lyrics from {lyrics.source}
            </p>
          )}
        </div>
        <div aria-hidden="true" style={{ height: bottomSpacer, flexShrink: 0 }} />
        </div>
        {manualScroll && (
          <button
            type="button"
            onClick={resumeAutoFollow}
            className="absolute bottom-4 right-8 z-10 px-3 py-1.5 rounded-full bg-white/15 hover:bg-white/25 backdrop-blur-md text-[12px] font-semibold text-white shadow-lg transition-colors"
          >
            Sync lyrics
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <pre
        className={`relative flex-1 min-h-0 overflow-y-auto whitespace-pre-wrap font-sans ${
          isMobileDevice ? "text-center text-white/40" : "text-ink-dim"
        } ${
          hero ? "h-full text-[17px] leading-8 py-2" : large ? "h-full text-[15px] leading-7 py-2" : "text-[13px] leading-6 py-2"
        }`}
      >
        {staticText}
      </pre>
    </div>
  );
}
