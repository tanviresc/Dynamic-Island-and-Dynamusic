import React from "react";
import { motion } from "motion/react";
import { SourceIcon, SourceType } from "../shared/icons/SourceIcon";
import { computePillGeometry } from "./measure";
import { standardMotion, reducedMotion } from "./motion";

export interface PillProps {
  id: string;
  source: SourceType;
  kind: "done" | "needs_input" | "error" | "new_mail";
  title: string;
  text: string;
  category?: string;
  onClick?: () => void;
  onHoverEnter?: () => void;
  onHoverLeave?: () => void;
  isReducedMotion?: boolean;
}

function getSourceGlow(source: SourceType, kind: string): string {
  if (kind === "needs_input" || kind === "error") {
    return "rgba(255, 69, 58, 0.65)"; // Radiant coral-red alert glow matching the reference image
  }
  switch (source) {
    case "antigravity":
      return "rgba(0, 194, 255, 0.60)"; // Electric cyan matching the reference image
    case "claude":
      return "rgba(217, 119, 87, 0.55)";
    case "chatgpt":
      return "rgba(16, 163, 127, 0.55)";
    case "gemini":
      return "rgba(76, 141, 246, 0.55)";
    case "gmail":
      return "rgba(234, 67, 53, 0.55)";
    default:
      return "rgba(255, 255, 255, 0.45)";
  }
}

export const Pill: React.FC<PillProps> = ({
  source,
  kind,
  title,
  text,
  category,
  onClick,
  onHoverEnter,
  onHoverLeave,
  isReducedMotion = false,
}) => {
  const needsInput = kind === "needs_input" || kind === "error";
  const displayCategory = category || (needsInput && kind === "needs_input" ? "Needs input" : kind === "error" ? "Failed" : undefined);

  const geometry = computePillGeometry({
    title,
    text,
    category: displayCategory,
    hasIcon: true,
  });

  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;
  const glowColor = getSourceGlow(source, kind);

  return (
    <motion.div
      onClick={onClick}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="island-interactive"
      layoutId="island-surface"
      initial={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
        opacity: 0,
      }}
      animate={{
        width: geometry.width,
        height: geometry.height,
        borderRadius: geometry.borderRadius,
        opacity: 1,
      }}
      exit={{
        width: 7,
        height: 7,
        borderRadius: 3.5,
        opacity: 0,
        transition: motionPreset.disappear.layout,
      }}
      transition={motionPreset.appear.layout}
      style={{
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.55)",
        boxShadow: `0 0 16px 2px rgba(255, 255, 255, 0.35), 0 0 35px 8px ${glowColor}, 0 0 70px 16px ${glowColor}66, inset 0 1px 1.5px 0 rgba(255, 255, 255, 0.45)`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: "0 14px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      <motion.div
        initial={{ opacity: 0, filter: isReducedMotion ? undefined : "blur(6px)" }}
        animate={{ opacity: 1, filter: "blur(0px)" }}
        exit={{ opacity: 0, transition: motionPreset.disappear.content.opacity }}
        transition={{
          duration: motionPreset.appear.content.opacity.duration,
          delay: motionPreset.appear.content.opacity.delay,
        }}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          minWidth: 0,
        }}
      >
        {/* Source Icon: circle with letter/glyph */}
        <SourceIcon source={source} needsInput={false} size={20} />

        {/* Needs Input / Error Icon - Red circle with exclamation '!', exactly as in reference image */}
        {needsInput && (
          <div
            style={{
              width: 18,
              height: 18,
              borderRadius: "50%",
              backgroundColor: "#FF453A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 11,
              fontWeight: 800,
              flexShrink: 0,
              boxShadow: "0 0 8px rgba(255, 69, 58, 0.75)",
            }}
            title={kind === "error" ? "Error" : "Needs Input"}
          >
            !
          </div>
        )}

        {/* Category tag if present and not needs input */}
        {displayCategory && !needsInput && (
          <span
            style={{
              fontSize: 10,
              fontWeight: 600,
              padding: "1px 6px",
              borderRadius: 9999,
              backgroundColor: "rgba(255, 255, 255, 0.14)",
              color: "#ffffff",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {displayCategory}
          </span>
        )}

        {/* Single-line text layout with crisp white typography */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            flex: 1,
            overflow: "hidden",
            whiteSpace: "nowrap",
          }}
        >
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              color: "#ffffff",
              whiteSpace: "nowrap",
              flexShrink: 0,
            }}
          >
            {title}
          </span>
          {text && (
            <>
              <span style={{ color: "rgba(255, 255, 255, 0.40)", flexShrink: 0, margin: "0 1px" }}>:</span>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 400,
                  color: "rgba(255, 255, 255, 0.88)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  flex: 1,
                }}
              >
                {text}
              </span>
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
};
