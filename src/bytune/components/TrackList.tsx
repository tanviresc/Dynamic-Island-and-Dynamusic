import { Fragment, useEffect, useRef, useState } from "react";
import { AlertCircle, Check, Heart, ListPlus, Loader2, MoreHorizontal, Pause, Play } from "lucide-react";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useMobileMode } from "../stores/mobileMode";
import { tintHoverHandlers, useUI, type MenuItem } from "../stores/ui";
import { trackMenuItems } from "../lib/trackActions";
import { useDrag } from "../lib/dnd";
import { useSwipeGesture } from "../lib/useSwipeGesture";
import { fmtTime, shortTitle } from "../lib/format";
import { Artwork, EqBars, EmptyState, ExplicitBadge } from "./primitives";
import { PlayingLight, useRowLight } from "./RowLight";
import { FitText } from "./FitText";
import type { Track } from "../types";

/** Download state glyph for a track row — spinner / green check / red fail. */
export function DownloadBadge({ id }: { id: string }) {
  const dl = useLibrary((s) => s.downloads[id]);
  if (!dl) return null;
  if (dl.status === "downloading") {
    return (
      <span className="p-1.5 rounded-md text-ink-hi" title="Downloading…">
        <Loader2 className="w-4 h-4 animate-spin" />
      </span>
    );
  }
  if (dl.status === "done") {
    return (
      <span className="p-1.5 rounded-md text-emerald-400" title="Downloaded">
        <Check className="w-4 h-4" />
      </span>
    );
  }
  return (
    <span className="p-1.5 rounded-md text-red-400" title="Download failed">
      <AlertCircle className="w-4 h-4" />
    </span>
  );
}

interface TrackRowProps {
  track: Track;
  index: number;
  isCurrent: boolean;
  isPlaying: boolean;
  onPlay: (index: number) => void;
  menuFor: (track: Track) => MenuItem[];
  showAlbum: boolean;
  /** the pointer came onto this row: the list's light moves to it */
  onHover: (row: HTMLElement, thumb: string) => void;
}

function TrackRow({ track, index, isCurrent, isPlaying, onPlay, menuFor, showAlbum, onHover }: TrackRowProps) {
  const liked = useLibrary((s) => s.liked.some((t) => t.id === track.id));
  const toggleLike = useLibrary((s) => s.toggleLike);
  const openContextMenu = useUI((s) => s.openContextMenu);
  const navigate = useUI((s) => s.navigate);
  const drag = useDrag({ track });
  const tint = tintHoverHandlers(track.thumb);

  const swipe = useSwipeGesture({
    onSwipeRight: isCurrent ? () => usePlayer.getState().next(true) : undefined,
    onSwipeLeft: isCurrent
      ? () => usePlayer.getState().prev()
      : () => {
          const added = usePlayer.getState().addToQueue(track);
          const name = shortTitle(track.title);
          useUI.getState().toast(added ? `Added "${name}" to queue` : `"${name}" is already in your queue`);
        },
  });

  const openMenu = (x: number, y: number): void => {
    openContextMenu(x, y, menuFor(track));
  };

  return (
    <div
      {...drag.props}
      {...swipe.handlers}
      onMouseEnter={(e) => {
        tint.onMouseEnter();
        onHover(e.currentTarget, track.thumb);
      }}
      onMouseLeave={tint.onMouseLeave}
      onClick={() => {
        if (swipe.consumeDidSwipe()) return;
        onPlay(index);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        e.stopPropagation();
        openMenu(e.clientX, e.clientY);
      }}
      style={{
        touchAction: "pan-y",
        transform: swipe.offsetX ? `translate3d(${swipe.offsetX}px, 0, 0)` : undefined,
        transition: swipe.dragging ? "none" : "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      className={`tl-row fit-host group relative flex items-center gap-2.5 md:gap-3.5 h-[60px] w-full max-w-full overflow-hidden px-2 md:px-3 rounded-lg cursor-pointer select-none ${
        isCurrent ? "bg-ink-hi/[0.06]" : "hover:bg-ink-hi/[0.04]"
      } ${drag.dragging ? "opacity-40" : ""}`}
    >
      {!isCurrent && swipe.offsetX < -14 && (
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 z-20 inline-flex items-center gap-1 rounded-full bg-emerald-500/20 border border-emerald-400/40 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
          <ListPlus className="w-3 h-3" />
          Queue
        </span>
      )}
      {/* The playing song keeps a soft light of its own cover. */}
      {isCurrent && <PlayingLight thumb={track.thumb} />}
      {/* index / hover play / eq */}
      <div className="hidden md:grid w-7 shrink-0 place-items-center text-[13px] text-ink-faint tabular-nums">
        {isCurrent && isPlaying ? (
          <EqBars />
        ) : (
          <>
            <span className={`group-hover:hidden ${isCurrent ? "text-ink-hi font-medium" : ""}`}>{index + 1}</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                if (isCurrent) {
                  // clicking play on the current row toggles playback
                  usePlayer.getState().toggle();
                } else {
                  onPlay(index);
                }
              }}
              className="hidden group-hover:block text-ink-hi hover:text-ink-hi transition-colors"
              title={isCurrent && isPlaying ? "Pause" : "Play"}
              aria-label={isCurrent && isPlaying ? "Pause" : `Play ${track.title}`}
            >
              {isCurrent && isPlaying ? <Pause className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
            </button>
          </>
        )}
      </div>

      <Artwork
        src={track.thumb}
        className="w-11 h-11 md:w-[52px] md:h-[52px] rounded-lg shrink-0"
        iconClassName="w-4 h-4"
        alt=""
      />

      {/* min-w floor: with showAlbum the fixed columns (index · artwork · album ·
          controls · time) can exceed a narrow list and, because the title's flex
          basis is 0, it would collapse to zero width before anything else gives.
          The floor keeps the title visible; the album column shrinks instead. */}
      <div className="flex-1 min-w-0 overflow-hidden">
        <div className="flex items-center gap-1.5 min-w-0 text-[15px] md:text-[16px] font-semibold tracking-[-0.2px] text-ink-hi">
          {track.explicit && <ExplicitBadge />}
          <span className="truncate md:hidden">{shortTitle(track.title)}</span>
          <span className="hidden md:block min-w-0 flex-1">
            <FitText text={shortTitle(track.title)} full={track.title} />
          </span>
        </div>
        <div className="md:hidden truncate text-[13px] text-ink-dim mt-0.5">{track.artist}</div>
        <div className="hidden md:block">
          <FitText text={track.artist} className="text-[14px] text-ink-dim mt-0.5" />
        </div>
      </div>

      {showAlbum && (
        <div className="tl-album w-52 min-w-0 text-xs text-ink-faint">
          {track.albumId ? (
            <button
              className="block max-w-full hover:text-ink hover:underline text-left transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "album", param: track.albumId });
              }}
            >
              <FitText text={track.album ? shortTitle(track.album) : "Single"} full={track.album} />
            </button>
          ) : (
            <FitText text={track.album ? shortTitle(track.album) : ""} full={track.album} />
          )}
        </div>
      )}

      <div className="w-auto md:w-[88px] shrink-0 flex items-center justify-end gap-0.5 opacity-100 md:opacity-0 md:group-hover:opacity-100 focus-within:opacity-100 transition-opacity">
        <button
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
          }}
          title={liked ? "Remove from Liked" : "Add to Liked"}
          aria-label={liked ? "Remove from Liked" : "Add to Liked"}
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <Heart key={liked ? "liked" : "unliked"} className={`w-4 h-4 animate-icon-pop ${liked ? "fill-ink-hi text-ink-hi" : ""}`} />
        </button>
        <span className="opacity-80">
          <DownloadBadge id={track.id} />
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation();
            openMenu(e.clientX, e.clientY);
          }}
          title="More options"
          aria-label="More options"
          className="p-1.5 rounded-md text-ink-faint hover:text-ink-hi hover:bg-ink-hi/[0.07] transition-colors"
        >
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="w-9 md:w-11 shrink-0 text-right text-[11px] md:text-xs text-ink-faint tabular-nums">
        {track.duration > 0 ? fmtTime(track.duration) : "—"}
      </div>
    </div>
  );
}

interface TrackListProps {
  tracks: Track[];
  onPlay?: (index: number) => void;
  /** The sidebar row these songs play from (the player's playingFrom). */
  from?: string;
  showAlbum?: boolean;
  showHeader?: boolean;
  menuFor?: (track: Track) => MenuItem[];
  emptyLabel?: string;
  emptyTitle?: string;
}

const VIRTUALIZE_THRESHOLD = 60;
const DEFAULT_ROW_HEIGHT = 69;
const OVERSCAN = 10;

export function TrackList({
  tracks,
  onPlay,
  from,
  showAlbum = true,
  showHeader = true,
  menuFor = trackMenuItems,
  emptyLabel,
  emptyTitle = "Nothing here yet",
}: TrackListProps) {
  const mobileMode = useMobileMode((s) => s.mode);
  const pcState = useMobileMode((s) => s.pcState);
  const isPcRemote = mobileMode === "pc_remote" && Boolean(pcState?.track);
  const localCurrentId = usePlayer((s) => s.queue[s.index]?.id ?? null);
  const localPlaying = usePlayer((s) => s.playing);
  const currentId = isPcRemote ? (pcState?.track?.id ?? null) : localCurrentId;
  const playing = isPcRemote ? Boolean(pcState?.playing) : localPlaying;
  const playQueue = usePlayer((s) => s.playQueue);
  const play = onPlay ?? ((i: number) => playQueue(tracks, i, from));
  const rowLight = useRowLight();
  const listRef = useRef<HTMLDivElement | null>(null);
  const [rowHeight, setRowHeight] = useState(DEFAULT_ROW_HEIGHT);
  const [windowRange, setWindowRange] = useState<{ start: number; end: number }>({
    start: 0,
    end: VIRTUALIZE_THRESHOLD,
  });

  const shouldVirtualize = tracks.length > VIRTUALIZE_THRESHOLD;

  useEffect(() => {
    if (!shouldVirtualize) return;
    const scroller =
      (listRef.current?.closest("#view-scroll") as HTMLElement | null) ??
      (typeof document !== "undefined" ? document.getElementById("view-scroll") : null);
    if (!scroller) {
      setWindowRange({ start: 0, end: tracks.length });
      return;
    }

    let raf = 0;
    const measureAndSlice = () => {
      raf = 0;
      const listEl = listRef.current;
      if (!listEl) return;
      const firstRow = listEl.querySelector<HTMLElement>("[role='row']");
      const h = firstRow ? Math.round(firstRow.getBoundingClientRect().height + 1) : rowHeight;
      const step = h > 40 ? h : rowHeight;
      if (step !== rowHeight && firstRow) setRowHeight(step);

      const listTopInScroll =
        scroller.scrollTop + listEl.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
      const viewTop = Math.max(0, scroller.scrollTop - listTopInScroll);
      const viewBottom = Math.max(0, scroller.scrollTop + scroller.clientHeight - listTopInScroll);

      const start = Math.max(0, Math.floor(viewTop / step) - OVERSCAN);
      const end = Math.min(tracks.length, Math.ceil(viewBottom / step) + OVERSCAN);
      setWindowRange((prev) =>
        prev.start === start && prev.end === end ? prev : { start, end }
      );
    };

    const onScroll = () => {
      if (!raf) raf = window.requestAnimationFrame(measureAndSlice);
    };

    measureAndSlice();
    scroller.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll, { passive: true });
    return () => {
      if (raf) window.cancelAnimationFrame(raf);
      scroller.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [shouldVirtualize, tracks.length, rowHeight]);

  if (!tracks.length) {
    return <EmptyState icon={Play} title={emptyTitle} body={emptyLabel ?? "Tracks will appear here."} />;
  }

  const startIdx = shouldVirtualize ? Math.min(windowRange.start, tracks.length) : 0;
  const endIdx = shouldVirtualize ? Math.min(windowRange.end, tracks.length) : tracks.length;
  const topPad = shouldVirtualize ? startIdx * rowHeight : 0;
  const bottomPad = shouldVirtualize ? Math.max(0, (tracks.length - endIdx) * rowHeight) : 0;
  const visibleTracks = shouldVirtualize ? tracks.slice(startIdx, endIdx) : tracks;

  return (
    <div className="tl w-full max-w-full overflow-x-hidden">
      {showHeader && (
        <div className="hidden md:flex items-center gap-3 px-3 pb-2.5 mb-1 border-b border-ink-hi/[0.06] text-[10.5px] font-semibold uppercase tracking-[0.14em] text-ink-ghost">
          <div className="w-7 shrink-0">#</div>
          <div className="w-[52px] shrink-0" />
          <div className="flex-1 min-w-0">Title</div>
          {showAlbum && <div className="tl-album w-52 shrink-0">Album</div>}
          <div className="w-[88px] shrink-0" />
          <div className="w-11 shrink-0 text-right">Time</div>
        </div>
      )}
      <div ref={listRef} className="relative" onMouseLeave={rowLight.leave}>
        {rowLight.light}
        {topPad > 0 && <div style={{ height: topPad }} aria-hidden="true" />}
        {visibleTracks.map((track, offset) => {
          const i = startIdx + offset;
          return (
            <Fragment key={`${track.id}-${i}`}>
              <TrackRow
                track={track}
                index={i}
                isCurrent={track.id === currentId}
                isPlaying={playing}
                onPlay={play}
                menuFor={menuFor}
                showAlbum={showAlbum}
                onHover={rowLight.hover}
              />
              {/* Hairline divider, inset to the title column — mobile's
                  ROW_DIVIDER_INSET clears the 52dp artwork the same way. */}
              {i < tracks.length - 1 && <div className="h-px bg-ink-hi/[0.05] ml-[64px] md:ml-[120px] mr-3" />}
            </Fragment>
          );
        })}
        {bottomPad > 0 && <div style={{ height: bottomPad }} aria-hidden="true" />}
      </div>
    </div>
  );
}
