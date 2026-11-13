import React, { useState, useEffect, useRef } from "react";
import { AnimatePresence } from "motion/react";
import { Dot } from "./Dot";
import { Pill, PillProps } from "./Pill";
import { QueuePanel, QueueItem } from "./QueuePanel";

export type IslandMode = "hidden" | "dot" | "pill" | "queue";

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

  const [queueItems, setQueueItems] = useState<QueueItem[]>([
    {
      id: "q-1",
      source: "antigravity",
      kind: "needs_input",
      title: "Antigravity Agent",
      text: "Waiting for approval: npm run test",
      category: "Needs input",
      createdAt: new Date(Date.now() - 1000 * 60 * 4).toISOString(),
    },
    {
      id: "q-2",
      source: "gmail",
      kind: "new_mail",
      title: "security@google.com",
      text: "Security alert: New sign-in detected",
      category: "Security",
      createdAt: new Date(Date.now() - 1000 * 60 * 25).toISOString(),
    },
    {
      id: "q-3",
      source: "chatgpt",
      kind: "done",
      title: "ChatGPT",
      text: "Analysis completed",
      createdAt: new Date(Date.now() - 1000 * 60 * 90).toISOString(),
    },
  ]);

  const [dotColor, setDotColor] = useState<string>("#0A84FF"); // Blue because needs_input exists
  const [isHovered, setIsHovered] = useState<boolean>(false);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);

  // Update dot color based on queue items (Blue if needs_input / error, else Green)
  useEffect(() => {
    const hasNeedsInput = queueItems.some(
      (it) => it.kind === "needs_input" || it.kind === "error"
    );
    setDotColor(hasNeedsInput ? "#0A84FF" : "#30D158");
  }, [queueItems]);

  // Report hit rectangle to Rust / layout whenever mode or size changes
  useEffect(() => {
    if (!surfaceRef.current || mode === "hidden") {
      onHitRectChange?.(null);
      return;
    }
    const updateRect = () => {
      if (surfaceRef.current) {
        const rect = surfaceRef.current.getBoundingClientRect();
        onHitRectChange?.({
          x: Math.round(rect.left),
          y: Math.round(rect.top),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        });
      }
    };
    updateRect();
    const ro = new ResizeObserver(updateRect);
    ro.observe(surfaceRef.current);
    return () => ro.disconnect();
  }, [mode, onHitRectChange]);

  // Pill 3-second display timer (pausable by hover)
  useEffect(() => {
    if (mode !== "pill" || isHovered) {
      if (timerRef.current) clearTimeout(timerRef.current);
      return;
    }

    timerRef.current = setTimeout(() => {
      // Transition from pill to dot
      setMode(queueItems.length > 0 ? "dot" : "hidden");
    }, 3000);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [mode, isHovered, queueItems.length]);

  // Listen to custom window events for Developer test panel injection
  useEffect(() => {
    const handleInject = (e: CustomEvent) => {
      const data = e.detail;
      setCurrentNotification({
        id: data.id || `inj-${Date.now()}`,
        source: data.source || "claude",
        kind: data.kind || "done",
        title: data.title || "Notification",
        text: data.text || "",
        category: data.category,
      });
      setMode("pill");
    };

    const handleSetMode = (e: CustomEvent) => {
      setMode(e.detail.mode);
    };

    window.addEventListener("island:inject" as any, handleInject);
    window.addEventListener("island:set-mode" as any, handleSetMode);
    return () => {
      window.removeEventListener("island:inject" as any, handleInject);
      window.removeEventListener("island:set-mode" as any, handleSetMode);
    };
  }, []);

  const handlePillClick = () => {
    // Dismiss and transition to dot or hidden
    setMode(queueItems.length > 0 ? "dot" : "hidden");
  };

  const handleDotClick = () => {
    setMode("queue");
  };

  const handleQueueItemClick = (id: string) => {
    setQueueItems((prev) => {
      const next = prev.filter((it) => it.id !== id);
      if (next.length === 0) setMode("hidden");
      return next;
    });
  };

  const handleClearQueue = () => {
    setQueueItems([]);
    setMode("hidden");
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
              onHoverEnter={() => setIsHovered(true)}
              onHoverLeave={() => setIsHovered(false)}
              isReducedMotion={isReducedMotion}
            />
          )}

          {mode === "queue" && (
            <QueuePanel
              key="queue"
              items={queueItems}
              onItemClick={handleQueueItemClick}
              onClear={handleClearQueue}
              onClose={() => setMode(queueItems.length > 0 ? "dot" : "hidden")}
              isReducedMotion={isReducedMotion}
            />
          )}
        </AnimatePresence>
      </div>
    </div>
  );
};
