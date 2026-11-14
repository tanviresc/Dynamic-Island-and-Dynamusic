import React from "react";
import { useDynamusic } from "./useDynamusicStore";

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export const PlayerBar: React.FC<{
  onOpenEq: () => void;
  onToggleLyrics: () => void;
  isLyricsActive: boolean;
}> = ({ onOpenEq, onToggleLyrics, isLyricsActive }) => {
  const {
    currentTrack,
    isPlaying,
    positionMs,
    durationMs,
    volume,
    visualizerBars,
    isShuffle,
    isRepeat,
    likedTrackIds,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleLike,
    toggleShuffle,
    toggleRepeat,
  } = useDynamusic();

  const isLiked = currentTrack ? likedTrackIds.has(currentTrack.id) : false;

  return (
    <div
      style={{
        height: "82px",
        backgroundColor: "#0a0a0c",
        borderTop: "1px solid rgba(255, 255, 255, 0.08)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 24px",
        color: "#fff",
        zIndex: 50,
      }}
    >
      {/* Left: Track Information */}
      <div style={{ display: "flex", alignItems: "center", gap: "14px", width: "280px" }}>
        {currentTrack ? (
          <>
            <img
              src={currentTrack.coverUrl}
              alt={currentTrack.title}
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "8px",
                objectFit: "cover",
                boxShadow: "0 4px 12px rgba(0,0,0,0.5)",
              }}
            />
            <div style={{ overflow: "hidden" }}>
              <div
                style={{
                  fontSize: "13.5px",
                  fontWeight: 600,
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "180px",
                }}
              >
                {currentTrack.title}
              </div>
              <div
                style={{
                  fontSize: "12px",
                  color: "rgba(255,255,255,0.6)",
                  whiteSpace: "nowrap",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  maxWidth: "180px",
                }}
              >
                {currentTrack.artist}
              </div>
            </div>
            <button
              onClick={() => toggleLike(currentTrack.id)}
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                color: isLiked ? "#ff4757" : "rgba(255,255,255,0.4)",
                fontSize: "16px",
                padding: "4px",
                display: "flex",
                alignItems: "center",
              }}
              title={isLiked ? "Unlike" : "Like"}
            >
              {isLiked ? "♥" : "♡"}
            </button>
          </>
        ) : (
          <div style={{ color: "#666", fontSize: "13px" }}>No music playing</div>
        )}
      </div>

      {/* Center: Controls & Scrubber */}
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "6px",
          width: "480px",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "18px" }}>
          <button
            onClick={toggleShuffle}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: isShuffle ? "#00c2ff" : "rgba(255,255,255,0.4)",
              fontSize: "14px",
            }}
            title="Shuffle"
          >
            🔀
          </button>
          <button
            onClick={prev}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#fff",
              fontSize: "16px",
            }}
            title="Previous track"
          >
            ⏮
          </button>
          <button
            onClick={togglePlay}
            style={{
              width: "36px",
              height: "36px",
              borderRadius: "50%",
              background: "#fff",
              color: "#000",
              border: "none",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: "14px",
              boxShadow: "0 0 16px rgba(255,255,255,0.3)",
              transition: "transform 0.15s",
            }}
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? "⏸" : "▶"}
          </button>
          <button
            onClick={next}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: "#fff",
              fontSize: "16px",
            }}
            title="Next track"
          >
            ⏭
          </button>
          <button
            onClick={toggleRepeat}
            style={{
              background: "transparent",
              border: "none",
              cursor: "pointer",
              color: isRepeat ? "#00c2ff" : "rgba(255,255,255,0.4)",
              fontSize: "14px",
            }}
            title="Repeat"
          >
            🔁
          </button>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "10px", width: "100%" }}>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", minWidth: "32px", textAlign: "right" }}>
            {formatTime(positionMs)}
          </span>
          <input
            type="range"
            min="0"
            max={durationMs || 100}
            value={positionMs}
            onChange={(e) => seek(parseFloat(e.target.value))}
            style={{
              flex: 1,
              height: "4px",
              accentColor: "#00c2ff",
              cursor: "pointer",
            }}
          />
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.5)", minWidth: "32px" }}>
            {formatTime(durationMs)}
          </span>
        </div>
      </div>

      {/* Right: Audio Visualizer, EQ, Lyrics, Volume */}
      <div style={{ display: "flex", alignItems: "center", gap: "16px", width: "280px", justifyContent: "flex-end" }}>
        {/* Animated Live Visualizer Waves */}
        <div style={{ display: "flex", alignItems: "flex-end", gap: "3px", height: "16px", marginRight: "6px" }}>
          {visualizerBars.map((lvl, idx) => (
            <div
              key={idx}
              style={{
                width: "3px",
                height: `${Math.max(3, lvl * 16)}px`,
                backgroundColor: isPlaying ? "#00c2ff" : "rgba(255,255,255,0.3)",
                borderRadius: "2px",
                transition: "height 0.1s ease",
              }}
            />
          ))}
        </div>

        <button
          onClick={onOpenEq}
          style={{
            background: "transparent",
            border: "none",
            color: "rgba(255,255,255,0.7)",
            fontSize: "16px",
            cursor: "pointer",
          }}
          title="10-Band Equalizer"
        >
          🎚️
        </button>

        <button
          onClick={onToggleLyrics}
          style={{
            background: isLyricsActive ? "rgba(0, 194, 255, 0.2)" : "transparent",
            border: isLyricsActive ? "1px solid #00c2ff" : "1px solid transparent",
            borderRadius: "6px",
            color: isLyricsActive ? "#00c2ff" : "rgba(255,255,255,0.7)",
            fontSize: "12px",
            fontWeight: 700,
            padding: "4px 8px",
            cursor: "pointer",
          }}
          title="Synced Lyrics"
        >
          LRC
        </button>

        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <span style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)" }}>
            {volume === 0 ? "🔇" : volume < 0.5 ? "🔉" : "🔊"}
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={volume}
            onChange={(e) => setVolume(parseFloat(e.target.value))}
            style={{
              width: "80px",
              height: "4px",
              accentColor: "#00c2ff",
              cursor: "pointer",
            }}
          />
        </div>
      </div>
    </div>
  );
};
