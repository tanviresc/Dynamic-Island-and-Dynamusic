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
        scale: 1,
        opacity: 1,
        backgroundColor: color,
        boxShadow: `0 0 10px ${color}99, 0 0 4px ${color}66`,
      }}
      exit={{ scale: 0, opacity: 0, transition: { duration: motionPreset.dotDisappear.duration } }}
      transition={{
        scale: motionPreset.dotAppear.scale,
        opacity: motionPreset.dotAppear.opacity,
        backgroundColor: { duration: motionPreset.dotColor.duration },
        boxShadow: { duration: motionPreset.dotColor.duration },
      }}
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        border: "none",
        cursor: "pointer",
        padding: 0,
        outline: "none",
      }}
      aria-label="Island Status Dot"
    />
  );
};
