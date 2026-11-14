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
    <button
      onClick={onClick}
      className="island-interactive"
      style={{
        width: 44,
        height: 44,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        padding: 0,
        outline: "none",
        position: "relative",
        pointerEvents: "auto",
      }}
      aria-label="Island Status Dot"
    >
      <motion.div
        layoutId="island-surface"
        initial={{ scale: 0, opacity: 0 }}
        animate={{
          scale: isReducedMotion ? 1 : [1, 1.15, 1],
          opacity: 1,
          backgroundColor: color,
          boxShadow: isReducedMotion
            ? `0 0 2px 0.5px rgba(255, 255, 255, 0.9), 0 0 5px 1px ${color}`
            : [
                `0 0 2px 0.5px rgba(255, 255, 255, 0.9), 0 0 5px 1px ${color}`,
                `0 0 3px 0.8px rgba(255, 255, 255, 1), 0 0 7px 1.5px ${color}`,
                `0 0 2px 0.5px rgba(255, 255, 255, 0.9), 0 0 5px 1px ${color}`,
              ],
        }}
        exit={{ scale: 0, opacity: 0, transition: { duration: motionPreset.dotDisappear.duration } }}
        transition={{
          scale: isReducedMotion
            ? motionPreset.dotAppear.scale
            : { repeat: Infinity, duration: 2.4, ease: "easeInOut" },
          boxShadow: isReducedMotion
            ? { duration: motionPreset.dotColor.duration }
            : { repeat: Infinity, duration: 2.4, ease: "easeInOut" },
          opacity: motionPreset.dotAppear.opacity,
          backgroundColor: { duration: motionPreset.dotColor.duration },
        }}
        style={{
          width: 1,
          height: 1,
          minWidth: 1,
          minHeight: 1,
          borderRadius: "50%",
          pointerEvents: "none",
        }}
      />
    </button>
  );
};
