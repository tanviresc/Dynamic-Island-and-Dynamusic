import React, { useRef, useEffect } from "react";

export interface TopEdgeSnapTriggerProps {
  onTrigger: () => void;
  isActive: boolean;
  onHitRectReport?: (rect: { x: number; y: number; width: number; height: number } | null) => void;
}

export const TopEdgeSnapTrigger: React.FC<TopEdgeSnapTriggerProps> = ({
  onTrigger,
  isActive,
  onHitRectReport,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (triggerRef.current && onHitRectReport && !isActive) {
      const rect = triggerRef.current.getBoundingClientRect();
      onHitRectReport({
        x: rect.x,
        y: rect.y,
        width: rect.width,
        height: rect.height,
      });
    }
  }, [isActive, onHitRectReport]);

  if (isActive) return null;

  return (
    <div
      ref={triggerRef}
      onMouseEnter={onTrigger}
      onMouseMove={onTrigger}
      className="island-interactive"
      style={{
        position: "absolute",
        top: 0,
        left: "50%",
        transform: "translateX(-50%)",
        width: "280px",
        height: "28px",
        background: "transparent",
        cursor: "pointer",
        zIndex: 999,
      }}
      title="Hover to reveal Dynamusic"
    />
  );
};
