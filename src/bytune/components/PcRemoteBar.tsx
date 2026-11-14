import { useState } from "react";
import { Monitor, Play, Pause, SkipForward, SkipBack, Volume2, Shuffle, Repeat, Heart } from "lucide-react";
import { useMobileMode } from "../stores/mobileMode";
import { useLibrary } from "../stores/library";
import { fmtTime } from "../lib/format";

export function PcRemoteBar() {
  const pcState = useMobileMode((s) => s.pcState);
  const sendCommand = useMobileMode((s) => s.sendPcCommand);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const isLiked = useLibrary((s) => (pcState?.track ? s.isLiked(pcState.track.id) : false));

  const track = pcState?.track;
  const isPlaying = Boolean(pcState?.playing);
  const position = pcState?.position ?? 0;
  const duration = pcState?.duration ?? (track?.duration ?? 0);
  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div className="fixed bottom-16 inset-x-0 z-40 bg-[#121214]/95 backdrop-blur-2xl border-t border-emerald-500/30 px-3 py-2 flex flex-col gap-1.5 shadow-2xl">
      {/* Indicator Tag */}
      <div className="flex items-center justify-between text-[11px] text-emerald-400 font-medium px-1">
        <span className="flex items-center gap-1.5">
          <Monitor className="w-3.5 h-3.5 animate-pulse text-emerald-400" />
          <span>Controlling PC Dynamusic</span>
        </span>
        <span className="text-white/40 text-[10px]">
          {fmtTime(position)} / {fmtTime(duration)}
        </span>
      </div>

      {/* Track & Controls */}
      <div className="flex items-center gap-3">
        {/* Cover */}
        <div className="relative w-12 h-12 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
          {track?.thumb ? (
            <img src={track.thumb} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-[10px]">No Track</div>
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0 pr-1">
          <p className="text-[13px] font-semibold text-white truncate leading-tight">
            {track?.title || "No song playing on PC"}
          </p>
          <p className="text-[11px] text-white/50 truncate leading-tight mt-0.5">
            {track?.artist || "Use PC Mode to change PC songs"}
          </p>
        </div>

        {/* Favorite */}
        {track && (
          <button
            type="button"
            onClick={() => toggleLike(track)}
            className="p-1.5 text-white/60 hover:text-white"
            title="Like on PC & Mobile"
          >
            <Heart className={`w-4 h-4 ${isLiked ? "fill-white text-white" : ""}`} />
          </button>
        )}

        {/* Controls */}
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => sendCommand("prev")}
            className="p-2 text-white/70 hover:text-white transition-transform active:scale-90"
            title="Previous track on PC"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={() => sendCommand(isPlaying ? "pause" : "play")}
            className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 transition-transform"
            title={isPlaying ? "Pause PC" : "Play PC"}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => sendCommand("next")}
            className="p-2 text-white/70 hover:text-white transition-transform active:scale-90"
            title="Next track on PC"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {/* Progress Bar with seek */}
      <div
        className="w-full h-1 bg-white/10 rounded-full overflow-hidden cursor-pointer"
        onClick={(e) => {
          if (!duration) return;
          const rect = e.currentTarget.getBoundingClientRect();
          const clickX = e.clientX - rect.left;
          const targetSec = (clickX / rect.width) * duration;
          sendCommand("seek", targetSec);
        }}
      >
        <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

