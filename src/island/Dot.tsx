import React from "react";
import { motion } from "motion/react";
import { standardMotion, reducedMotion } from "./motion";

export interface DotProps {
  color?: string; // hex
  onClick?: () => void;
  isReducedMotion?: boolean;
}

export const Dot: React.FC<DotProps> = ({
  color = "#30D158",
  onClick,
  isReducedMotion = false,
}) => {
  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;

  return (
    <motion.button
      type="button"
      onClick={onClick}
      className={`island-interactive ${isReducedMotion ? "island-reduced-motion" : "island-surface-transition"}`}
      initial={{ scale: 0.6, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0.6, opacity: 0, transition: { duration: motionPreset.dotDisappear.duration } }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      style={{
        width: 24,
        height: 24,
        minWidth: 24,
        minHeight: 24,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        borderRadius: 9999,
        cursor: "pointer",
        padding: 0,
        margin: 0,
        outline: "none",
        position: "relative",
        pointerEvents: "auto",
        willChange: "transform, opacity",
      }}
      aria-label="Toggle Notification History"
    >
      {/* Sleek 6px visual status indicator dot */}
      <motion.div
        animate={{
          scale: 1,
          opacity: 1,
          backgroundColor: color,
        }}
        transition={{
          scale: motionPreset.dotAppear.scale,
          opacity: motionPreset.dotAppear.opacity,
          backgroundColor: { duration: motionPreset.dotColor.duration },
        }}
        style={{
          width: 6,
          height: 6,
          minWidth: 6,
          minHeight: 6,
          borderRadius: "50%",
          pointerEvents: "none",
          boxShadow: `0 0 6px 1px ${color}`,
        }}
      />
    </motion.button>
  );
};
