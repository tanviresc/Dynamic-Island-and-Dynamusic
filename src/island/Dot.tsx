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
        scale: isReducedMotion ? 1 : [1, 1.18, 1],
        opacity: 1,
        backgroundColor: color,
        boxShadow: isReducedMotion
          ? `0 0 10px 2px ${color}, 0 0 3px #ffffff, 0 0 18px 4px ${color}80`
          : [
              `0 0 10px 2px ${color}, 0 0 3px #ffffff, 0 0 18px 4px ${color}80`,
              `0 0 14px 3px ${color}, 0 0 5px #ffffff, 0 0 24px 6px ${color}99`,
              `0 0 10px 2px ${color}, 0 0 3px #ffffff, 0 0 18px 4px ${color}80`,
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
        width: 7,
        height: 7,
        borderRadius: "50%",
        border: "1px solid rgba(255, 255, 255, 0.75)",
        cursor: "pointer",
        padding: 0,
        outline: "none",
        position: "relative",
      }}
      aria-label="Island Status Dot"
    />
  );
};
