import React, { useEffect, useRef, useState } from "react";

export interface TimelineScrubberProps {
  positionMs: number;
  durationMs: number;
  isPlaying: boolean;
  onSeek: (targetSeconds: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  compact?: boolean;
  accentColor?: string;
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
}

export const TimelineScrubber: React.FC<TimelineScrubberProps> = ({
  positionMs,
  durationMs,
  isPlaying,
  onSeek,
  onInteractionStart,
  onInteractionEnd,
  compact = false,
  accentColor = "#00c2ff",
}) => {
  const trackRef = useRef<HTMLDivElement | null>(null);
  const draggingRef = useRef(false);
  const lastLiveSeekRef = useRef(0);

  const [isDragging, setIsDragging] = useState(false);
  const [dragRatio, setDragRatio] = useState<number | null>(null);
  const [livePosMs, setLivePosMs] = useState(positionMs);

  // Sync incoming IPC position snapshots
  useEffect(() => {
    setLivePosMs(positionMs);
  }, [positionMs]);

  // Smooth local clock advance between IPC updates when playing
  useEffect(() => {
    if (!isPlaying || isDragging || durationMs <= 0) return;
    let last = performance.now();
    const id = window.setInterval(() => {
      const now = performance.now();
      const delta = now - last;
      last = now;
      setLivePosMs((prev) => Math.min(durationMs, prev + delta));
    }, 200);
    return () => window.clearInterval(id);
  }, [isPlaying, isDragging, durationMs]);

  const safeDurationMs = durationMs > 0 ? durationMs : 0;
  const computedRatio =
    dragRatio !== null
      ? dragRatio
      : safeDurationMs > 0
        ? Math.min(1, Math.max(0, livePosMs / safeDurationMs))
        : 0;

  const shownSeconds =
    dragRatio !== null && safeDurationMs > 0
      ? (dragRatio * safeDurationMs) / 1000
      : livePosMs / 1000;
  const totalSeconds = safeDurationMs / 1000;

  const computeRatioFromClientX = (clientX: number): number => {
    const el = trackRef.current;
    if (!el) return 0;
    const rect = el.getBoundingClientRect();
    if (rect.width <= 0) return 0;
    return Math.min(1, Math.max(0, (clientX - rect.left) / rect.width));
  };

  const emitSeekForRatio = (ratio: number, force = false) => {
    if (safeDurationMs <= 0) return;
    const now = performance.now();
    if (!force && now - lastLiveSeekRef.current < 90) return;
    lastLiveSeekRef.current = now;
    const targetSec = (ratio * safeDurationMs) / 1000;
    setLivePosMs(targetSec * 1000);
    onSeek(targetSec);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (safeDurationMs <= 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    draggingRef.current = true;
    setIsDragging(true);
    onInteractionStart?.();

    const ratio = computeRatioFromClientX(e.clientX);
    setDragRatio(ratio);
    emitSeekForRatio(ratio, true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    const ratio = computeRatioFromClientX(e.clientX);
    setDragRatio(ratio);
    emitSeekForRatio(ratio, false);
  };

  const finishDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    e.stopPropagation();
    draggingRef.current = false;
    setIsDragging(false);

    const ratio = computeRatioFromClientX(e.clientX);
    setDragRatio(null);
    emitSeekForRatio(ratio, true);

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      /* ignore capture release errors */
    }
    onInteractionEnd?.();
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 6 : 8,
        width: "100%",
        userSelect: "none",
      }}
    >
      <span
        style={{
          fontSize: compact ? 8.5 : 9.5,
          fontVariantNumeric: "tabular-nums",
          color: "rgba(255, 255, 255, 0.55)",
          minWidth: compact ? 24 : 28,
          textAlign: "right",
          flexShrink: 0,
        }}
      >
        {formatClock(shownSeconds)}
      </span>

      <div
        ref={trackRef}
        role="slider"
        aria-label="Seek timeline"
        aria-valuemin={0}
        aria-valuemax={Math.round(totalSeconds)}
        aria-valuenow={Math.round(shownSeconds)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={finishDrag}
        onPointerCancel={finishDrag}
        style={{
          position: "relative",
          flex: 1,
          height: compact ? 14 : 16,
          display: "flex",
          alignItems: "center",
          cursor: safeDurationMs > 0 ? "pointer" : "default",
          touchAction: "none",
        }}
      >
        {/* Background rail */}
        <div
          style={{
            position: "relative",
            width: "100%",
            height: isDragging ? 4 : 3,
            borderRadius: 9999,
            backgroundColor: "rgba(255, 255, 255, 0.16)",
            overflow: "hidden",
            transition: "height 0.12s ease",
          }}
        >
          {/* GPU-composited progress bar */}
          <div
            style={{
              width: "100%",
              height: "100%",
              backgroundColor: accentColor,
              transformOrigin: "left center",
              transform: `scaleX(${computedRatio})`,
              willChange: "transform",
            }}
          />
        </div>

        {/* Thumb handle */}
        <div
          style={{
            position: "absolute",
            left: 0,
            width: isDragging ? 10 : 8,
            height: isDragging ? 10 : 8,
            borderRadius: "50%",
            backgroundColor: "#ffffff",
            boxShadow: `0 0 6px ${accentColor}`,
            pointerEvents: "none",
            transform: `translate3d(calc(${computedRatio * 100}% - ${isDragging ? 5 : 4}px), 0, 0)`,
            willChange: "transform",
          }}
        />
      </div>

      <span
        style={{
          fontSize: compact ? 8.5 : 9.5,
          fontVariantNumeric: "tabular-nums",
          color: "rgba(255, 255, 255, 0.45)",
          minWidth: compact ? 24 : 28,
          textAlign: "left",
          flexShrink: 0,
        }}
      >
        {formatClock(totalSeconds)}
      </span>
    </div>
  );
};

