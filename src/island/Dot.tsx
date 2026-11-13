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
      onClick={onClick}
      className="island-interactive"
      layoutId="island-surface"
      initial={{ scale: 0, opacity: 0 }}
      animate={{
        scale: isReducedMotion ? 1 : [1, 1.15, 1],
        opacity: 1,
        backgroundColor: color,
        boxShadow: isReducedMotion
          ? `0 0 3px 1px rgba(255, 255, 255, 0.95), 0 0 8px 2.5px ${color}, 0 0 16px 5px ${color}80`
          : [
              `0 0 3px 1px rgba(255, 255, 255, 0.95), 0 0 8px 2.5px ${color}, 0 0 16px 5px ${color}80`,
              `0 0 5px 1.5px rgba(255, 255, 255, 1), 0 0 12px 3.5px ${color}, 0 0 24px 7px ${color}99`,
              `0 0 3px 1px rgba(255, 255, 255, 0.95), 0 0 8px 2.5px ${color}, 0 0 16px 5px ${color}80`,
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
        width: 0.5,
        height: 0.5,
        minWidth: 0.5,
        minHeight: 0.5,
        borderRadius: "50%",
        cursor: "pointer",
        padding: 0,
        outline: "none",
        position: "relative",
      }}
      aria-label="Island Status Dot"
    />
  );
};
