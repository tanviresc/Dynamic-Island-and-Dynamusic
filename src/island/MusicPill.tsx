import React from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { standardMotion, reducedMotion } from "./motion";
import { TimelineScrubber } from "./TimelineScrubber";

export interface MusicPillProps {
  title: string;
  artist: string;
  albumArt?: string;
  isPlaying: boolean;
  positionMs?: number;
  durationMs?: number;
  isReducedMotion?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onClickBody?: () => void;
  onSeek?: (targetSeconds: number) => void;
  onInteractionStart?: () => void;
  onInteractionEnd?: () => void;
  unreadCount?: number;
  onOpenQueue?: () => void;
}

export const MusicPill: React.FC<MusicPillProps> = ({
  title,
  artist,
  albumArt,
  isPlaying,
  positionMs = 0,
  durationMs = 0,
  isReducedMotion = false,
  onHoverEnter,
  onHoverLeave,
  onClickBody,
  onSeek,
  onInteractionStart,
  onInteractionEnd,
  unreadCount = 0,
  onOpenQueue,
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;
  const pillWidth = unreadCount > 0 ? 336 : 300;

  const handleControlPointerDown = (e: React.PointerEvent) => {
    e.stopPropagation();
    onInteractionStart?.();
  };

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "prev" }).catch(() => {});
    onInteractionEnd?.();
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "toggle_play" }).catch(() => {});
    onInteractionEnd?.();
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "next" }).catch(() => {});
    onInteractionEnd?.();
  };

  const handleSeek = (targetSeconds: number) => {
    if (onSeek) {
      onSeek(targetSeconds);
    } else {
      invoke("send_music_command", { command: "seek", payload: targetSeconds }).catch(() => {});
    }
  };

  const handleBodyClick = () => {
    if (onClickBody) {
      onClickBody();
    } else {
      invoke("open_dynamusic_window").catch(() => {});
    }
  };

  const glowColor = "rgba(0, 194, 255, 0.75)";

  return (
    <motion.div
      onClick={handleBodyClick}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="island-interactive"
      initial={{
        scaleX: 0.45,
        scaleY: 0.65,
        y: -8,
        opacity: 0,
        clipPath: "inset(0% 18% 0% 18% round 24px)",
      }}
      animate={{
        scaleX: 1,
        scaleY: 1,
        y: 0,
        opacity: 1,
        clipPath: "inset(0% 0% 0% 0% round 20px)",
      }}
      exit={{
        scaleX: 0.5,
        scaleY: 0.7,
        y: -8,
        opacity: 0,
        transition: motionPreset.disappear.layout as any,
      }}
      transition={motionPreset.appear.layout as any}
      style={{
        width: pillWidth,
        borderRadius: 20,
        transformOrigin: "50% 0%",
        willChange: "transform, opacity, clip-path",
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.28)",
        boxShadow: `0 0 14px 2px rgba(255, 255, 255, 0.25), 0 0 28px 5px ${glowColor}, inset 0 1px 1px 0 rgba(255, 255, 255, 0.45)`,
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        padding: "7px 12px 6px",
        gap: 4,
        overflow: "hidden",
        position: "relative",
      }}
      title="Click album or title to open Dynamusic"
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          width: "100%",
          minWidth: 0,
        }}
      >
      {/* Left: Album Thumbnail + Title / Artist */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", overflow: "hidden", flex: 1, minWidth: 0 }}>
        {albumArt ? (
          <img
            src={albumArt}
            alt={title}
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              objectFit: "cover",
              flexShrink: 0,
              boxShadow: "0 0 6px rgba(0, 194, 255, 0.5)",
              border: "1px solid rgba(255,255,255,0.4)",
            }}
          />
        ) : (
          <div
            style={{
              width: "22px",
              height: "22px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #00c2ff 0%, #0070f3 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "11px",
              fontWeight: 800,
              color: "#fff",
              flexShrink: 0,
            }}
          >
            ♪
          </div>
        )}

        <div style={{ display: "flex", flexDirection: "column", minWidth: 0, overflow: "hidden" }}>
          <span
            style={{
              fontSize: "11px",
              fontWeight: 700,
              color: "#ffffff",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              letterSpacing: "-0.2px",
            }}
          >
            {title}
          </span>
          <span
            style={{
              fontSize: "9.5px",
              color: "rgba(255, 255, 255, 0.65)",
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}
          >
            {artist}
          </span>
        </div>
      </div>

      {/* Center: Live Waveform Visualizer */}
      <div
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: "2.5px",
          height: "12px",
          margin: "0 8px",
          flexShrink: 0,
        }}
      >
        {[0.6, 1.0, 0.4, 0.8].map((h, i) => (
          <motion.div
            key={i}
            animate={{
              scaleY: isPlaying ? [0.25, h, 0.35, h * 0.85, 0.25] : 0.25,
            }}
            transition={{
              repeat: Infinity,
              duration: 1.2 + i * 0.2,
              ease: "easeInOut",
            }}
            style={{
              width: "2px",
              height: "12px",
              transformOrigin: "bottom center",
              backgroundColor: isPlaying ? "#00c2ff" : "rgba(255, 255, 255, 0.3)",
              borderRadius: "1px",
              willChange: "transform",
            }}
          />
        ))}
      </div>

      {/* Right: Media Controls */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          flexShrink: 0,
        }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          onPointerDown={handleControlPointerDown}
          onClick={handlePrev}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.85)",
            cursor: "pointer",
            fontSize: "12px",
            padding: "5px 6px",
            display: "flex",
            alignItems: "center",
          }}
          title="Previous"
        >
          ⏮
        </button>

        <button
          type="button"
          onPointerDown={handleControlPointerDown}
          onClick={handleTogglePlay}
          style={{
            width: "26px",
            height: "26px",
            borderRadius: "50%",
            background: "#ffffff",
            color: "#000000",
            border: "none",
            cursor: "pointer",
            fontSize: "11px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: "0 0 8px rgba(255,255,255,0.4)",
          }}
          title={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? "⏸" : "▶"}
        </button>

        <button
          type="button"
          onPointerDown={handleControlPointerDown}
          onClick={handleNext}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.85)",
            cursor: "pointer",
            fontSize: "12px",
            padding: "5px 6px",
            display: "flex",
            alignItems: "center",
          }}
          title="Next"
        >
          ⏭
        </button>

        {/* Optional Notification Badge if unread items exist */}
        {unreadCount > 0 && (
          <button
            type="button"
            onPointerDown={handleControlPointerDown}
            onClick={(e) => {
              e.stopPropagation();
              onOpenQueue?.();
            }}
            style={{
              marginLeft: "4px",
              padding: "2px 6px",
              borderRadius: "10px",
              backgroundColor: "rgba(255, 69, 58, 0.3)",
              border: "1px solid #ff453a",
              color: "#ff453a",
              fontSize: "9px",
              fontWeight: 800,
              cursor: "pointer",
            }}
            title={`${unreadCount} notifications waiting`}
          >
            {unreadCount}
          </button>
        )}
      </div>
      </div>

      {/* Bottom Row: Interactive Draggable Timeline Scrubber */}
      <TimelineScrubber
        compact
        positionMs={positionMs}
        durationMs={durationMs}
        isPlaying={isPlaying}
        onSeek={handleSeek}
        onInteractionStart={onInteractionStart}
        onInteractionEnd={onInteractionEnd}
      />
    </motion.div>
  );
};
