import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Dot } from "./Dot";
import { Pill, PillProps } from "./Pill";
import { QueuePanel, QueueItem } from "./QueuePanel";
import { MusicPill } from "./MusicPill";
import { TopEdgeSnapTrigger } from "./TopEdgeSnapTrigger";
import { IPCMusicState } from "../dynamusic/types";

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
  const [musicState, setMusicState] = useState<IPCMusicState | null>(null);
  const [isProximityActive, setIsProximityActive] = useState<boolean>(false);
  const proximityTimerRef = useRef<NodeJS.Timeout | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Listen to Tauri backend "island://view" and "island://music-state" events
  useEffect(() => {
    let unlistenView: (() => void) | undefined;
    let unlistenMusic: (() => void) | undefined;

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
      unlistenView = fn;
    });

    listen<IPCMusicState | null>("island://music-state", (event) => {
      setMusicState(event.payload);
    }).then((fn) => {
      unlistenMusic = fn;
    });

    // Initial music state query
    invoke<IPCMusicState | null>("get_music_state")
      .then((st) => {
        if (st) setMusicState(st);
      })
      .catch(() => {});

    return () => {
      unlistenView?.();
      unlistenMusic?.();
    };
  }, []);

  const handleProximityTrigger = () => {
    if (proximityTimerRef.current) {
      clearTimeout(proximityTimerRef.current);
      proximityTimerRef.current = null;
    }
    setIsProximityActive(true);
  };

  const handleMusicHoverEnter = () => {
    if (proximityTimerRef.current) {
      clearTimeout(proximityTimerRef.current);
      proximityTimerRef.current = null;
    }
    setIsProximityActive(true);
  };

  const handleMusicHoverLeave = () => {
    if (proximityTimerRef.current) {
      clearTimeout(proximityTimerRef.current);
    }
    proximityTimerRef.current = setTimeout(() => {
      setIsProximityActive(false);
    }, 650);
  };

  const handleOpenDynamusic = () => {
    invoke("open_dynamusic_window").catch(() => {});
  };

  // Report hit rectangle to Rust / layout whenever mode, music state, or size changes
  useEffect(() => {
    const isShowingMusic = isProximityActive && mode !== "pill" && mode !== "queue";

    const updateRect = () => {
      if (mode === "hidden" && !isShowingMusic) {
        // Top edge snap trigger zone: 280px wide centered in 720px window (220 to 500), 28px tall
        const defaultTriggerHit = {
          left: 220,
          top: 0,
          right: 500,
          bottom: 28,
        };
        onHitRectChange?.({ x: 220, y: 0, width: 280, height: 28 });
        invoke("update_hit_rect", { rect: defaultTriggerHit }).catch(() => {});
        return;
      }

      if (surfaceRef.current) {
        const rect = surfaceRef.current.getBoundingClientRect();
        if (mode === "dot") {
          // Dot: generous hit area around dot button plus top trigger zone
          const hit = {
            left: Math.min(220, Math.round(rect.left) - 10),
            top: 0,
            right: Math.max(500, Math.round(rect.right) + 10),
            bottom: Math.max(48, Math.round(rect.bottom) + 8),
          };
          onHitRectChange?.({ x: hit.left, y: hit.top, width: hit.right - hit.left, height: hit.bottom - hit.top });
          invoke("update_hit_rect", { rect: hit }).catch(() => {});
        } else {
          const hit = {
            left: Math.round(rect.left),
            top: Math.round(rect.top),
            right: Math.round(rect.right),
            bottom: Math.round(rect.bottom),
          };
          onHitRectChange?.({ x: hit.left, y: hit.top, width: hit.right - hit.left, height: hit.bottom - hit.top });
          invoke("update_hit_rect", { rect: hit }).catch(() => {});
        }
      }
    };

    updateRect();
    const ro = new ResizeObserver(updateRect);
    if (surfaceRef.current) {
      ro.observe(surfaceRef.current);
    }
    return () => ro.disconnect();
  }, [mode, musicState, isProximityActive, onHitRectChange]);

  const handleTopTriggerHitRect = (rect: { x: number; y: number; width: number; height: number } | null) => {
    if (rect && !isProximityActive && mode === "hidden") {
      invoke("update_hit_rect", {
        rect: {
          left: rect.x,
          top: rect.y,
          right: rect.x + rect.width,
          bottom: rect.y + rect.height,
        },
      }).catch(() => {});
    }
  };

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
      {/* Option B: Proximity Snap Trigger along top-center edge */}
      <TopEdgeSnapTrigger
        onTrigger={handleProximityTrigger}
        isActive={isProximityActive || mode === "pill" || mode === "queue"}
        onHitRectReport={handleTopTriggerHitRect}
      />

      <div ref={surfaceRef} style={{ display: "inline-flex", justifyContent: "center" }}>
        <AnimatePresence mode="wait">
          {mode === "pill" && currentNotification ? (
            <Pill
              key="pill"
              {...currentNotification}
              onClick={handlePillClick}
              onHoverEnter={handleHoverEnter}
              onHoverLeave={handleHoverLeave}
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
          ) : isProximityActive ? (
            <MusicPill
              key="music-pill"
              title={musicState?.title || "Dynamusic"}
              artist={musicState?.artist || "Click to open player"}
              albumArt={musicState?.albumArt}
              isPlaying={musicState?.isPlaying ?? false}
              onHoverEnter={handleMusicHoverEnter}
              onHoverLeave={handleMusicHoverLeave}
              onClickBody={handleOpenDynamusic}
              unreadCount={queueItems.length}
              onOpenQueue={() => setMode("queue")}
              isReducedMotion={isReducedMotion}
            />
          ) : mode === "dot" || queueItems.length > 0 ? (
            <Dot
              key="dot"
              color={dotColor}
              onClick={handleDotClick}
              onMouseEnter={handleProximityTrigger}
              isReducedMotion={isReducedMotion}
            />
          ) : null}
        </AnimatePresence>
      </div>
    </div>
  );
};
