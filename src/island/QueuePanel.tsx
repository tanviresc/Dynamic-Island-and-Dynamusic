import React, { useEffect } from "react";
import { motion, AnimatePresence } from "motion/react";
import { SourceIcon, SourceType } from "../shared/icons/SourceIcon";
import { standardMotion, reducedMotion } from "./motion";

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
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;

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
      className={`island-interactive ${isReducedMotion ? "island-reduced-motion" : ""}`}
      initial={{
        width: 24,
        maxHeight: 24,
        borderRadius: 12,
        opacity: 0,
      }}
      animate={{
        width: 320,
        maxHeight: 360,
        borderRadius: 18,
        opacity: 1,
      }}
      exit={{
        width: 24,
        maxHeight: 24,
        borderRadius: 12,
        opacity: 0,
        transition: motionPreset.queueClose.layout as any,
      }}
      transition={motionPreset.queueOpen.layout as any}
      style={{
        willChange: "width, max-height, opacity, border-radius",
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.45)",
        boxShadow: "0 0 22px 2px rgba(255, 255, 255, 0.22), inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
        pointerEvents: "auto",
      }}
    >
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
          className="island-queue-clear"
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
                className="island-queue-row"
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
