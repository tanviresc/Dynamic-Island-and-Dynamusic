import { useRef, useState, useSyncExternalStore, type CSSProperties } from "react";
import { Volume1, Volume2 } from "lucide-react";
import { fmtTime } from "../lib/format";
import { getPlaybackClock, setPlaybackClock, subscribePlaybackClock } from "../lib/playbackClock";
import { usePlayer } from "../stores/player";

/**
 * Releasing the pointer must not leave focus parked on a range/slider control: the
 * global shortcut handler treats a focused INPUT/slider as typing, so Space
 * (play/pause) goes dead until the user clicks somewhere else. Blur on
 * release instead — keyboard users are untouched, since Tab focus and
 * arrow-key adjustments never fire pointer events.
 */
function releasePointerFocus(e: React.PointerEvent<HTMLElement>): void {
  e.currentTarget.blur();
}

interface SeekBarProps {
  large?: boolean;
  showRemaining?: boolean;
  /** slimmer hairline track — the player-bar variant */
  thin?: boolean;
}

const DRAG_LIVE_SEEK_MS = 120;
const POST_SEEK_SNAP_LOCK_MS = 650;

export function SeekBar({ large = false, showRemaining = false, thin = false }: SeekBarProps) {
  const clock = useSyncExternalStore(subscribePlaybackClock, getPlaybackClock);
  const storeDuration = usePlayer((s) => s.duration);
  const storeBuffered = usePlayer((s) => s.buffered);
  const seek = usePlayer((s) => s.seek);
  const position = clock.position;
  const duration = clock.duration > 0 ? clock.duration : storeDuration;
  const buffered = clock.buffered > 0 ? clock.buffered : storeBuffered;
  const [dragValue, setDragValue] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);

  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastLiveSeekRef = useRef(0);
  const dragValueRef = useRef<number | null>(null);
  const pendingLockRef = useRef<{ target: number; until: number } | null>(null);

  const known = duration > 0;
  const max = known ? duration : 1;

  if (pendingLockRef.current) {
    const lock = pendingLockRef.current;
    if (Date.now() >= lock.until || (known && Math.abs(position - lock.target) < 1.1)) {
      pendingLockRef.current = null;
    }
  }

  const lockedTarget =
    pendingLockRef.current && Date.now() < pendingLockRef.current.until && known
      ? pendingLockRef.current.target
      : null;

  const shown = dragValue ?? lockedTarget ?? (known ? Math.min(position, max) : position);
  const pct = known ? Math.max(0, Math.min(100, (shown / max) * 100)) : 0;
  const bufPct = Math.max(0, Math.min(100, Math.max(buffered * 100, pct)));

  const positionFromClientX = (clientX: number): number => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect || rect.width <= 0) return shown;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    return ratio * max;
  };

  const commitSeek = (target: number) => {
    const clamped = Math.max(0, Math.min(target, max));
    pendingLockRef.current = { target: clamped, until: Date.now() + POST_SEEK_SNAP_LOCK_MS };
    setPlaybackClock(clamped, duration);
    seek(clamped);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (!known) return;
    e.stopPropagation();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* ignore */
    }
    draggingRef.current = true;
    setDragging(true);
    const next = positionFromClientX(e.clientX);
    dragValueRef.current = next;
    setDragValue(next);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || !known) return;
    e.stopPropagation();
    const next = positionFromClientX(e.clientX);
    dragValueRef.current = next;
    setDragValue(next);
    const now = performance.now();
    if (now - lastLiveSeekRef.current >= DRAG_LIVE_SEEK_MS) {
      lastLiveSeekRef.current = now;
      seek(Math.max(0, Math.min(next, max)));
    }
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>, cancelled: boolean) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setDragging(false);
    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore */
    }
    const target = cancelled
      ? (dragValueRef.current ?? shown)
      : positionFromClientX(e.clientX);
    dragValueRef.current = null;
    setDragValue(null);
    if (known) commitSeek(target);
    releasePointerFocus(e);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!known) return;
    const step = Math.max(5, Math.min(15, max * 0.03));
    let next: number | null = null;
    if (e.key === "ArrowRight" || e.key === "ArrowUp") next = shown + step;
    else if (e.key === "ArrowLeft" || e.key === "ArrowDown") next = shown - step;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = max;
    if (next !== null) {
      e.preventDefault();
      commitSeek(next);
    }
  };

  return (
    <div className={`flex items-center ${large ? "gap-3 w-full" : "gap-2 w-full"}`}>
      <span
        className={`shrink-0 text-right tabular-nums ${large ? "text-ink-faint w-12 text-[13px]" : "w-[50px] text-[12px] leading-[17px] text-[#b3b3b3]"}`}
      >
        {fmtTime(shown)}
      </span>
      <div
        ref={trackRef}
        role="slider"
        tabIndex={0}
        aria-label="Seek"
        aria-valuemin={0}
        aria-valuemax={Math.round(max)}
        aria-valuenow={Math.round(shown)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={(e) => finishDrag(e, false)}
        onPointerCancel={(e) => finishDrag(e, true)}
        onKeyDown={handleKeyDown}
        style={{ touchAction: "none" }}
        className={`group relative flex-1 flex items-center cursor-pointer select-none outline-none focus-visible:ring-1 focus-visible:ring-white/40 rounded-full ${
          large ? "h-8" : "h-5"
        }`}
      >
        <div
          className={`relative w-full rounded-full overflow-hidden bg-white/15 transition-[height] duration-150 ${
            thin
              ? dragging
                ? "h-[5px]"
                : "h-[3px] group-hover:h-[5px]"
              : large
                ? dragging
                  ? "h-2"
                  : "h-1.5"
                : dragging
                  ? "h-1.5"
                  : "h-1 group-hover:h-1.5"
          }`}
        >
          <div
            className="absolute inset-y-0 left-0 bg-white/25 rounded-full pointer-events-none"
            style={{ width: `${bufPct}%` }}
          />
          <div
            className={`absolute inset-y-0 left-0 rounded-full pointer-events-none ${
              dragging ? "bg-white" : "bg-white group-hover:bg-accent"
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
        <div
          className={`absolute top-1/2 -translate-y-1/2 -translate-x-1/2 rounded-full bg-white shadow-[0_1px_4px_rgba(0,0,0,0.5)] pointer-events-none transition-[opacity,transform] duration-100 ${
            large
              ? dragging
                ? "w-4 h-4 opacity-100 scale-110"
                : "w-3.5 h-3.5 opacity-100"
              : dragging
                ? "w-3.5 h-3.5 opacity-100 scale-110"
                : "w-3 h-3 opacity-0 group-hover:opacity-100"
          }`}
          style={{ left: `${pct}%` }}
        />
      </div>
      <span className={`shrink-0 tabular-nums ${large ? "text-ink-faint w-12 text-[13px]" : "w-[50px] text-[12px] leading-[17px] text-[#b3b3b3]"}`}>
        {showRemaining ? `-${fmtTime(Math.max(0, duration - shown))}` : fmtTime(duration)}
      </span>
    </div>
  );
}

export function VolumeControl({ VolIcon }: { VolIcon: (p: { className?: string }) => React.ReactElement }) {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const pct = (muted ? 0 : volume) * 100;

  return (
    <div className="flex items-center">
      <button
        onClick={toggleMute}
        className="grid h-8 w-8 place-items-center text-[#b3b3b3] transition-colors hover:text-white"
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        <span key={muted ? "muted" : "on"} className="icon-swap">
          <VolIcon className="w-4 h-4" />
        </span>
      </button>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        onPointerUp={releasePointerFocus}
        className="slider slider-bar w-[93px]"
        style={{ "--fill": `${pct}%` } as CSSProperties}
      />
    </div>
  );
}

/**
 * Full-width volume row — the mobile player's volume treatment:
 * quiet speaker at the left end, loud speaker at the right, one long slider
 * between them. Used on the full-screen NowPlaying overlay.
 */
export function VolumeRow() {
  const volume = usePlayer((s) => s.volume);
  const muted = usePlayer((s) => s.muted);
  const setVolume = usePlayer((s) => s.setVolume);
  const toggleMute = usePlayer((s) => s.toggleMute);
  const pct = (muted ? 0 : volume) * 100;

  return (
    <div className="w-full flex items-center gap-3">
      <button
        onClick={toggleMute}
        className="text-ink-hi/60 hover:text-ink-hi transition-all active:scale-90 shrink-0"
        title={muted ? "Unmute" : "Mute"}
        aria-label={muted ? "Unmute" : "Mute"}
      >
        <Volume1 className="w-5 h-5" />
      </button>
      <input
        type="range"
        aria-label="Volume"
        min={0}
        max={1}
        step={0.01}
        value={muted ? 0 : volume}
        onChange={(e) => setVolume(Number(e.target.value))}
        onPointerUp={releasePointerFocus}
        className="slider flex-1"
        style={{ "--fill": `${pct}%` } as CSSProperties}
      />
      <button
        onClick={toggleMute}
        className="text-ink-hi/60 hover:text-ink-hi transition-all active:scale-90 shrink-0"
        title="Volume up"
        aria-label="Volume up"
      >
        <Volume2 className="w-5 h-5" />
      </button>
    </div>
  );
}
