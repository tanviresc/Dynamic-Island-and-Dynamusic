import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Dot } from "./Dot";
import { Pill, PillProps } from "./Pill";
import { QueuePanel, QueueItem } from "./QueuePanel";

export type IslandMode = "hidden" | "dot" | "pill" | "queue";

interface BackendViewModel {
  mode: IslandMode;
  color?: string;
  notification?: {
    id: string;
    source: string;
    kind: string;
    title: string;
    text: string;
    category?: string;
  };
  items?: Array<{
    id: string;
    source: string;
    kind: string;
    title: string;
    text: string;
    category?: string;
    createdAt: string;
  }>;
}

export interface IslandRootProps {
  initialMode?: IslandMode;
  isReducedMotion?: boolean;
  onHitRectChange?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
}

export const IslandRoot: React.FC<IslandRootProps> = ({
  initialMode = "pill",
  isReducedMotion = false,
  onHitRectChange,
}) => {
  const [mode, setMode] = useState<IslandMode>(initialMode);
  const [currentNotification, setCurrentNotification] = useState<PillProps | null>({
    id: "sample-1",
    source: "claude",
    kind: "done",
    title: "Claude finished",
    text: "Refactor plan for auth module ready for review",
    category: undefined,
  });

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [dotColor, setDotColor] = useState<string>("#30D158");
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Listen to Tauri backend "island://view" event
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<BackendViewModel>("island://view", (event) => {
      const vm = event.payload;
      setMode(vm.mode);
      if (vm.color) {
        setDotColor(vm.color);
      }
      if (vm.notification) {
        setCurrentNotification({
          id: vm.notification.id,
          source: vm.notification.source as any,
          kind: vm.notification.kind as any,
          title: vm.notification.title,
          text: vm.notification.text,
          category: vm.notification.category,
        });
      }
      if (vm.items) {
        setQueueItems(
          vm.items.map((it) => ({
            id: it.id,
            source: it.source as any,
            kind: it.kind as any,
            title: it.title,
            text: it.text,
            category: it.category,
            createdAt: it.createdAt,
          }))
        );
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Report hit rectangle to Rust / layout whenever mode or size changes
  useEffect(() => {
    if (!surfaceRef.current || mode === "hidden") {
      onHitRectChange?.(null);
      invoke("update_hit_rect", { rect: null }).catch(() => {});
      return;
    }
    const updateRect = () => {
      if (surfaceRef.current) {
        const rect = surfaceRef.current.getBoundingClientRect();
        const hit = {
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        };
        onHitRectChange?.(hit);
        invoke("update_hit_rect", {
          rect: {
            left: hit.x,
            top: hit.y,
            right: hit.x + hit.width,
            bottom: hit.y + hit.height,
          },
        }).catch(() => {});
      }
    };
    updateRect();
    const ro = new ResizeObserver(updateRect);
    ro.observe(surfaceRef.current);
    return () => ro.disconnect();
  }, [mode, onHitRectChange]);

  // Queue panel focus & Escape / Blur handling (§1.6.6, §3.10)
  useEffect(() => {
    if (mode !== "queue") return;

    invoke("set_queue_focus", { takeFocus: true }).catch(() => {});

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseQueue();
      }
    };

    const handleBlur = () => {
      handleCloseQueue();
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("blur", handleBlur);
      invoke("set_queue_focus", { takeFocus: false }).catch(() => {});
    };
  }, [mode]);

  const handlePillClick = () => {
    try {
      invoke("send_island_input", { action: "pill_clicked" });
    } catch {}
    setMode(queueItems.length > 0 ? "dot" : "hidden");
  };

  const handleDotClick = () => {
    try {
      invoke("send_island_input", { action: "dot_clicked" });
    } catch {}
    setMode("queue");
  };

  const handleHoverEnter = () => {
    try {
      invoke("send_island_input", { action: "hover_enter" });
    } catch {}
  };

  const handleHoverLeave = () => {
    try {
      invoke("send_island_input", { action: "hover_leave" });
    } catch {}
  };

  const handleQueueItemClick = (id: string) => {
    try {
      invoke("send_island_input", { action: `queue_item:${id}` });
    } catch {}
    setQueueItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      if (next.length === 0) setMode("hidden");
      return next;
    });
  };

  const handleClearQueue = () => {
    try {
      invoke("send_island_input", { action: "queue_clear" });
    } catch {}
    setQueueItems([]);
    setMode("hidden");
  };

  const handleCloseQueue = () => {
    try {
      invoke("send_island_input", { action: "queue_close" });
    } catch {}
    setMode(queueItems.length > 0 ? "dot" : "hidden");
  };

  return (
    <div className="island-window-container">
      <div ref={surfaceRef} style={{ display: "inline-flex", justifyContent: "center" }}>
        <AnimatePresence mode="wait">
          {mode === "dot" && (
            <Dot
              key="dot"
              color={dotColor}
              onClick={handleDotClick}
              isReducedMotion={isReducedMotion}
            />
          )}

          {mode === "pill" && currentNotification && (
            <Pill
              key="pill"
              {...currentNotification}
              onClick={handlePillClick}
              onHoverEnter={handleHoverEnter}
              onHoverLeave={handleHoverLeave}
              isReducedMotion={isReducedMotion}
            />
          )}

          {mode === "queue" && (
            <QueuePanel
              key="queue"
              items={queueItems}
              onItemClick={handleQueueItemClick}
              onClear={handleClearQueue}
              onClose={handleCloseQueue}
              isReducedMotion={isReducedMotion}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
