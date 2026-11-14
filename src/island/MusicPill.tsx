import React from "react";
import { motion } from "motion/react";
import { invoke } from "@tauri-apps/api/core";
import { standardMotion, reducedMotion } from "./motion";

export interface MusicPillProps {
  title: string;
  artist: string;
  albumArt?: string;
  isPlaying: boolean;
  isReducedMotion?: boolean;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  onClickBody?: () => void;
  unreadCount?: number;
  onOpenQueue?: () => void;
}

export const MusicPill: React.FC<MusicPillProps> = ({
  title,
  artist,
  albumArt,
  isPlaying,
  isReducedMotion = false,
  onHoverEnter,
  onHoverLeave,
  onClickBody,
  unreadCount = 0,
  onOpenQueue,
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;

  const handlePrev = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "prev" }).catch(() => {});
  };

  const handleTogglePlay = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "toggle_play" }).catch(() => {});
  };

  const handleNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    invoke("send_music_command", { command: "next" }).catch(() => {});
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
      layoutId="island-surface"
      initial={{
        width: 1,
        height: 1,
        borderRadius: 0.5,
        opacity: 0,
      }}
      animate={{
        width: unreadCount > 0 ? 320 : 270,
        height: 36,
        borderRadius: 18,
        opacity: 1,
      }}
      exit={{
        width: 1,
        height: 1,
        borderRadius: 0.5,
        opacity: 0,
        transition: motionPreset.disappear.layout,
      }}
      transition={motionPreset.appear.layout}
      style={{
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.25)",
        boxShadow: `0 0 12px 2px rgba(255, 255, 255, 0.25), 0 0 24px 4px ${glowColor}, 0 0 50px 10px ${glowColor}66, inset 0 1px 1px 0 rgba(255, 255, 255, 0.50)`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 12px",
        overflow: "hidden",
        position: "relative",
      }}
      title="Click anywhere to open Dynamusic"
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
              height: isPlaying ? [3, Math.round(h * 12), 4, Math.round(h * 10), 3] : 3,
            }}
            transition={{
              repeat: Infinity,
              duration: 1.2 + i * 0.2,
              ease: "easeInOut",
            }}
            style={{
              width: "2px",
              backgroundColor: isPlaying ? "#00c2ff" : "rgba(255, 255, 255, 0.3)",
              borderRadius: "1px",
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
      >
        <button
          onClick={handlePrev}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.8)",
            cursor: "pointer",
            fontSize: "11px",
            padding: "2px",
            display: "flex",
            alignItems: "center",
          }}
          title="Previous"
        >
          ⏮
        </button>

        <button
          onClick={handleTogglePlay}
          style={{
            width: "20px",
            height: "20px",
            borderRadius: "50%",
            background: "#ffffff",
            color: "#000000",
            border: "none",
            cursor: "pointer",
            fontSize: "10px",
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
          onClick={handleNext}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.8)",
            cursor: "pointer",
            fontSize: "11px",
            padding: "2px",
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
    </motion.div>
  );
};
