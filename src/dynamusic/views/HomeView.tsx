import React from "react";
import { Play } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { JUMP_BACK_IN_TRACKS, PLAYLISTS_FOR_YOU } from "../initialData";
import { Track } from "../types";

export const HomeView: React.FC = () => {
  const { playTrack, currentTrack, isPlaying } = useDynamusic();

  const mixes = [
    {
      id: "mix-1",
      title: "Chill Mix",
      subtitle: "Temper City, M83, and The Weeknd",
      thumb: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=300&auto=format&fit=crop&q=80",
      color: "from-blue-600/40 to-indigo-900/40",
    },
    {
      id: "mix-2",
      title: "Alternative Rock Mix",
      subtitle: "Arctic Monkeys, Temper City, and Radiohead",
      thumb: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80",
      color: "from-amber-600/40 to-red-900/40",
    },
    {
      id: "mix-3",
      title: "Pop & Dance Mix",
      subtitle: "Calvin Harris, Ariana Grande, and Dua Lipa",
      thumb: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=300&auto=format&fit=crop&q=80",
      color: "from-pink-600/40 to-purple-900/40",
    },
    {
      id: "mix-4",
      title: "Retro 80s Grooves",
      subtitle: "Michael Jackson, Earth Wind & Fire, and ABBA",
      thumb: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=300&auto=format&fit=crop&q=80",
      color: "from-emerald-600/40 to-teal-900/40",
    },
  ];

  return (
    <div className="relative pb-10">
      {/* Top ambient red/burgundy atmospheric cover glow (matching screenshot) */}
      <div
        aria-hidden
        className="pointer-events-none absolute -top-10 -left-10 -right-10 h-[360px] opacity-45 blur-3xl z-0"
        style={{
          background:
            "radial-gradient(ellipse at 35% 0%, rgba(185, 28, 28, 0.65) 0%, rgba(127, 29, 29, 0.35) 45%, transparent 75%)",
        }}
      />

      <div className="relative z-10 space-y-8">
        {/* Section 1: Jump back in */}
        <section>
          <h2 className="text-[22px] font-extrabold text-white tracking-tight mb-3.5">
            Jump back in
          </h2>
          <div className="grid grid-cols-2 gap-2.5">
            {JUMP_BACK_IN_TRACKS.map((track: Track) => {
              const isSelected = currentTrack?.id === track.id;
              return (
                <div
                  key={track.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => playTrack(track, JUMP_BACK_IN_TRACKS)}
                  className={`group flex items-center h-16 rounded-lg bg-white/[0.05] hover:bg-white/[0.12] transition-all cursor-pointer overflow-hidden border border-white/[0.04] relative ${
                    isSelected ? "bg-white/[0.14] ring-1 ring-white/20" : ""
                  }`}
                >
                  <img
                    src={track.coverUrl}
                    alt={track.title}
                    className="w-16 h-16 object-cover shrink-0"
                  />
                  <div className="flex-1 min-w-0 px-3 py-1">
                    <div className="text-[13.5px] font-semibold text-white truncate group-hover:text-white transition-colors">
                      {track.title}
                    </div>
                    <div className="text-[12px] text-white/55 truncate mt-0.5">
                      {track.artist}
                    </div>
                  </div>
                  <div className="mr-3 shrink-0">
                    <button
                      title={`Play ${track.title}`}
                      className={`w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg transition-all ${
                        isSelected && isPlaying
                          ? "opacity-100 scale-100"
                          : "opacity-0 group-hover:opacity-100 group-hover:scale-100 scale-90"
                      }`}
                    >
                      <Play className="w-4 h-4 fill-black ml-0.5" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* Section 2: Playlists for you (with counter 40) */}
        <section>
          <div className="flex items-center gap-2 mb-3.5">
            <h2 className="text-[20px] font-extrabold text-white tracking-tight">
              Playlists for you
            </h2>
            <span className="text-[12px] font-bold text-white/45 px-1.5 py-0.5 rounded bg-white/[0.06]">
              40
            </span>
          </div>

          <div className="flex items-stretch gap-3 overflow-x-auto pb-3 custom-scroll">
            {PLAYLISTS_FOR_YOU.map((pl) => (
              <div
                key={pl.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (pl.tracks[0]) {
                    playTrack(pl.tracks[0], pl.tracks);
                  }
                }}
                className="group w-[150px] shrink-0 p-2 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.03] cursor-pointer transition-all flex flex-col"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-black/40">
                  <img
                    src={pl.thumb}
                    alt={pl.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <button
                    title="Play"
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-white text-black shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 group-hover:translate-y-0 translate-y-2 transition-all"
                  >
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  </button>
                </div>
                <div className="text-[13px] font-bold text-white truncate leading-snug">
                  {pl.title}
                </div>
                <div className="text-[11.5px] text-white/50 truncate mt-0.5">
                  {pl.subtitle}
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Section 3: Your mixes */}
        <section>
          <div className="mb-3">
            <h2 className="text-[20px] font-extrabold text-white tracking-tight">
              Your mixes
            </h2>
            <p className="text-[12.5px] text-white/55 mt-0.5">
              One for each side of your taste, with a few new songs in each
            </p>
          </div>

          <div className="grid grid-cols-4 gap-3">
            {mixes.map((mix) => (
              <div
                key={mix.id}
                role="button"
                tabIndex={0}
                onClick={() => {
                  if (JUMP_BACK_IN_TRACKS[0]) {
                    playTrack(JUMP_BACK_IN_TRACKS[0], JUMP_BACK_IN_TRACKS);
                  }
                }}
                className="group p-3 rounded-xl bg-white/[0.03] hover:bg-white/[0.08] border border-white/[0.04] cursor-pointer transition-all flex flex-col"
              >
                <div className="relative aspect-square rounded-lg overflow-hidden mb-2.5 bg-black/40">
                  <img
                    src={mix.thumb}
                    alt={mix.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  <div
                    className={`absolute inset-0 bg-gradient-to-t ${mix.color} opacity-60`}
                  />
                  <button
                    title="Play"
                    className="absolute bottom-2 right-2 w-9 h-9 rounded-full bg-white text-black shadow-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-all"
                  >
                    <Play className="w-4 h-4 fill-black ml-0.5" />
                  </button>
                </div>
                <div className="text-[13.5px] font-bold text-white truncate">
                  {mix.title}
                </div>
                <div className="text-[12px] text-white/50 line-clamp-2 mt-0.5 leading-snug">
                  {mix.subtitle}
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};

