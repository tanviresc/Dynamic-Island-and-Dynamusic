import React from "react";
import { motion } from "motion/react";
import { standardMotion, reducedMotion } from "./motion";

export interface DotProps {
  color?: string; // hex
  onClick?: () => void;
  onHoverEnter?: () => void;
  isReducedMotion?: boolean;
}

export const Dot: React.FC<DotProps> = ({
  color = "#30D158",
  onClick,
  onHoverEnter,
  isReducedMotion = false,
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      onMouseEnter={onHoverEnter}
      className="island-interactive"
      initial={{ scale: 0.5, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.5, opacity: 0, transition: { duration: motionPreset.dotDisappear.duration } }}
      transition={{ duration: 0.18, ease: "easeOut" }}
      style={{
        width: 64,
        height: 52,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(0, 0, 0, 0.03)",
        border: "none",
        borderRadius: 9999,
        cursor: "pointer",
        padding: 0,
        outline: "none",
        position: "relative",
        pointerEvents: "auto",
        willChange: "transform, opacity",
      }}
      aria-label="Island Status Dot"
      title="Open Dynamic Island"
    >
      {/* Visual 2x x 2x indicator dot (12px x 12px scaled from 6px x 6px) */}
      <motion.div
        animate={{
          scale: isReducedMotion ? 1 : [1, 1.18, 1],
          opacity: 1,
          backgroundColor: color,
        }}
        transition={{
          scale: isReducedMotion
            ? motionPreset.dotAppear.scale
            : { repeat: Infinity, duration: 2.2, ease: "easeInOut" },
          opacity: motionPreset.dotAppear.opacity,
          backgroundColor: { duration: motionPreset.dotColor.duration },
        }}
        style={{
          width: 12,
          height: 12,
          minWidth: 12,
          minHeight: 12,
          borderRadius: "50%",
          border: "1px solid rgba(255, 255, 255, 0.25)",
          pointerEvents: "none",
          boxShadow: `0 0 6px 1px rgba(255, 255, 255, 0.45), 0 0 10px 2px ${color}`,
          willChange: "transform, opacity",
        }}
      />
    </motion.button>
  );
};
