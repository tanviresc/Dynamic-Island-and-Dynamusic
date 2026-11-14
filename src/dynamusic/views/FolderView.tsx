import React from "react";
import { Folder, Play, Shuffle } from "lucide-react";
import { useDynamusic } from "../useDynamusicStore";
import { EYE_ARTWORK } from "../initialData";

export const FolderView: React.FC<{ folderId?: string }> = ({ folderId }) => {
  const { folders, playTrack } = useDynamusic();

  const folder = folders.find((f) => f.id === folderId) || folders[0]!;
  const allTracks = folder.playlists.flatMap((p) => p.tracks);

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
      <div className="flex items-end gap-6 mb-8 p-6 -mx-10 -mt-5 bg-gradient-to-b from-white/[0.08] to-transparent">
        <div className="w-48 h-48 rounded-xl bg-black/40 border border-white/10 overflow-hidden shrink-0 shadow-2xl">
          <img src={folder.thumb || EYE_ARTWORK} alt="" className="w-full h-full object-cover" />
        </div>
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-[12px] font-bold text-white/70 uppercase tracking-wider">
            <Folder className="w-4 h-4 text-white/70" />
            <span>Folder</span>
          </div>
          <h1 className="text-[48px] font-black tracking-tight text-white leading-none">
            {folder.name}
          </h1>
          <div className="flex items-center gap-2 text-[13.5px] font-medium text-white/80">
            <span>{folder.playlists.length} playlists</span>
            <span>•</span>
            <span>{allTracks.length} tracks</span>
          </div>
        </div>
      </div>

      {/* Action Row */}
      <div className="flex items-center gap-4 mb-8">
        <button
          onClick={() => handlePlayAll(false)}
          title={`Play ${folder.name}`}
          className="w-12 h-12 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow-xl transition-all"
        >
          <Play className="w-5 h-5 fill-black ml-0.5" />
        </button>

        <button
          onClick={() => handlePlayAll(true)}
          title="Shuffle Folder"
          className="w-10 h-10 rounded-full bg-white/[0.08] hover:bg-white/[0.15] text-white flex items-center justify-center transition-colors"
        >
          <Shuffle className="w-5 h-5" />
        </button>
      </div>

      {/* Grid of Playlists in Folder */}
      <div className="grid grid-cols-4 gap-4">
        {folder.playlists.map((pl) => (
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

