import React from "react";

export type SourceType = "claude" | "chatgpt" | "gemini" | "antigravity" | "gmail" | "desktop";

interface SourceIconProps {
  source: SourceType;
  needsInput?: boolean;
  size?: number;
}

const SOURCE_COLORS: Record<SourceType, string> = {
  claude: "#D97757",
  chatgpt: "#10A37F",
  gemini: "#4C8DF6",
  antigravity: "#00C2FF",
  gmail: "#EA4335",
  desktop: "#5E5CE6",
};

const SOURCE_GLYPHS: Record<SourceType, string> = {
  claude: "C",
  chatgpt: "G",
  gemini: "✦",
  antigravity: "A",
  gmail: "M",
  desktop: "⌘",
};

export const SourceIcon: React.FC<SourceIconProps> = ({
  source,
  needsInput = false,
  size = 20,
}) => {
  const bg = SOURCE_COLORS[source] || "#666666";
  const glyph = SOURCE_GLYPHS[source] || "•";

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        flexShrink: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      {/* Needs Input Blue Ring */}
      {needsInput && (
        <div
          style={{
            position: "absolute",
            inset: -3,
            borderRadius: "50%",
            border: "2px solid #0A84FF",
            boxShadow: "0 0 6px rgba(10, 132, 255, 0.6)",
            pointerEvents: "none",
          }}
        />
      )}

      {/* Main Circle */}
      <div
        style={{
          width: size,
          height: size,
          borderRadius: "50%",
          backgroundColor: bg,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#ffffff",
          fontSize: size * 0.55,
          fontWeight: 700,
          lineHeight: 1,
          boxShadow: `0 0 6px ${bg}66`,
        }}
      >
        {glyph}
      </div>
    </div>
  );
};
