import React, { useState } from "react";
import { BadgeCheck, X, Play } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { TEMPER_CITY_ARTIST, EYE_ARTWORK } from "../initialData";

export const RightRail: React.FC = () => {
  const {
    currentTrack,
    rightPanel,
    setRightPanel,
    queue,
    currentIndex,
    playTrack,
    isPlaying,
    navigate,
    artists,
  } = useDynamusic();

  const [queueTab, setQueueTab] = useState<"queue" | "recent">("queue");

  const track = currentTrack || TEMPER_CITY_ARTIST.topTracks[0]!;
  const artistId = track.artistId || "temper-city";
  const artist = artists[artistId] || TEMPER_CITY_ARTIST;

  const handleOpenArtist = () => {
    navigate({ name: "artist", artistId: artist.id });
  };

  return (
    <aside className="w-[316px] shrink-0 flex flex-col bg-[#121214] rounded-2xl overflow-hidden border border-white/[0.04] select-none p-3">
      {rightPanel === "queue" ? (
        /* Queue View */
        <div className="flex-1 flex flex-col min-h-0">
          <div className="flex items-center justify-between pb-3 border-b border-white/[0.08]">
            <div className="flex items-center gap-4">
              <button
                onClick={() => setQueueTab("queue")}
                className={`text-[14px] font-bold pb-1 transition-colors relative ${
                  queueTab === "queue" ? "text-white" : "text-white/50 hover:text-white"
                }`}
              >
                Queue
                {queueTab === "queue" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                )}
              </button>
              <button
                onClick={() => setQueueTab("recent")}
                className={`text-[14px] font-bold pb-1 transition-colors relative ${
                  queueTab === "recent" ? "text-white" : "text-white/50 hover:text-white"
                }`}
              >
                Recently played
                {queueTab === "recent" && (
                  <span className="absolute bottom-0 left-0 right-0 h-0.5 bg-white rounded-full" />
                )}
              </button>
            </div>
            <button
              onClick={() => setRightPanel("details")}
              className="w-7 h-7 rounded-full flex items-center justify-center text-white/50 hover:text-white hover:bg-white/10 transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto pt-3 space-y-1 custom-scroll">
            <div className="text-[12px] font-semibold text-white/50 uppercase tracking-wider mb-2">
              Now playing
            </div>
            <div className="flex items-center gap-3 p-2 rounded-lg bg-white/[0.08]">
              <img
                src={track.coverUrl || EYE_ARTWORK}
                alt=""
                className="w-10 h-10 rounded-md object-cover shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div className="text-[13.5px] font-semibold text-white truncate flex items-center gap-2">
                  <span>{track.title}</span>
                  {isPlaying && (
                    <span className="flex items-end gap-0.5 h-3">
                      <span className="w-0.5 h-2.5 bg-green-400 animate-pulse" />
                      <span className="w-0.5 h-3 bg-green-400 animate-pulse delay-75" />
                      <span className="w-0.5 h-1.5 bg-green-400 animate-pulse delay-150" />
                    </span>
                  )}
                </div>
                <div className="text-[12px] text-white/55 truncate">{track.artist}</div>
              </div>
            </div>

            <div className="text-[12px] font-semibold text-white/50 uppercase tracking-wider mt-4 mb-2">
              Next in queue
            </div>
            {queue.slice(currentIndex + 1).map((t, i) => (
              <div
                key={`${t.id}-${i}`}
                role="button"
                tabIndex={0}
                onClick={() => playTrack(t)}
                className="group flex items-center gap-3 p-2 rounded-lg hover:bg-white/[0.06] cursor-pointer transition-colors"
              >
                <img
                  src={t.coverUrl || EYE_ARTWORK}
                  alt=""
                  className="w-9 h-9 rounded-md object-cover shrink-0"
                />
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium text-white truncate group-hover:text-white transition-colors">
                    {t.title}
                  </div>
                  <div className="text-[11.5px] text-white/50 truncate">{t.artist}</div>
                </div>
                <button
                  title="Play"
                  className="w-7 h-7 rounded-full bg-white text-black items-center justify-center hidden group-hover:flex shadow transition-all shrink-0"
                >
                  <Play className="w-3.5 h-3.5 fill-black ml-0.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* Details View (Matching ByTune Screenshot) */
        <div className="flex-1 flex flex-col min-h-0 overflow-y-auto space-y-4 custom-scroll">
          {/* Full-width square artwork */}
          <div>
            <div className="w-full aspect-square rounded-xl overflow-hidden shadow-2xl bg-black/40 border border-white/[0.06]">
              <img
                src={track.coverUrl || EYE_ARTWORK}
                alt={track.title}
                className="w-full h-full object-cover"
              />
            </div>
            <div className="mt-3 px-0.5">
              <h2 className="text-[23px] font-black tracking-tight text-white leading-tight truncate">
                {track.title}
              </h2>
              <div className="text-[14px] font-medium text-white/65 mt-0.5 truncate">
                {track.artist}
              </div>
            </div>
          </div>

          {/* About the artist Card */}
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] overflow-hidden flex flex-col">
            {/* Header image banner with label */}
            <div className="relative aspect-[16/10] bg-black/40 overflow-hidden">
              <img
                src={artist.banner || artist.thumb}
                alt={artist.name}
                className="w-full h-full object-cover object-top"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />
              <div className="absolute top-2.5 left-3 text-[14px] font-bold text-white tracking-tight">
                About the artist
              </div>
            </div>

            {/* Artist Info & View profile button */}
            <div className="p-3.5 flex flex-col">
              <div className="flex items-center gap-1.5">
                <span className="text-[15px] font-bold text-white truncate">{artist.name}</span>
                <BadgeCheck className="w-[18px] h-[18px] text-[#38bdf8] fill-[#38bdf8] shrink-0" stroke="#0a0a0a" />
              </div>

              <div className="flex items-center justify-between gap-2 mt-2">
                <span className="text-[12.5px] font-medium text-white/70">
                  {artist.monthlyListeners}
                </span>
                <button
                  onClick={handleOpenArtist}
                  className="h-[30px] px-3.5 rounded-full border border-white/30 text-[12.5px] font-bold text-white hover:border-white/60 hover:bg-white/10 active:scale-95 transition-all shrink-0"
                >
                  View profile
                </button>
              </div>

              {/* Bio snippet */}
              <p className="mt-2.5 text-[12.5px] leading-relaxed text-white/70 line-clamp-3">
                {artist.bio}
              </p>
            </div>
          </div>
        </div>
      )}
    </aside>
  );
};

