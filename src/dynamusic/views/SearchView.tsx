import React, { useEffect } from "react";
import { Search, Play, Loader2, Heart, Sparkles } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { GLOBAL_POPULAR_TRACKS } from "../musicService";
import { Track } from "../types";

export const SearchView: React.FC = () => {
  const {
    searchQuery,
    isSearching,
    searchResults,
    playTrack,
    currentTrack,
    performSearch,
    setSearchQuery,
    navigate,
    toggleLike,
    isLiked,
    artists,
  } = useDynamusic();

  const genreChips = [
    "Pop",
    "Rock",
    "Indie",
    "Alternative",
    "Synthwave",
    "80s Classics",
    "Dance",
    "Bollywood",
    "Lofi Beats",
    "Hip-Hop",
  ];

  // If search query is already set but no results loaded yet, run search
  useEffect(() => {
    if (searchQuery && searchResults.length === 0 && !isSearching) {
      performSearch(searchQuery);
    }
  }, [searchQuery]);

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const handleChipClick = (genre: string) => {
    setSearchQuery(genre);
    performSearch(genre);
  };

  const featuredArtists = Object.values(artists);

  return (
    <div className="pb-16 select-none">
      {/* Search Header */}
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <Search className="w-6 h-6 text-white/50" />
          <h1 className="text-[28px] font-black tracking-tight text-white">
            {searchQuery ? `Results for “${searchQuery}”` : "Explore & Search"}
          </h1>
        </div>
        {searchQuery && searchResults.length > 0 && (
          <span className="text-[12.5px] font-semibold text-white/50">
            {searchResults.length} tracks found
          </span>
        )}
      </div>

      {/* Quick Genre Chips */}
      <div className="flex items-center gap-2 overflow-x-auto pb-4 mb-6 custom-scroll">
        {genreChips.map((genre) => (
          <button
            key={genre}
            onClick={() => handleChipClick(genre)}
            className="px-4 py-2 rounded-full bg-white/[0.06] hover:bg-white/[0.12] text-[13px] font-semibold text-white/85 hover:text-white transition-colors shrink-0 border border-white/[0.04]"
          >
            {genre}
          </button>
        ))}
      </div>

      {isSearching ? (
        <div className="p-16 flex flex-col items-center justify-center gap-3 text-white/50">
          <Loader2 className="w-8 h-8 animate-spin text-white/70" />
          <div className="text-[14px]">Searching millions of songs...</div>
        </div>
      ) : searchQuery ? (
        /* Search Results List */
        <div className="space-y-1">
          {searchResults.length > 0 ? (
            searchResults.map((t: Track, idx: number) => {
              const isCurrent = currentTrack?.id === t.id;
              const liked = isLiked(t.id);

              return (
                <div
                  key={`${t.id}-${idx}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(t, searchResults)}
                  className={`group flex items-center gap-4 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                    isCurrent ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
                  }`}
                >
                  <span className="w-6 text-center text-white/50 text-[13px] shrink-0">
                    <span className="group-hover:hidden">{idx + 1}</span>
                    <Play className="w-4 h-4 text-white fill-white hidden group-hover:inline ml-1" />
                  </span>

                  <img
                    src={t.coverUrl}
                    alt=""
                    className="w-11 h-11 rounded-md object-cover shrink-0 bg-black/40"
                  />

                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-[14px] font-semibold truncate ${
                        isCurrent ? "text-green-400" : "text-white"
                      }`}
                    >
                      {t.title}
                    </div>
                    <div className="text-[12px] text-white/50 truncate mt-0.5">
                      {t.artist}
                    </div>
                  </div>

                  <div className="w-1/3 text-[13px] text-white/60 truncate hidden md:block">
                    {t.album || "Single"}
                  </div>

                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleLike(t.id);
                    }}
                    className={`p-1.5 rounded-full transition-colors ${
                      liked ? "text-green-400" : "text-white/40 hover:text-white"
                    }`}
                    title={liked ? "Liked" : "Like"}
                  >
                    <Heart className={`w-4 h-4 ${liked ? "fill-current" : ""}`} />
                  </button>

                  <div className="w-12 text-right text-[12.5px] text-white/50 tabular-nums">
                    {t.durationMs ? formatDuration(t.durationMs) : ""}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="p-12 text-center text-white/45 text-[14px]">
              No direct matches found for “{searchQuery}”. Try searching for an artist name or title.
            </div>
          )}
        </div>
      ) : (
        /* Default Explore Feed when search bar is idle */
        <div className="space-y-8">
          {/* Trending Songs */}
          <section>
            <div className="flex items-center gap-2 mb-3.5">
              <Sparkles className="w-5 h-5 text-amber-400" />
              <h2 className="text-[20px] font-extrabold text-white tracking-tight">
                Trending & Popular Tracks
              </h2>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              {GLOBAL_POPULAR_TRACKS.slice(0, 10).map((t) => (
                <div
                  key={t.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(t, GLOBAL_POPULAR_TRACKS)}
                  className="group flex items-center h-16 rounded-lg bg-white/[0.04] hover:bg-white/[0.1] transition-all cursor-pointer overflow-hidden border border-white/[0.03] pr-3"
                >
                  <img src={t.coverUrl} alt="" className="w-16 h-16 object-cover shrink-0" />
                  <div className="flex-1 min-w-0 px-3 py-1">
                    <div className="text-[13.5px] font-semibold text-white truncate">
                      {t.title}
                    </div>
                    <div className="text-[12px] text-white/50 truncate mt-0.5">
                      {t.artist}
                    </div>
                  </div>
                  <button
                    title="Play"
                    className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center opacity-0 group-hover:opacity-100 shadow transition-opacity shrink-0"
                  >
                    <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                  </button>
                </div>
              ))}
            </div>
          </section>

          {/* Featured Artists */}
          <section>
            <h2 className="text-[20px] font-extrabold text-white tracking-tight mb-3.5">
              Featured Artists
            </h2>
            <div className="grid grid-cols-4 gap-4">
              {featuredArtists.map((artist) => (
                <div
                  key={artist.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => navigate({ name: "artist", artistId: artist.id })}
                  className="group p-4 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04] cursor-pointer transition-all flex flex-col items-center text-center"
                >
                  <img
                    src={artist.thumb}
                    alt={artist.name}
                    className="w-24 h-24 rounded-full object-cover mb-3 shadow-lg group-hover:scale-105 transition-transform"
                  />
                  <div className="text-[14px] font-bold text-white truncate w-full">
                    {artist.name}
                  </div>
                  <div className="text-[12px] text-white/50 mt-0.5">
                    {artist.monthlyListeners}
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
};
