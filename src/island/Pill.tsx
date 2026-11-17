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
  isReducedMotion?: boolean;
}

function getSourceGlow(source: SourceType, kind: string): string {
  if (kind === "needs_input" || kind === "error") {
    return "rgba(255, 69, 58, 0.85)"; // Vibrant coral red
  }
  switch (source) {
    case "antigravity":
      return "rgba(0, 194, 255, 0.85)"; // Electric cyan
    case "claude":
      return "rgba(217, 119, 87, 0.80)";
    case "chatgpt":
      return "rgba(16, 163, 127, 0.80)";
    case "gemini":
      return "rgba(76, 141, 246, 0.80)";
    case "gmail":
      return "rgba(234, 67, 53, 0.80)";
    case "desktop":
      return "rgba(94, 92, 230, 0.80)";
    default:
      return "rgba(255, 255, 255, 0.65)";
  }
}

export const Pill: React.FC<PillProps> = ({
  source,
  kind,
  title,
  text,
  category,
  onClick,
  isReducedMotion = false,
}) => {
  const needsInput = kind === "needs_input" || kind === "error";
  const displayCategory = category || (needsInput && kind === "needs_input" ? "Needs input" : kind === "error" ? "Failed" : undefined);

  const geometry = computePillGeometry({
    title,
    text,
    category: displayCategory,
    hasIcon: true,
    needsInput,
  });

  const motionPreset = isReducedMotion ? reducedMotion : standardMotion;
  const glowColor = getSourceGlow(source, kind);

  return (
    <motion.div
      onClick={onClick}
      className={`island-interactive ${isReducedMotion ? "island-reduced-motion" : ""}`}
      initial={{
        width: 24,
        height: 24,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 12,
        opacity: 0,
      }}
      animate={{
        width: geometry.width,
        height: geometry.height,
        paddingLeft: 12,
        paddingRight: 12,
        borderRadius: geometry.borderRadius,
        opacity: 1,
      }}
      exit={{
        width: 24,
        height: 24,
        paddingLeft: 0,
        paddingRight: 0,
        borderRadius: 12,
        opacity: 0,
        transition: motionPreset.disappear.layout as any,
      }}
      transition={motionPreset.appear.layout as any}
      style={{
        willChange: "width, height, padding, opacity, border-radius",
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.85)",
        boxShadow: `0 0 14px 2px rgba(255, 255, 255, 0.35), 0 0 28px 6px ${glowColor}, inset 0 1px 1px 0 rgba(255, 255, 255, 0.55)`,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        position: "relative",
        pointerEvents: "auto",
      }}
    >
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0, transition: motionPreset.disappear.content.opacity as any }}
        transition={{
          duration: motionPreset.appear.content.opacity.duration,
          delay: motionPreset.appear.content.opacity.delay,
        }}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          width: "100%",
          minWidth: 0,
        }}
      >
        {/* Source Icon: circle with letter/glyph (30% reduced: 14px) */}
        <SourceIcon source={source} needsInput={false} size={14} />

        {/* Needs Input / Error Icon (30% reduced: 13px) */}
        {needsInput && (
          <div
            style={{
              width: 13,
              height: 13,
              borderRadius: "50%",
              backgroundColor: "#FF453A",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ffffff",
              fontSize: 8.5,
              fontWeight: 800,
              flexShrink: 0,
              boxShadow: "0 0 6px rgba(255, 69, 58, 0.75)",
            }}
          >
            !
          </div>
        )}

        {/* Category tag if present and not needs input */}
        {displayCategory && !needsInput && (
          <span
            style={{
              fontSize: 8.5,
              fontWeight: 600,
              padding: "1px 5px",
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

        {/* Center-aligned single-line text layout (30% reduced: 10.5px typography) */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 4,
            minWidth: 0,
            overflow: "hidden",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
        >
          <span
            style={{
              fontSize: 10.5,
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
                  fontSize: 10.5,
                  fontWeight: 400,
                  color: "rgba(255, 255, 255, 0.88)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
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
