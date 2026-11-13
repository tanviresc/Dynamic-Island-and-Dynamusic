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
      className="island-interactive"
      layoutId="island-surface"
      initial={{ width: 7, height: 7, borderRadius: 3.5, opacity: 0 }}
      animate={{
        width: 400,
        height: "auto",
        maxHeight: 440,
        borderRadius: 22,
        opacity: 1,
      }}
      exit={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
        opacity: 0,
        transition: motionPreset.queueClose.layout,
      }}
      transition={motionPreset.queueOpen.layout}
      style={{
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.45)",
        boxShadow: "0 0 24px 3px rgba(255, 255, 255, 0.25), 0 0 60px 12px rgba(255, 255, 255, 0.12), inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.35)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "14px 18px 10px 18px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "rgba(255, 255, 255, 0.88)" }}>
          Notifications ({items.length})
        </span>
        <button
          onClick={onClear}
          style={{
            background: "none",
            border: "none",
            color: "rgba(255, 255, 255, 0.54)",
            fontSize: 12,
            fontWeight: 600,
            cursor: "pointer",
            padding: "2px 6px",
            borderRadius: 4,
            transition: "color 0.15s ease",
          }}
          onMouseEnter={(e) => ((e.target as HTMLElement).style.color = "#ffffff")}
          onMouseLeave={(e) => ((e.target as HTMLElement).style.color = "rgba(255, 255, 255, 0.54)")}
        >
          Clear
        </button>
      </div>

      {/* Items List */}
      <div
        style={{
          overflowY: "auto",
          maxHeight: 380,
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
                initial={{ opacity: 0, y: isReducedMotion ? 0 : 6 }}
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
                  height: 52,
                  display: "flex",
                  alignItems: "center",
                  padding: "0 18px",
                  gap: 12,
                  cursor: "pointer",
                  borderBottom: "1px solid rgba(255, 255, 255, 0.04)",
                  transition: "background-color 0.15s ease",
                }}
                onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "rgba(255, 255, 255, 0.06)")}
                onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.backgroundColor = "transparent")}
              >
                <SourceIcon source={item.source} needsInput={needsInput} size={20} />

                <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
                    <span
                      style={{
                        fontSize: 12,
                        fontWeight: 600,
                        color: "#ffffff",
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        maxWidth: 200,
                      }}
                    >
                      {item.title}
                    </span>
                    {tag && (
                      <span
                        style={{
                          fontSize: 10,
                          fontWeight: 600,
                          padding: "1px 5px",
                          borderRadius: 4,
                          backgroundColor: "rgba(255, 255, 255, 0.10)",
                          color: "rgba(255, 255, 255, 0.8)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {tag}
                      </span>
                    )}
                  </div>
                  <span
                    style={{
                      fontSize: 12,
                      fontWeight: 400,
                      color: "rgba(255, 255, 255, 0.65)",
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {item.text}
                  </span>
                </div>

                <span
                  style={{
                    fontSize: 11,
                    color: "rgba(255, 255, 255, 0.40)",
                    flexShrink: 0,
                    fontWeight: 500,
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
