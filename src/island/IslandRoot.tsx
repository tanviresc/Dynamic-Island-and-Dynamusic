import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { Dot } from "./Dot";
import { Pill, PillProps } from "./Pill";
import { QueuePanel, QueueItem } from "./QueuePanel";
import { MusicPill } from "./MusicPill";
import { TopEdgeSnapTrigger } from "./TopEdgeSnapTrigger";
import { IPCMusicState } from "./types";

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
  const [musicState, setMusicState] = useState<IPCMusicState | null>(null);
  const [isProximityActive, setIsProximityActive] = useState<boolean>(false);
  const proximityTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isInteractingRef = useRef<boolean>(false);
  const surfaceRef = useRef<HTMLDivElement>(null);

  const PREVIEW_AUTO_HIDE_MS = 4000;

  const clearPreviewTimer = () => {
    if (proximityTimerRef.current) {
      clearTimeout(proximityTimerRef.current);
      proximityTimerRef.current = null;
    }
  };

  const schedulePreviewCollapse = () => {
    clearPreviewTimer();
    if (isInteractingRef.current) return;
    proximityTimerRef.current = setTimeout(() => {
      proximityTimerRef.current = null;
      setIsProximityActive(false);
    }, PREVIEW_AUTO_HIDE_MS);
  };

  const applyViewModel = (vm: BackendViewModel) => {
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
  };

  // Listen to Tauri backend "island://view" and "island://music-state" events
  useEffect(() => {
    let unlistenView: (() => void) | undefined;
    let unlistenMusic: (() => void) | undefined;

    listen<BackendViewModel>("island://view", (event) => {
      applyViewModel(event.payload);
    }).then((fn) => {
      unlistenView = fn;
    });

    listen<IPCMusicState | null>("island://music-state", (event) => {
      setMusicState(event.payload);
    }).then((fn) => {
      unlistenMusic = fn;
    });

    // Initial island view & music state query
    invoke<BackendViewModel>("get_island_view")
      .then((vm) => {
        if (vm) applyViewModel(vm);
      })
      .catch(() => {});

    invoke<IPCMusicState | null>("get_music_state")
      .then((st) => {
        if (st) setMusicState(st);
      })
      .catch(() => {});

    return () => {
      unlistenView?.();
      unlistenMusic?.();
      clearPreviewTimer();
    };
  }, []);

  const handleProximityTrigger = () => {
    setIsProximityActive(true);
    schedulePreviewCollapse();
  };

  const handleMusicHoverEnter = () => {
    setIsProximityActive(true);
    schedulePreviewCollapse();
  };

  const handleMusicHoverLeave = () => {
    // Strict 4-second auto-hide rule: collapse runs on the 4000ms timer from activation
    // or interaction end, even if WebView drops onMouseLeave on transparent transitions.
  };

  const handleMusicInteractionStart = () => {
    isInteractingRef.current = true;
    clearPreviewTimer();
  };

  const handleMusicInteractionEnd = () => {
    isInteractingRef.current = false;
    schedulePreviewCollapse();
  };

  const handleOpenDynamusic = () => {
    invoke("open_dynamusic_window").catch(() => {});
  };

  const handleMusicControl = (action: "play_pause" | "next" | "previous") => {
    const command =
      action === "play_pause" ? "toggle_play" : action === "previous" ? "prev" : "next";
    invoke("send_music_command", { command }).catch(() => {});
  };

  const handleMusicSeek = (targetSeconds: number) => {
    invoke("send_music_command", { command: "seek", payload: targetSeconds }).catch(() => {});
  };

  // Report hit rectangle to Rust / layout whenever mode, music state, or size changes
  useEffect(() => {
    const isShowingMusic = isProximityActive && mode !== "pill" && mode !== "queue";
    const isShowingDot = !isShowingMusic && (mode === "dot" || (mode === "hidden" && queueItems.length > 0));

    const updateRect = () => {
      const winWidth = window.innerWidth || 720;
      const centerX = Math.round(winWidth / 2);

      if (mode === "hidden" && !isShowingMusic && queueItems.length === 0) {
        // Top edge snap trigger zone: 280px wide centered in 720px window (220 to 500), 28px tall
        const defaultTriggerHit = {
          left: centerX - 140,
          top: 0,
          right: centerX + 140,
          bottom: 28,
        };
        onHitRectChange?.({ x: defaultTriggerHit.left, y: 0, width: 280, height: 28 });
        invoke("update_hit_rect", { rect: defaultTriggerHit }).catch(() => {});
        return;
      }

      if (isShowingDot) {
        // Generous clickable hit-box covering the top-center approach and the expanded dot
        const minDotHit = {
          left: centerX - 38,
          top: 0,
          right: centerX + 38,
          bottom: 84,
        };
        const rect = surfaceRef.current?.getBoundingClientRect();
        const hit =
          rect && rect.width >= 20 && rect.height >= 20
            ? {
                left: Math.min(minDotHit.left, Math.round(rect.left) - 12),
                top: 0,
                right: Math.max(minDotHit.right, Math.round(rect.right) + 12),
                bottom: Math.max(minDotHit.bottom, Math.round(rect.bottom) + 12),
              }
            : minDotHit;
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
        // Use unscaled layout dimensions (offsetWidth/offsetHeight) so CSS scaleX/scaleY entrance transforms
        // never trap outer controls (Prev/Play/Next/scrubber) outside the native click-through hit_rect.
        const layoutW = Math.max(rect.width, el.offsetWidth || 0, child?.offsetWidth || 0);
        const layoutH = Math.max(rect.height, el.offsetHeight || 0, child?.offsetHeight || 0);
        if (layoutW >= 10 && layoutH >= 10) {
          const cx = rect.width > 0 ? rect.left + rect.width / 2 : centerX;
          const hit = {
            left: Math.max(0, Math.round(cx - layoutW / 2) - 10),
            top: isShowingMusic ? 0 : Math.max(0, Math.round(rect.top) - 8),
            right: Math.min(winWidth, Math.round(cx + layoutW / 2) + 10),
            bottom: Math.round(Math.max(rect.bottom, (el.offsetTop || 25) + layoutH)) + 10,
          };
          onHitRectChange?.({ x: hit.left, y: hit.top, width: hit.right - hit.left, height: hit.bottom - hit.top });
          invoke("update_hit_rect", { rect: hit }).catch(() => {});
        }
      }
    };

    updateRect();
    const rafId = requestAnimationFrame(updateRect);
    const settleTimer1 = setTimeout(updateRect, 100);
    const settleTimer2 = setTimeout(updateRect, 300);
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
  }, [mode, musicState, isProximityActive, queueItems.length, onHitRectChange]);

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
        isActive={isProximityActive || mode === "pill" || mode === "queue" || mode === "dot" || queueItems.length > 0}
        onHitRectReport={handleTopTriggerHitRect}
      />

      <div ref={surfaceRef} style={{ display: "inline-flex", justifyContent: "center" }}>
        <AnimatePresence mode="popLayout" initial={false}>
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
              musicState={musicState}
              onOpenDynamusic={handleOpenDynamusic}
              onMusicControl={handleMusicControl}
              onMusicSeek={handleMusicSeek}
            />
          ) : isProximityActive ? (
            <MusicPill
              key="music-pill"
              title={musicState?.title || "Dynamusic"}
              artist={musicState?.artist || "Click to open player"}
              albumArt={musicState?.albumArt}
              isPlaying={musicState?.isPlaying ?? false}
              positionMs={musicState?.positionMs ?? 0}
              durationMs={musicState?.durationMs ?? 0}
              onHoverEnter={handleMusicHoverEnter}
              onHoverLeave={handleMusicHoverLeave}
              onClickBody={handleOpenDynamusic}
              onSeek={handleMusicSeek}
              onInteractionStart={handleMusicInteractionStart}
              onInteractionEnd={handleMusicInteractionEnd}
              unreadCount={queueItems.length}
              onOpenQueue={() => {
                clearPreviewTimer();
                setIsProximityActive(false);
                setMode("queue");
              }}
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
