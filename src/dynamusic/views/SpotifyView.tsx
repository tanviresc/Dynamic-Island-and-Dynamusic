import React from "react";
import { Play, Shuffle, ExternalLink } from "lucide-react";
import { SpotifyIcon, SPOTIFY_GREEN } from "../components/SpotifyIcon";
import { useDynamusic } from "../useDynamusicStore";
import { SPOTIFY_PLAYLISTS } from "../initialData";

export const SpotifyView: React.FC = () => {
  const { playTrack } = useDynamusic();

  const allTracks = SPOTIFY_PLAYLISTS.flatMap((p) => p.tracks);

  const handlePlayAll = (shuffle: boolean = false) => {
    if (!allTracks.length) return;
    const tracksToPlay = shuffle
      ? [...allTracks].sort(() => Math.random() - 0.5)
      : allTracks;
    playTrack(tracksToPlay[0]!, tracksToPlay);
  };

  return (
    <div className="pb-16 select-none">
      {/* Hero Banner */}
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-[#1ed760]/30 to-transparent">
        <div className="w-48 h-48 rounded-xl bg-[#0f291e] border border-[#1ed760]/30 flex items-center justify-center shrink-0 shadow-2xl">
          <SpotifyIcon className="w-24 h-24" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px] font-bold text-[#1ed760] uppercase tracking-wider">
            <span>Connected Account</span>
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            Spotify Playlists
          </h1>
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white/80">
            <span>Connected</span>
            <span>•</span>
            <span>{SPOTIFY_PLAYLISTS.length} playlists</span>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => handlePlayAll(false)}
          title="Play All Spotify"
          className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-xl transition-all"
        >
          <Play className="w-5 h-5 fill-black ml-0.5" />
        </button>

        <button
          onClick={() => handlePlayAll(true)}
          title="Shuffle Spotify"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white flex items-center justify-center transition-colors"
        >
          <Shuffle className="w-5 h-5" />
        </button>
      </div>

      {/* Playlists Grid */}
      <div className="grid grid-cols-4 gap-4">
        {SPOTIFY_PLAYLISTS.map((pl) => (
          <div
            key={pl.id}
            role="button"
            tabIndex={0}
            onClick={() => {
              if (pl.tracks[0]) {
                playTrack(pl.tracks[0], pl.tracks);
              }
            }}
            className="group p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04] cursor-pointer transition-all flex flex-col"
          >
            <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-black/40">
              <img
                src={pl.thumb}
                alt={pl.title}
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
              {pl.title}
            </div>
            <div className="text-[12px] text-white/50 truncate mt-0.5">
              {pl.subtitle}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
