import React from "react";
import { Search, Play, Loader2 } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { Track } from "../types";

export const SearchView: React.FC = () => {
  const { searchQuery, isSearching, searchResults, playTrack } = useDynamusic();

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  return (
    <div className="pb-16 select-none">
      <div className="flex items-center gap-3 mb-6">
        <Search className="w-6 h-6 text-white/50" />
        <h1 className="text-[28px] font-black tracking-tight text-white">
          {searchQuery ? `Results for “${searchQuery}”` : "Search"}
        </h1>
      </div>

      {isSearching ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 text-white/50">
          <Loader2 className="w-8 h-8 animate-spin text-white/70" />
          <div className="text-[14px]">Searching YouTube Music catalog...</div>
        </div>
      ) : searchResults.length > 0 ? (
        <div className="space-y-1">
          {searchResults.map((t: Track, idx: number) => (
            <div
              key={t.id}
              role="button"
              tabIndex={0}
              onClick={() => playTrack(t, searchResults)}
              className="group flex items-center gap-4 px-3 py-2.5 rounded-lg hover:bg-white/[0.06] cursor-pointer transition-colors"
            >
              <span className="w-6 text-center text-white/50 text-[13px]">{idx + 1}</span>
              <img src={t.coverUrl} alt="" className="w-11 h-11 rounded object-cover shrink-0 bg-black/40" />
              <div className="flex-1 min-w-0">
                <div className="text-[14px] font-semibold text-white truncate">{t.title}</div>
                <div className="text-[12px] text-white/50 truncate mt-0.5">{t.artist}</div>
              </div>
              <div className="text-[12.5px] text-white/50 tabular-nums">
                {t.durationMs ? formatDuration(t.durationMs) : ""}
              </div>
              <button
                title="Play"
                className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center shadow opacity-0 group-hover:opacity-100 transition-opacity shrink-0"
              >
                <Play className="w-4 h-4 fill-black ml-0.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="p-12 text-center text-white/45 text-[14px]">
          Type in the top bar to search millions of tracks, albums, and artists on YouTube Music.
        </div>
      )}
    </div>
  );
};
