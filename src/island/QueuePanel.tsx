import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SourceIcon, SourceType } from "../shared/icons/SourceIcon";
import { standardMotion, reducedMotion } from "./motion";
import { IPCMusicState } from "../dynamusic/types";

export interface QueueItem {
  id: string;
  source: SourceType;
  kind: "done" | "needs_input" | "error" | "new_mail";
  title: string;
  text: string;
  category?: string;
  createdAt: string;
}

export interface QueuePanelProps {
  items: QueueItem[];
  onItemClick: (id: string) => void;
  onClear: () => void;
  onClose: () => void;
  isReducedMotion?: boolean;
  musicState?: IPCMusicState | null;
  onOpenDynamusic?: () => void;
  onMusicControl?: (action: "play_pause" | "next" | "previous") => void;
}

export function formatRelativeTime(dateStr: string): string {
  if (!dateStr) return "";
  const parsed = new Date(dateStr).getTime();
  if (isNaN(parsed)) {
    // If it's already a relative time string from backend (e.g. "just now", "1m", "now")
    return dateStr;
  }
  try {
    const diffMs = Math.max(0, Date.now() - parsed);
    const diffSec = Math.floor(diffMs / 1000);
    if (diffSec < 60) return "now";
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h`;
    const diffDay = Math.floor(diffHr / 24);
    if (diffDay < 7) return `${diffDay}d`;
    return new Date(dateStr).toLocaleDateString(undefined, { weekday: "short" });
  } catch {
    return dateStr;
  }
}

export const QueuePanel: React.FC<QueuePanelProps> = ({
  items,
  onItemClick,
  onClear,
  onClose,
  isReducedMotion = false,
  musicState,
  onOpenDynamusic,
  onMusicControl,
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;
  const hasSong = Boolean(
    musicState && (musicState.isPlaying || (musicState.title && musicState.title !== "Dynamusic"))
  );

  // Handle Escape key to close
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <motion.div
      className="island-interactive"
      layoutId="island-surface"
      initial={{ width: 5, height: 5, borderRadius: 2.5, opacity: 0 }}
      animate={{
        width: 320,
        height: "auto",
        maxHeight: 340,
        borderRadius: 18,
        opacity: 1,
      }}
      exit={{
        width: 5,
        height: 5,
        borderRadius: 2.5,
        opacity: 0,
        transition: motionPreset.queueClose.layout,
      }}
      transition={motionPreset.queueOpen.layout}
      style={{
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.45)",
        boxShadow: "0 0 20px 2px rgba(255, 255, 255, 0.22), 0 0 50px 10px rgba(255, 255, 255, 0.10), inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Song Preview (shown when a song is playing/loaded) */}
      {hasSong && musicState && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            padding: "8px 12px",
            borderBottom: "1px solid rgba(255, 255, 255, 0.1)",
            backgroundColor: "rgba(255, 255, 255, 0.04)",
          }}
        >
          <div
            onClick={onOpenDynamusic}
            style={{
              width: 32,
              height: 32,
              borderRadius: 6,
              overflow: "hidden",
              flexShrink: 0,
              backgroundColor: "rgba(255, 255, 255, 0.1)",
              cursor: onOpenDynamusic ? "pointer" : "default",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="Open Dynamusic"
          >
            {musicState.albumArt ? (
              <img
                src={musicState.albumArt}
                alt={musicState.title}
                style={{ width: "100%", height: "100%", objectFit: "cover" }}
              />
            ) : (
              <span style={{ fontSize: 13, color: "rgba(255,255,255,0.7)" }}>♪</span>
            )}
          </div>

          <div
            onClick={onOpenDynamusic}
            style={{
              flex: 1,
              minWidth: 0,
              cursor: onOpenDynamusic ? "pointer" : "default",
            }}
          >
            <div
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#ffffff",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {musicState.title}
            </div>
            <div
              style={{
                fontSize: 10,
                color: "rgba(255, 255, 255, 0.6)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {musicState.artist || "Dynamusic"}
            </div>
          </div>

          {onMusicControl && (
            <div style={{ display: "flex", alignItems: "center", gap: 4, flexShrink: 0 }}>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMusicControl("previous");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255, 255, 255, 0.75)",
                  cursor: "pointer",
                  padding: "4px",
                  fontSize: 11,
                  lineHeight: 1,
                }}
                aria-label="Previous track"
                title="Previous"
              >
                ⏮
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMusicControl("play_pause");
                }}
                style={{
                  background: "rgba(255, 255, 255, 0.14)",
                  border: "none",
                  borderRadius: "50%",
                  width: 24,
                  height: 24,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  color: "#ffffff",
                  cursor: "pointer",
                  fontSize: 10,
                  lineHeight: 1,
                }}
                aria-label={musicState.isPlaying ? "Pause" : "Play"}
                title={musicState.isPlaying ? "Pause" : "Play"}
              >
                {musicState.isPlaying ? "⏸" : "▶"}
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onMusicControl("next");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "rgba(255, 255, 255, 0.75)",
                  cursor: "pointer",
                  padding: "4px",
                  fontSize: 11,
                  lineHeight: 1,
                }}
                aria-label="Next track"
                title="Next"
              >
                ⏭
              </button>
            </div>
          )}
        </div>
      )}

      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "8px 14px 6px 14px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <span style={{ fontSize: 11, fontWeight: 600, color: "rgba(255, 255, 255, 0.85)", letterSpacing: "0.2px" }}>
          Notifications ({items.length})
        </span>
        <button
          onClick={onClear}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255, 255, 255, 0.50)",
            fontSize: 10,
            fontWeight: 600,
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#ffffff")}
          onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "rgba(255, 255, 255, 0.50)")}
        >
          Clear
        </button>
      </div>

      {/* Items List */}
      <div
        style={{
          overflowY: "auto",
          maxHeight: 240,
          display: "flex",
          flexDirection: "column",
        }}
      >
        <AnimatePresence initial={false}>
          {items.map((item, index) => {
            const needsInput = item.kind === "needs_input" || item.kind === "error";
            const tag =
              item.category ||
              (needsInput && item.kind === "needs_input" ? "Needs input" : item.kind === "error" ? "Failed" : undefined);

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: isReducedMotion ? 0 : 4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{
                  opacity: 0,
                  height: 0,
                  transition: { duration: 0.16, ease: "easeInOut" },
                }}
                transition={{
                  duration: motionPreset.queueOpen.rowDuration,
                  delay: isReducedMotion ? 0 : motionPreset.queueOpen.rowDelay + index * motionPreset.queueOpen.stagger,
                }}
                onClick={() => onItemClick(item.id)}
                style={{
                  height: 40,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 12px",
                  gap: 8,
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.08)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
              >
                <SourceIcon source={item.source} needsInput={needsInput} size={18} />

                <div style={{ flex: 1, minWidth: 0, display: "flex", alignItems: "center", gap: 5, overflow: "hidden" }}>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 600,
                      color: "#ffffff",
                      whiteSpace: "nowrap",
                      flexShrink: 0,
                    }}
                  >
                    {item.title}
                  </span>
                  {tag && (
                    <span
                      style={{
                        fontSize: 9,
                        fontWeight: 600,
                        padding: "1px 4px",
                        borderRadius: 3,
                        backgroundColor: "rgba(255, 255, 255, 0.12)",
                        color: "rgba(255, 255, 255, 0.85)",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                    >
                      {tag}
                    </span>
                  )}
                  {item.text && (
                    <>
                      <span style={{ color: "rgba(255, 255, 255, 0.35)", fontSize: 11, flexShrink: 0 }}>:</span>
                      <span
                        style={{
                          fontSize: 11,
                          fontWeight: 400,
                          color: "rgba(255, 255, 255, 0.75)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          flex: 1,
                        }}
                      >
                        {item.text}
                      </span>
                    </>
                  )}
                </div>

                <span
                  style={{
                    fontSize: 10,
                    color: "rgba(255, 255, 255, 0.45)",
                    flexShrink: 0,
                    fontWeight: 500,
                    marginLeft: 4,
                  }}
                >
                  {formatRelativeTime(item.createdAt)}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </motion.div>
  );
};
