import React, { useEffect, useRef } from "react";
import { X, Mic } from "lucide-react";
import { useDynamusic } from "./useDynamusicStore";

export const SyncedLyricsView: React.FC = () => {
  const { currentTrack, lyrics, currentLyricIndex, seek, toggleLyricsCenter } = useDynamusic();
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
      <div className="flex items-center justify-center h-full text-white/50 text-[14px]">
        No track playing
      </div>
    );
  }

  return (
    <div className="relative flex h-full p-8 gap-10 overflow-hidden select-none bg-[#121214]">
      {/* Background ambient album glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-1/4 -left-1/4 w-3/4 h-3/4 opacity-30 blur-[100px]"
        style={{
          background: "radial-gradient(circle, rgba(185, 28, 28, 0.6) 0%, transparent 70%)",
        }}
      />

      {/* Close lyrics button */}
      <button
        onClick={toggleLyricsCenter}
        title="Close lyrics"
        className="absolute top-4 right-4 z-20 w-8 h-8 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center transition-colors"
      >
        <X className="w-4 h-4" />
      </button>

      {/* Left side: Album Art & Track Info */}
      <div className="w-[300px] flex flex-col items-center justify-center shrink-0 z-10">
        <img
          src={currentTrack.coverUrl}
          alt={currentTrack.title}
          className="w-64 h-64 rounded-2xl object-cover shadow-2xl mb-6 bg-black/40 border border-white/10"
        />
        <h2 className="text-[22px] font-extrabold text-white text-center leading-tight">
          {currentTrack.title}
        </h2>
        <p className="text-[14px] font-medium text-white/60 text-center mt-1">
          {currentTrack.artist}
        </p>
        {currentTrack.album && (
          <span className="text-[12px] text-white/40 mt-1">
            {currentTrack.album}
          </span>
        )}
      </div>

      {/* Right side: Auto-scrolling Synced Lyrics */}
      <div
        ref={scrollContainerRef}
        className="flex-1 overflow-y-auto py-24 px-6 flex flex-col gap-6 relative z-10 custom-scroll"
        style={{
          maskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
          WebkitMaskImage: "linear-gradient(to bottom, transparent 0%, black 15%, black 85%, transparent 100%)",
        }}
      >
        {lyrics.length === 0 ? (
          <div className="flex flex-col items-center justify-center my-auto gap-3 text-white/50">
            <Mic className="w-8 h-8 text-white/30" />
            <div className="text-[15px] font-medium italic">
              Searching live synced lyrics on LRCLIB...
            </div>
            <div className="text-[12px] text-white/40">
              Lyrics will appear automatically when found.
            </div>
          </div>
        ) : (
          lyrics.map((line, idx) => {
            const isActive = idx === currentLyricIndex;
            return (
              <div
                key={`${line.timeMs}-${idx}`}
                ref={isActive ? activeLineRef : null}
                onClick={() => seek(line.timeMs)}
                className={`cursor-pointer transition-all duration-300 transform-gpu ${
                  isActive
                    ? "text-[28px] font-extrabold text-white scale-[1.02] origin-left drop-shadow-[0_0_16px_rgba(255,255,255,0.4)]"
                    : "text-[20px] font-semibold text-white/30 hover:text-white/60"
                }`}
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
