import React from "react";
import { Heart, Play, Shuffle, MoreHorizontal } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { Track } from "../types";

export const LikedView: React.FC = () => {
  const { likedSongs, playTrack, currentTrack, toggleLike, isLiked } = useDynamusic();

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const handlePlayAll = (shuffle: boolean = false) => {
    if (!likedSongs.length) return;
    const tracksToPlay = shuffle
      ? [...likedSongs].sort(() => Math.random() - 0.5)
      : likedSongs;
    playTrack(tracksToPlay[0]!, tracksToPlay);
  };

  return (
    <div className="pb-16 select-none">
      {/* Hero Banner */}
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-[#450af5]/40 to-transparent">
        <div className="w-48 h-48 rounded-xl bg-gradient-to-br from-[#450af5] to-[#8e8ee5] flex items-center justify-center shrink-0 shadow-2xl">
          <Heart className="w-20 h-20 text-white fill-white" />
        </div>
        <div className="space-y-2">
          <div className="text-[12px] font-bold text-white/70 uppercase tracking-wider">
            Playlist
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            Liked Songs
          </h1>
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white/80">
            <span className="font-bold text-white">Imported from Spotify</span>
            <span>•</span>
            <span>{likedSongs.length} tracks</span>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-4 mb-6">
        <button
          onClick={() => handlePlayAll(false)}
          title="Play Liked Songs"
          className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-xl transition-all"
        >
          <Play className="w-5 h-5 fill-black ml-0.5" />
        </button>

        <button
          onClick={() => handlePlayAll(true)}
          title="Shuffle Liked Songs"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white flex items-center justify-center transition-colors"
        >
          <Shuffle className="w-5 h-5" />
        </button>
      </div>

      {/* Track List */}
      <div className="space-y-1">
        {likedSongs.map((track: Track, idx: number) => {
          const isCurrent = currentTrack?.id === track.id;
          const liked = isLiked(track.id);

          return (
            <div
              key={track.id}
              role="button"
              tabIndex={0}
              onClick={() => playTrack(track, likedSongs)}
              className={`group flex items-center gap-4 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                isCurrent ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
              }`}
            >
              {/* Index / Play */}
              <div className="w-6 text-center text-[13.5px] font-semibold text-white/50 shrink-0">
                <span className="group-hover:hidden">{idx + 1}</span>
                <Play className="w-4 h-4 text-white fill-white hidden group-hover:inline ml-1" />
              </div>

              {/* Cover */}
              <img
                src={track.coverUrl}
                alt={track.title}
                className="w-10 h-10 rounded object-cover shrink-0 bg-black/40"
              />

              {/* Title & Artist */}
              <div className="flex-1 min-w-0">
                <div
                  className={`text-[14px] font-semibold truncate ${
                    isCurrent ? "text-green-400" : "text-white"
                  }`}
                >
                  {track.title}
                </div>
                <div className="text-[12px] text-white/55 truncate mt-0.5">
                  {track.artist}
                </div>
              </div>

              {/* Album */}
              <div className="w-1/3 text-[13px] text-white/60 truncate hidden md:block">
                {track.album || "Single"}
              </div>

              {/* Heart */}
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleLike(track.id);
                }}
                className={`p-1.5 rounded-full transition-colors ${
                  liked ? "text-green-400" : "text-white/40 hover:text-white"
                }`}
                title="Like"
              >
                <Heart className={`w-4 h-4 ${liked ? "fill-current" : ""}`} />
              </button>

              {/* Duration */}
              <div className="w-12 text-right text-[12.5px] text-white/50 tabular-nums">
                {formatDuration(track.durationMs)}
              </div>

              {/* More options */}
              <button
                type="button"
                onClick={(e) => e.stopPropagation()}
                className="p-1 rounded text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <MoreHorizontal className="w-4 h-4" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
};

