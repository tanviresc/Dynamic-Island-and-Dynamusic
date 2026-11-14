import React, { useState, useRef } from "react";
import { DynamusicProvider, useDynamusic } from "./useDynamusicStore";
import { PlayerBar } from "./PlayerBar";
import { EqualizerModal } from "./EqualizerModal";
import { SyncedLyricsView } from "./SyncedLyricsView";
import { searchYouTubeMusic } from "./musicService";
import { Track } from "./types";

type ViewMode = "explore" | "search" | "library" | "lyrics" | "rooms";

const DynamusicContent: React.FC = () => {
  const [activeView, setActiveView] = useState<ViewMode>("explore");
  const [isEqOpen, setIsEqOpen] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [searchResults, setSearchResults] = useState<Track[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const {
    queue,
    currentTrack,
    isPlaying,
    likedTrackIds,
    playTrack,
    togglePlay,
    toggleLike,
    addLocalFiles,
  } = useDynamusic();

  const handleSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;
    setIsSearching(true);
    setActiveView("search");
    const results = await searchYouTubeMusic(searchQuery);
    setSearchResults(results);
    setIsSearching(false);
  };

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addLocalFiles(e.dataTransfer.files);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: "100vw",
        height: "100vh",
        backgroundColor: "#0d0d10",
        color: "#ffffff",
        fontFamily: '"Segoe UI Variable Text", "Segoe UI", system-ui, sans-serif',
        overflow: "hidden",
        userSelect: "none",
      }}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      {/* Top Header Bar */}
      <div
        style={{
          height: "56px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "0 24px",
          borderBottom: "1px solid rgba(255, 255, 255, 0.08)",
          backgroundColor: "#111114",
          ...({ WebkitAppRegion: "drag" } as React.CSSProperties),
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
          <div
            style={{
              width: "28px",
              height: "28px",
              borderRadius: "50%",
              background: "linear-gradient(135deg, #00c2ff 0%, #0070f3 100%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontWeight: 800,
              fontSize: "14px",
              boxShadow: "0 0 12px rgba(0, 194, 255, 0.6)",
            }}
          >
            ♪
          </div>
          <span style={{ fontWeight: 700, fontSize: "16px", letterSpacing: "-0.3px" }}>Dynamusic</span>
          <span
            style={{
              fontSize: "11px",
              padding: "2px 6px",
              borderRadius: "4px",
              backgroundColor: "rgba(0, 194, 255, 0.15)",
              color: "#00c2ff",
              fontWeight: 600,
              marginLeft: "6px",
            }}
          >
            ByTune Engine
          </span>
        </div>

        {/* Global Search Bar */}
        <form
          onSubmit={handleSearch}
          style={{
            display: "flex",
            alignItems: "center",
            width: "380px",
            backgroundColor: "rgba(255, 255, 255, 0.06)",
            borderRadius: "20px",
            padding: "4px 14px",
            border: "1px solid rgba(255, 255, 255, 0.1)",
            ...({ WebkitAppRegion: "no-drag" } as React.CSSProperties),
          }}
        >
          <span style={{ marginRight: "8px", color: "rgba(255,255,255,0.4)" }}>🔍</span>
          <input
            type="text"
            placeholder="Search YouTube Music catalog, artists, songs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              background: "transparent",
              border: "none",
              outline: "none",
              color: "#fff",
              fontSize: "13px",
              width: "100%",
            }}
          />
        </form>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", ...({ WebkitAppRegion: "no-drag" } as React.CSSProperties) }}>
          <button
            onClick={() => fileInputRef.current?.click()}
            style={{
              background: "rgba(255,255,255,0.08)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              padding: "6px 14px",
              borderRadius: "16px",
              fontSize: "12px",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "6px",
            }}
          >
            📁 Import Local Files
          </button>
          <input
            type="file"
            ref={fileInputRef}
            style={{ display: "none" }}
            multiple
            accept="audio/*,.mp3,.flac,.wav,.m4a,.aac,.ogg,.opus"
            onChange={(e) => e.target.files && addLocalFiles(e.target.files)}
          />
        </div>
      </div>

      {/* Main Container: Sidebar + Viewport */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Left Sidebar */}
        <div
          style={{
            width: "220px",
            backgroundColor: "#0d0d10",
            borderRight: "1px solid rgba(255, 255, 255, 0.08)",
            padding: "20px 12px",
            display: "flex",
            flexDirection: "column",
            gap: "6px",
          }}
        >
          <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", padding: "0 12px 6px 12px" }}>
            DISCOVER
          </div>

          <button
            onClick={() => setActiveView("explore")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeView === "explore" ? "rgba(0, 194, 255, 0.15)" : "transparent",
              color: activeView === "explore" ? "#00c2ff" : "rgba(255,255,255,0.75)",
              fontWeight: activeView === "explore" ? 700 : 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>🧭</span> Explore & Trending
          </button>

          <button
            onClick={() => setActiveView("search")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeView === "search" ? "rgba(0, 194, 255, 0.15)" : "transparent",
              color: activeView === "search" ? "#00c2ff" : "rgba(255,255,255,0.75)",
              fontWeight: activeView === "search" ? 700 : 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>🔍</span> YouTube Search
          </button>

          <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", padding: "18px 12px 6px 12px" }}>
            YOUR MUSIC
          </div>

          <button
            onClick={() => setActiveView("library")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeView === "library" ? "rgba(0, 194, 255, 0.15)" : "transparent",
              color: activeView === "library" ? "#00c2ff" : "rgba(255,255,255,0.75)",
              fontWeight: activeView === "library" ? 700 : 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>📚</span> Library & Files
          </button>

          <button
            onClick={() => setActiveView("lyrics")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeView === "lyrics" ? "rgba(0, 194, 255, 0.15)" : "transparent",
              color: activeView === "lyrics" ? "#00c2ff" : "rgba(255,255,255,0.75)",
              fontWeight: activeView === "lyrics" ? 700 : 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>🎙️</span> Synced Lyrics (LRCLIB)
          </button>

          <div style={{ fontSize: "11px", fontWeight: 700, color: "rgba(255,255,255,0.4)", padding: "18px 12px 6px 12px" }}>
            SOCIAL & SOUND
          </div>

          <button
            onClick={() => setIsEqOpen(true)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: "transparent",
              color: "rgba(255,255,255,0.75)",
              fontWeight: 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>🎚️</span> 10-Band Equalizer
          </button>

          <button
            onClick={() => setActiveView("rooms")}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "10px",
              padding: "10px 12px",
              borderRadius: "8px",
              border: "none",
              background: activeView === "rooms" ? "rgba(0, 194, 255, 0.15)" : "transparent",
              color: activeView === "rooms" ? "#00c2ff" : "rgba(255,255,255,0.75)",
              fontWeight: activeView === "rooms" ? 700 : 500,
              fontSize: "13.5px",
              cursor: "pointer",
              textAlign: "left",
            }}
          >
            <span>👥</span> Listen Together Rooms
          </button>
        </div>

        {/* Viewport Content */}
        <div style={{ flex: 1, overflowY: "auto", padding: "28px 36px" }}>
          {activeView === "lyrics" ? (
            <SyncedLyricsView />
          ) : activeView === "search" ? (
            <div>
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 16px 0" }}>
                {isSearching ? "Searching YouTube Music..." : `Results for "${searchQuery}"`}
              </h2>
              {searchResults.length === 0 && !isSearching && (
                <div style={{ color: "rgba(255,255,255,0.4)", marginTop: "32px" }}>
                  Search for your favorite songs, artists, or paste a title above.
                </div>
              )}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {searchResults.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      onClick={() => playTrack(track, searchResults)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 16px",
                        borderRadius: "10px",
                        backgroundColor: isCurrent ? "rgba(0, 194, 255, 0.12)" : "rgba(255,255,255,0.03)",
                        cursor: "pointer",
                        transition: "background 0.2s",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <img
                          src={track.coverUrl}
                          alt={track.title}
                          style={{ width: "42px", height: "42px", borderRadius: "6px", objectFit: "cover" }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: isCurrent ? "#00c2ff" : "#fff" }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>{track.artist}</div>
                        </div>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>
                          {track.source === "youtube" ? "YouTube Music" : "Local"}
                        </span>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) togglePlay();
                            else playTrack(track, searchResults);
                          }}
                          style={{
                            width: "32px",
                            height: "32px",
                            borderRadius: "50%",
                            background: isCurrent && isPlaying ? "#00c2ff" : "rgba(255,255,255,0.1)",
                            color: isCurrent && isPlaying ? "#000" : "#fff",
                            border: "none",
                            cursor: "pointer",
                          }}
                        >
                          {isCurrent && isPlaying ? "⏸" : "▶"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeView === "library" ? (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
                <div>
                  <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 6px 0" }}>Your Library</h2>
                  <p style={{ fontSize: "13px", color: "rgba(255,255,255,0.6)", margin: 0 }}>
                    Local music files (MP3, FLAC, WAV, AAC, OGG) and saved songs.
                  </p>
                </div>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  style={{
                    backgroundColor: "#00c2ff",
                    color: "#000",
                    border: "none",
                    fontWeight: 700,
                    padding: "8px 18px",
                    borderRadius: "20px",
                    fontSize: "13px",
                    cursor: "pointer",
                  }}
                >
                  + Add Audio Files
                </button>
              </div>

              {/* Drag and drop zone */}
              <div
                style={{
                  border: "2px dashed rgba(255,255,255,0.15)",
                  borderRadius: "14px",
                  padding: "24px",
                  textAlign: "center",
                  color: "rgba(255,255,255,0.5)",
                  marginBottom: "24px",
                  fontSize: "13px",
                }}
              >
                Drag and drop your audio files here or click "Add Audio Files"
              </div>

              {/* Track list */}
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {queue.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  const isLiked = likedTrackIds.has(track.id);
                  return (
                    <div
                      key={track.id}
                      onClick={() => playTrack(track)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "10px 16px",
                        borderRadius: "10px",
                        backgroundColor: isCurrent ? "rgba(0, 194, 255, 0.12)" : "rgba(255,255,255,0.03)",
                        cursor: "pointer",
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "14px" }}>
                        <img
                          src={track.coverUrl}
                          alt={track.title}
                          style={{ width: "42px", height: "42px", borderRadius: "6px", objectFit: "cover" }}
                        />
                        <div>
                          <div style={{ fontWeight: 600, fontSize: "14px", color: isCurrent ? "#00c2ff" : "#fff" }}>
                            {track.title}
                          </div>
                          <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)" }}>{track.artist}</div>
                        </div>
                      </div>

                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleLike(track.id);
                          }}
                          style={{
                            background: "transparent",
                            border: "none",
                            color: isLiked ? "#ff4757" : "rgba(255,255,255,0.4)",
                            cursor: "pointer",
                          }}
                        >
                          {isLiked ? "♥" : "♡"}
                        </button>
                        <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.4)" }}>{track.source}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : activeView === "rooms" ? (
            <div style={{ maxWidth: "600px" }}>
              <h2 style={{ fontSize: "22px", fontWeight: 700, margin: "0 0 10px 0" }}>Listen Together (Rooms)</h2>
              <p style={{ fontSize: "14px", color: "rgba(255,255,255,0.6)", marginBottom: "24px" }}>
                Listen to music simultaneously with friends in real-time rooms.
              </p>

              <div
                style={{
                  backgroundColor: "rgba(255,255,255,0.04)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "16px",
                  padding: "24px",
                  display: "flex",
                  flexDirection: "column",
                  gap: "18px",
                }}
              >
                <div style={{ display: "flex", gap: "12px" }}>
                  <input
                    type="text"
                    placeholder="Enter 6-digit room code (e.g. 748291)"
                    style={{
                      flex: 1,
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.15)",
                      backgroundColor: "rgba(0,0,0,0.5)",
                      color: "#fff",
                      fontSize: "14px",
                    }}
                  />
                  <button
                    style={{
                      padding: "10px 20px",
                      borderRadius: "8px",
                      backgroundColor: "#00c2ff",
                      color: "#000",
                      fontWeight: 700,
                      border: "none",
                      cursor: "pointer",
                    }}
                  >
                    Join Room
                  </button>
                </div>

                <div style={{ textAlign: "center", color: "rgba(255,255,255,0.3)", fontSize: "12px" }}>OR</div>

                <button
                  style={{
                    padding: "12px",
                    borderRadius: "8px",
                    backgroundColor: "rgba(255,255,255,0.08)",
                    border: "1px solid rgba(255,255,255,0.15)",
                    color: "#fff",
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Create New Room
                </button>
              </div>
            </div>
          ) : (
            /* Explore View */
            <div>
              <div style={{ marginBottom: "32px" }}>
                <h1 style={{ fontSize: "28px", fontWeight: 800, margin: "0 0 6px 0", letterSpacing: "-0.5px" }}>
                  Explore Music
                </h1>
                <p style={{ color: "rgba(255,255,255,0.6)", fontSize: "14px", margin: 0 }}>
                  Stream from YouTube Music without ads or accounts.
                </p>
              </div>

              {/* Grid of tracks / albums */}
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
                  gap: "24px",
                }}
              >
                {queue.map((track) => {
                  const isCurrent = currentTrack?.id === track.id;
                  return (
                    <div
                      key={track.id}
                      onClick={() => playTrack(track)}
                      style={{
                        backgroundColor: isCurrent ? "rgba(0, 194, 255, 0.12)" : "rgba(255,255,255,0.04)",
                        border: isCurrent ? "1px solid #00c2ff" : "1px solid rgba(255,255,255,0.08)",
                        borderRadius: "14px",
                        padding: "14px",
                        cursor: "pointer",
                        transition: "all 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <div style={{ position: "relative", marginBottom: "12px" }}>
                        <img
                          src={track.coverUrl}
                          alt={track.title}
                          style={{
                            width: "100%",
                            aspectRatio: "1/1",
                            borderRadius: "10px",
                            objectFit: "cover",
                            boxShadow: "0 8px 16px rgba(0,0,0,0.5)",
                          }}
                        />
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            if (isCurrent) togglePlay();
                            else playTrack(track);
                          }}
                          style={{
                            position: "absolute",
                            bottom: "8px",
                            right: "8px",
                            width: "38px",
                            height: "38px",
                            borderRadius: "50%",
                            backgroundColor: "#00c2ff",
                            color: "#000",
                            border: "none",
                            boxShadow: "0 4px 12px rgba(0,0,0,0.6)",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            fontSize: "14px",
                          }}
                        >
                          {isCurrent && isPlaying ? "⏸" : "▶"}
                        </button>
                      </div>

                      <div style={{ fontWeight: 700, fontSize: "14px", color: "#fff", marginBottom: "4px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {track.title}
                      </div>
                      <div style={{ fontSize: "12px", color: "rgba(255,255,255,0.6)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                        {track.artist}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Bottom Sticky Player Bar */}
      <PlayerBar
        onOpenEq={() => setIsEqOpen(true)}
        onToggleLyrics={() => setActiveView((v) => (v === "lyrics" ? "explore" : "lyrics"))}
        isLyricsActive={activeView === "lyrics"}
      />

      {/* Equalizer Modal */}
      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />
    </div>
  );
};

export const DynamusicShell: React.FC = () => {
  return (
    <DynamusicProvider>
      <DynamusicContent />
    </DynamusicProvider>
  );
};
