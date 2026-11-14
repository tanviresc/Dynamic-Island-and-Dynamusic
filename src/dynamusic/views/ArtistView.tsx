import React, { useState } from "react";
import { BadgeCheck, Play, Shuffle, Heart, MoreHorizontal, UserCheck, UserPlus } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { TEMPER_CITY_ARTIST, EYE_ARTWORK } from "../initialData";
import { Track } from "../types";

export const ArtistView: React.FC<{ artistId?: string }> = ({ artistId }) => {
  const { navView, artists, playTrack, currentTrack, toggleLike, isLiked } = useDynamusic();
  const [isFollowing, setIsFollowing] = useState<boolean>(true);

  const targetId =
    artistId || (navView.name === "artist" && "artistId" in navView ? navView.artistId : "temper-city");
  const artist = artists[targetId] || TEMPER_CITY_ARTIST;

  const formatDuration = (ms: number) => {
    const totalSecs = Math.floor(ms / 1000);
    const mins = Math.floor(totalSecs / 60);
    const secs = totalSecs % 60;
    return `${mins}:${secs < 10 ? "0" : ""}${secs}`;
  };

  const handlePlayAll = (shuffle: boolean = false) => {
    if (!artist.topTracks.length) return;
    const tracksToPlay = shuffle
      ? [...artist.topTracks].sort(() => Math.random() - 0.5)
      : artist.topTracks;
    playTrack(tracksToPlay[0]!, tracksToPlay);
  };

  return (
    <div className="pb-16 select-none">
      {/* Hero Banner */}
      <div className="relative -mx-10 -mt-5 h-[280px] bg-black/60 overflow-hidden mb-6 flex flex-col justify-end p-8">
        <img
          src={artist.banner || artist.thumb}
          alt={artist.name}
          className="absolute inset-0 w-full h-full object-cover object-top opacity-55 filter brightness-90"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#121214] via-[#121214]/60 to-transparent" />

        <div className="relative z-10 space-y-2">
          <div className="flex items-center gap-2">
            <BadgeCheck className="w-5 h-5 text-[#38bdf8] fill-[#38bdf8]" stroke="#0a0a0a" />
            <span className="text-[13px] font-bold text-white/90 uppercase tracking-wider">
              Verified Artist
            </span>
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            {artist.name}
          </h1>
          <p className="text-[14px] font-medium text-white/80">
            {artist.monthlyListeners}
          </p>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => handlePlayAll(false)}
          title="Play"
          className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-xl transition-all"
        >
          <Play className="w-5 h-5 fill-black ml-0.5" />
        </button>

        <button
          onClick={() => handlePlayAll(true)}
          title="Shuffle"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white flex items-center justify-center transition-colors"
        >
          <Shuffle className="w-5 h-5" />
        </button>

        <button
          onClick={() => setIsFollowing((v) => !v)}
          className={`px-4 py-1.5 rounded-full text-[13px] font-bold border transition-colors flex items-center gap-1.5 ${
            isFollowing
              ? "border-white/30 text-white hover:border-white/60 bg-white/[0.04]"
              : "border-transparent bg-white text-black hover:bg-white/90"
          }`}
        >
          {isFollowing ? (
            <>
              <UserCheck className="w-4 h-4" />
              Following
            </>
          ) : (
            <>
              <UserPlus className="w-4 h-4" />
              Follow
            </>
          )}
        </button>
      </div>

      {/* Top Songs / All songs inside artist profile */}
      <section className="mb-10">
        <h2 className="text-[20px] font-extrabold text-white tracking-tight mb-4">
          Popular
        </h2>

        <div className="space-y-1">
          {artist.topTracks.map((song: Track, idx: number) => {
            const isCurrent = currentTrack?.id === song.id;
            const liked = isLiked(song.id);

            return (
              <div
                key={song.id}
                role="button"
                tabIndex={0}
                onClick={() => playTrack(song, artist.topTracks)}
                className={`group flex items-center gap-4 px-3 py-2.5 rounded-lg cursor-pointer transition-colors ${
                  isCurrent ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
                }`}
              >
                {/* Index / Play button */}
                <div className="w-6 text-center text-[14px] font-semibold text-white/50 shrink-0">
                  <span className="group-hover:hidden">{idx + 1}</span>
                  <Play className="w-4 h-4 text-white fill-white hidden group-hover:inline ml-1" />
                </div>

                {/* Thumbnail */}
                <img
                  src={song.coverUrl || EYE_ARTWORK}
                  alt={song.title}
                  className="w-11 h-11 rounded-md object-cover shrink-0 bg-black/40"
                />

                {/* Title & Explicit */}
                <div className="flex-1 min-w-0">
                  <div
                    className={`text-[14.5px] font-semibold truncate ${
                      isCurrent ? "text-green-400" : "text-white group-hover:text-white"
                    }`}
                  >
                    {song.title}
                  </div>
                  <div className="text-[12.5px] text-white/50 truncate mt-0.5">
                    {song.album || artist.name}
                  </div>
                </div>

                {/* Heart Button */}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleLike(song.id);
                  }}
                  className={`p-1.5 rounded-full transition-colors ${
                    liked
                      ? "text-green-400"
                      : "text-white/40 hover:text-white opacity-0 group-hover:opacity-100"
                  }`}
                  title={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
                >
                  <Heart
                    className={`w-4 h-4 ${liked ? "fill-current" : ""}`}
                  />
                </button>

                {/* Duration */}
                <div className="w-12 text-right text-[12.5px] text-white/50 tabular-nums">
                  {formatDuration(song.durationMs)}
                </div>

                {/* Options button */}
                <button
                  type="button"
                  onClick={(e) => e.stopPropagation()}
                  className="p-1 rounded text-white/40 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity"
                  title="More options"
                >
                  <MoreHorizontal className="w-4 h-4" />
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* Discography: Albums, Singles & EPs */}
      {artist.albums && artist.albums.length > 0 && (
        <section className="mb-10">
          <h2 className="text-[20px] font-extrabold text-white tracking-tight mb-4">
            Discography
          </h2>
          <div className="grid grid-cols-4 gap-4">
            {artist.albums.map((alb) => (
              <div
                key={alb.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (artist.topTracks[0]) {
                    playTrack(artist.topTracks[0], artist.topTracks);
                  }
                }}
                className="group p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04] cursor-pointer transition-all flex flex-col"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-black/40">
                  <img
                    src={alb.thumb}
                    alt={alb.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <button
                    title="Play"
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-white text-black shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  </button>
                </div>
                <div className="text-[13.5px] font-bold text-white truncate">
                  {alb.title}
                </div>
                <div className="text-[12px] text-white/50 truncate mt-0.5">
                  {alb.year} • {alb.type}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* About Section */}
      <section>
        <h2 className="text-[20px] font-extrabold text-white tracking-tight mb-4">
          About
        </h2>
        <div className="p-6 rounded-2xl bg-white/[0.04] border border-white/[0.06] flex items-start gap-6">
          <img
            src={artist.thumb}
            alt={artist.name}
            className="w-32 h-32 rounded-xl object-cover shrink-0 shadow-lg"
          />
          <div className="space-y-3">
            <div className="text-[16px] font-bold text-white">
              {artist.monthlyListeners}
            </div>
            <p className="text-[13.5px] leading-relaxed text-white/75">
              {artist.bio}
            </p>
          </div>
        </div>
      </section>
    </div>
  );
};
