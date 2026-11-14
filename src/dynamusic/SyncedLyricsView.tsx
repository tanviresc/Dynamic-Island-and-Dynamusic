import React, { useEffect, useRef } from "react";
import { useDynamusic } from "./useDynamusicStore";

export const SyncedLyricsView: React.FC = () => {
  const { currentTrack, lyrics, currentLyricIndex, seek } = useDynamusic();
  const activeLineRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to active lyric line smoothly
  useEffect(() => {
    if (activeLineRef.current && scrollContainerRef.current) {
      activeLineRef.current.scrollIntoView({
        behavior: "smooth",
        block: "center",
      });
    }
  }, [currentLyricIndex]);

  if (!currentTrack) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: "#666" }}>
        No track playing
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        height: "100%",
        padding: "32px",
        gap: "40px",
        overflow: "hidden",
        position: "relative",
      }}
    >
      {/* Background ambient album glow */}
      <div
        style={{
          position: "absolute",
          top: "-20%",
          left: "-10%",
          width: "60%",
          height: "80%",
          background: `radial-gradient(circle, rgba(0, 194, 255, 0.15) 0%, transparent 70%)`,
          filter: "blur(80px)",
          pointerEvents: "none",
        }}
      />

      {/* Left side: Album Art & Track Info */}
      <div
        style={{
          width: "320px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <img
          src={currentTrack.coverUrl}
          alt={currentTrack.title}
          style={{
            width: "280px",
            height: "280px",
            borderRadius: "16px",
            objectFit: "cover",
            boxShadow: "0 20px 40px rgba(0,0,0,0.7), 0 0 30px rgba(0, 194, 255, 0.25)",
            marginBottom: "24px",
          }}
        />
        <h2 style={{ fontSize: "20px", fontWeight: 700, margin: "0 0 6px 0", color: "#fff", textAlign: "center" }}>
          {currentTrack.title}
        </h2>
        <p style={{ fontSize: "14px", margin: 0, color: "rgba(255,255,255,0.6)", textAlign: "center" }}>
          {currentTrack.artist}
        </p>
        {currentTrack.album && (
          <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)", marginTop: "4px" }}>
            {currentTrack.album}
          </span>
        )}
      </div>

      {/* Right side: Auto-scrolling Synced Lyrics */}
      <div
        ref={scrollContainerRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "80px 24px",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
          maskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
        }}
      >
        {lyrics.length === 0 ? (
          <div style={{ color: "rgba(255,255,255,0.5)", fontSize: "16px", fontStyle: "italic", textAlign: "center", marginTop: "120px" }}>
            Searching live lyrics on LRCLIB...
          </div>
        ) : (
          lyrics.map((line, idx) => {
            const isActive = idx === currentLyricIndex;
            return (
              <div
                key={line.timeMs + line.text}
                ref={isActive ? activeLineRef : null}
                onClick={() => seek(line.timeMs)}
                style={{
                  fontSize: isActive ? "28px" : "20px",
                  fontWeight: isActive ? 800 : 600,
                  color: isActive ? "#ffffff" : "rgba(255, 255, 255, 0.35)",
                  textShadow: isActive ? "0 0 20px rgba(0, 194, 255, 0.7)" : "none",
                  cursor: "pointer",
                  transition: "all 0.3s cubic-bezier(0.16, 1, 0.3, 1)",
                  transform: isActive ? "scale(1.02)" : "scale(1)",
                  transformOrigin: "left center",
                  userSelect: "none",
                }}
              >
                {line.text}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
