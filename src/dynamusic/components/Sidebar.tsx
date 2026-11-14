import React from "react";
import {
  Heart,
  BarChart2,
  ArrowDownToLine,
  Plus,
  Pin,
  Library,
  Music2,
} from "lucide-react";
import { SpotifyIcon } from "./SpotifyIcon";
import { useDynamusic } from "../useDynamusicStore";
import { EYE_ARTWORK } from "../initialData";

export const Sidebar: React.FC = () => {
  const { navView, navigate, likedSongs } = useDynamusic();

  const isCurrent = (name: string, param?: string) => {
    if (navView.name !== name) return false;
    if (name === "artist" && "artistId" in navView) return navView.artistId === param;
    if (name === "folder" && "folderId" in navView) return navView.folderId === param;
    return true;
  };

  return (
    <aside className="w-[280px] shrink-0 flex flex-col bg-[#121214] rounded-2xl overflow-hidden border border-white/[0.04] select-none p-2">
      {/* Header: Your Library + Add button */}
      <div className="flex items-center justify-between px-3 py-2.5 mb-1">
        <div className="flex items-center gap-2 text-white/90">
          <Library className="w-5 h-5 text-white/70" />
          <span className="text-[14.5px] font-bold tracking-tight">Your Library</span>
        </div>
        <button
          onClick={() => navigate({ name: "folder", folderId: "folder-1" })}
          title="Create playlist or folder"
          className="w-7 h-7 rounded-full flex items-center justify-center text-white/60 hover:text-white hover:bg-white/10 transition-colors"
        >
          <Plus className="w-4 h-4" />
        </button>
      </div>

      {/* Library rows */}
      <div className="flex-1 min-h-0 overflow-y-auto space-y-0.5 pr-1 custom-scroll">
        {/* Liked Songs (Pinned) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "liked" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("liked") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-md bg-gradient-to-br from-[#450af5] to-[#8e8ee5] flex items-center justify-center shrink-0 shadow-md">
              <Heart className="w-5 h-5 text-white fill-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Liked Songs</div>
              <div className="text-[12px] text-white/55 truncate">Playlist • {likedSongs.length} tracks</div>
            </div>
          </div>
          <Pin className="w-3.5 h-3.5 text-white/40 shrink-0 fill-white/40 rotate-45" />
        </div>

        {/* Spotify (Pinned) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "spotify" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("spotify") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-md bg-[#0e1d13] border border-[#1ed760]/30 flex items-center justify-center shrink-0">
              <SpotifyIcon className="w-6 h-6" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Spotify</div>
              <div className="text-[12px] text-white/55 truncate">Connected • 4 playlists</div>
            </div>
          </div>
          <Pin className="w-3.5 h-3.5 text-white/40 shrink-0 fill-white/40 rotate-45" />
        </div>

        {/* Replay (Pinned) */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "replay" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("replay") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-md bg-gradient-to-br from-[#db2777] to-[#f43f5e] flex items-center justify-center shrink-0">
              <BarChart2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Replay</div>
              <div className="text-[12px] text-white/55 truncate">Your listening stats</div>
            </div>
          </div>
          <Pin className="w-3.5 h-3.5 text-white/40 shrink-0 fill-white/40 rotate-45" />
        </div>

        {/* Local Music */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "local" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("local") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-md bg-[#d97706]/90 flex items-center justify-center shrink-0">
              <Music2 className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Local Music</div>
              <div className="text-[12px] text-white/55 truncate">On this device</div>
            </div>
          </div>
        </div>

        {/* folder */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "folder", folderId: "folder-1" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("folder", "folder-1") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img src={EYE_ARTWORK} alt="" className="w-11 h-11 rounded-md object-cover shrink-0" />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">folder</div>
              <div className="text-[12px] text-white/55 truncate">Folder • 2 playlists</div>
            </div>
          </div>
        </div>

        {/* Calvin Harris */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "artist", artistId: "calvin-harris" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("artist", "calvin-harris") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="https://images.unsplash.com/photo-1534528741775-53994a69daeb?w=400&auto=format&fit=crop&q=80"
              alt="Calvin Harris"
              className="w-11 h-11 rounded-full object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Calvin Harris</div>
              <div className="text-[12px] text-white/55 truncate">Artist</div>
            </div>
          </div>
        </div>

        {/* Downloads */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "downloads" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("downloads") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-11 h-11 rounded-md bg-[#2563eb] flex items-center justify-center shrink-0">
              <ArrowDownToLine className="w-5 h-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Downloads</div>
              <div className="text-[12px] text-white/55 truncate">Playlist • 0 tracks</div>
            </div>
          </div>
        </div>

        {/* Arctic Monkeys */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "artist", artistId: "arctic-monkeys" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("artist", "arctic-monkeys") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?w=400&auto=format&fit=crop&q=80"
              alt="Arctic Monkeys"
              className="w-11 h-11 rounded-full object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Arctic Monkeys</div>
              <div className="text-[12px] text-white/55 truncate">Artist</div>
            </div>
          </div>
        </div>

        {/* Ariana Grande */}
        <div
          role="button"
          tabIndex={0}
          onClick={() => navigate({ name: "artist", artistId: "ariana-grande" })}
          className={`flex items-center justify-between px-2 py-2 rounded-lg cursor-pointer transition-colors ${
            isCurrent("artist", "ariana-grande") ? "bg-white/[0.12]" : "hover:bg-white/[0.06]"
          }`}
        >
          <div className="flex items-center gap-3 min-w-0">
            <img
              src="https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop&q=80"
              alt="Ariana Grande"
              className="w-11 h-11 rounded-full object-cover shrink-0"
            />
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-white truncate">Ariana Grande</div>
              <div className="text-[12px] text-white/55 truncate">Artist</div>
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};
