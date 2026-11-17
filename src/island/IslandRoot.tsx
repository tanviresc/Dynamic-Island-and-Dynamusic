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
  initialMode = "hidden",
  isReducedMotion = false,
  onHitRectChange,
}) => {
  const [mode, setMode] = useState<IslandMode>(initialMode);
  const [currentNotification, setCurrentNotification] = useState<PillProps | null>(null);

  const [queueItems, setQueueItems] = useState<QueueItem[]>([]);
  const [dotColor, setDotColor] = useState<string>("#30D158");
  const surfaceRef = useRef<HTMLDivElement>(null);

  const applyViewModel = (vm: BackendViewModel) => {
    setMode(vm.mode);
    if (vm.color) {
      setDotColor(vm.color);
    }
    if (vm.notification) {
      setCurrentNotification({
        id: vm.notification.id,
        source: vm.notification.source as PillProps["source"],
        kind: vm.notification.kind as PillProps["kind"],
        title: vm.notification.title,
        text: vm.notification.text,
        category: vm.notification.category,
      });
    }
    if (vm.items) {
      setQueueItems(
        vm.items.map((it) => ({
          id: it.id,
          source: it.source as QueueItem["source"],
          kind: it.kind as QueueItem["kind"],
          title: it.title,
          text: it.text,
          category: it.category,
          createdAt: it.createdAt,
        }))
      );
    }
  };

  // Listen to Tauri backend "island://view" events
  useEffect(() => {
    let unlistenView: (() => void) | undefined;

    listen<BackendViewModel>("island://view", (event) => {
      applyViewModel(event.payload);
    }).then((fn) => {
      unlistenView = fn;
    });

    // Initial island view query
    invoke<BackendViewModel>("get_island_view")
      .then((vm) => {
        if (vm) applyViewModel(vm);
      })
      .catch(() => {});

    return () => {
      unlistenView?.();
    };
  }, []);

  // Report hit rectangle to Rust / layout whenever mode or queue size changes
  useEffect(() => {
    const isShowingDot = mode === "dot" || (mode === "hidden" && queueItems.length > 0);

    const updateRect = () => {
      const winWidth = window.innerWidth || 720;
      const centerX = Math.round(winWidth / 2);

      if (mode === "hidden" && queueItems.length === 0) {
        onHitRectChange?.(null);
        invoke("update_hit_rect", { rect: null }).catch(() => {});
        return;
      }

      if (isShowingDot) {
        // Match the 24x24 interactive dot container with minimal click-through padding
        const fallbackHit = {
          left: centerX - 16,
          top: 21,
          right: centerX + 16,
          bottom: 53,
        };
        const rect = surfaceRef.current?.getBoundingClientRect();
        const hit =
          rect && rect.width >= 20 && rect.height >= 20
            ? {
                left: Math.max(0, Math.round(rect.left) - 4),
                top: Math.max(0, Math.round(rect.top) - 4),
                right: Math.min(winWidth, Math.round(rect.right) + 4),
                bottom: Math.round(rect.bottom) + 4,
              }
            : fallbackHit;
        onHitRectChange?.({
          x: hit.left,
          y: hit.top,
          width: hit.right - hit.left,
          height: hit.bottom - hit.top,
        });
        invoke("update_hit_rect", { rect: hit }).catch(() => {});
        return;
      }

      if (surfaceRef.current) {
        const el = surfaceRef.current;
        const child = el.firstElementChild as HTMLElement | null;
        const rect = el.getBoundingClientRect();
        const layoutW = Math.max(rect.width, el.offsetWidth || 0, child?.offsetWidth || 0);
        const layoutH = Math.max(rect.height, el.offsetHeight || 0, child?.offsetHeight || 0);
        if (layoutW >= 10 && layoutH >= 10) {
          const cx = rect.width > 0 ? rect.left + rect.width / 2 : centerX;
          const hit = {
            left: Math.max(0, Math.round(cx - layoutW / 2) - 10),
            top: Math.max(0, Math.round(rect.top) - 8),
            right: Math.min(winWidth, Math.round(cx + layoutW / 2) + 10),
            bottom: Math.round(Math.max(rect.bottom, (el.offsetTop || 25) + layoutH)) + 10,
          };
          onHitRectChange?.({
            x: hit.left,
            y: hit.top,
            width: hit.right - hit.left,
            height: hit.bottom - hit.top,
          });
          invoke("update_hit_rect", { rect: hit }).catch(() => {});
        }
      }
    };

    updateRect();
    const rafId = requestAnimationFrame(updateRect);
    const settleTimer1 = setTimeout(updateRect, 150);
    const settleTimer2 = setTimeout(updateRect, 460);
    const ro = new ResizeObserver(updateRect);
    if (surfaceRef.current) {
      ro.observe(surfaceRef.current);
    }
    return () => {
      cancelAnimationFrame(rafId);
      clearTimeout(settleTimer1);
      clearTimeout(settleTimer2);
      ro.disconnect();
    };
  }, [mode, queueItems.length, onHitRectChange]);

  // Queue panel focus & Escape / Blur handling (§1.6.6, §3.10)
  useEffect(() => {
    if (mode !== "queue") return;

    invoke("set_queue_focus", { takeFocus: true }).catch(() => {});

    let isArmed = false;
    const timer = setTimeout(() => {
      isArmed = true;
    }, 350);

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        handleCloseQueue();
      }
    };

    const handleBlur = () => {
      if (isArmed) {
        handleCloseQueue();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);

    return () => {
      clearTimeout(timer);
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
    setMode((prev) => (prev === "queue" ? (queueItems.length > 0 ? "dot" : "hidden") : "queue"));
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
      <div
        ref={surfaceRef}
        className={isReducedMotion ? "island-reduced-motion" : "island-surface-transition"}
        style={{ display: "inline-flex", justifyContent: "center" }}
      >
        <AnimatePresence mode="wait" initial={false}>
          {mode === "pill" && currentNotification ? (
            <Pill
              key="pill"
              {...currentNotification}
              onClick={handlePillClick}
              isReducedMotion={isReducedMotion}
            />
          ) : mode === "queue" ? (
            <QueuePanel
              key="queue"
              items={queueItems}
              onItemClick={handleQueueItemClick}
              onClear={handleClearQueue}
              onClose={handleCloseQueue}
              isReducedMotion={isReducedMotion}
            />
          ) : mode === "dot" || queueItems.length > 0 ? (
            <Dot
              key="dot"
              color={dotColor}
              onClick={handleDotClick}
              isReducedMotion={isReducedMotion}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
