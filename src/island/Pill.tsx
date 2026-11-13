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

  return (
    <motion.div
      onClick={onClick}
      onMouseEnter={onHoverEnter}
      onMouseLeave={onHoverLeave}
      className="island-interactive"
      layoutId="island-surface"
      initial={{
        width: 10,
        height: 10,
        borderRadius: 5,
        opacity: 0,
      }}
      animate={{
        width: geometry.width,
        height: geometry.height,
        borderRadius: geometry.borderRadius,
        opacity: 1,
      }}
      exit={{
        width: 10,
        height: 10,
        borderRadius: 5,
        opacity: 0,
        transition: motionPreset.disappear.layout,
      }}
      transition={motionPreset.appear.layout}
      style={{
        backgroundColor: "#000000",
        border: "1px solid rgba(255, 255, 255, 0.14)",
        boxShadow: "0 0 24px 2px rgba(255, 255, 255, 0.16), 0 0 6px rgba(255, 255, 255, 0.10)",
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        padding: "10px 16px",
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
          alignItems: geometry.isTwoLines ? "flex-start" : "center",
          gap: 8,
          width: "100%",
          minWidth: 0,
        }}
      >
        <SourceIcon source={source} needsInput={needsInput} size={20} />

        {geometry.isTwoLines ? (
          <div style={{ display: "flex", flexDirection: "column", minWidth: 0, flex: 1, gap: 2 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: geometry.titleMaxWidth || 240,
                }}
              >
                {title}
              </span>
              {displayCategory && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 600,
                    padding: "2px 6px",
                    borderRadius: 6,
                    backgroundColor: "rgba(255, 255, 255, 0.12)",
                    color: "#ffffff",
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 120,
                  }}
                >
                  {displayCategory}
                </span>
              )}
            </div>
            <span
              style={{
                fontSize: 13,
                fontWeight: 400,
                color: "rgba(255, 255, 255, 0.72)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
                lineHeight: "18px",
              }}
            >
              {text}
            </span>
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, flex: 1 }}>
            {displayCategory && (
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  padding: "2px 6px",
                  borderRadius: 6,
                  backgroundColor: "rgba(255, 255, 255, 0.12)",
                  color: "#ffffff",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: 110,
                  flexShrink: 0,
                }}
              >
                {displayCategory}
              </span>
            )}
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
                <span style={{ color: "rgba(255, 255, 255, 0.44)", flexShrink: 0 }}>·</span>
                <span
                  style={{
                    fontSize: 13,
                    fontWeight: 400,
                    color: "rgba(255, 255, 255, 0.72)",
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
        )}
      </motion.div>
    </motion.div>
  );
};
