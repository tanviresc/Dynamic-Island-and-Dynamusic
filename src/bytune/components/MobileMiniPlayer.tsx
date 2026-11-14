import { Play, Pause, Heart } from "lucide-react";
import { usePlayer, shownTrack } from "../stores/player";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";

export function MobileMiniPlayer() {
  const track = usePlayer(shownTrack);
  const isPlaying = usePlayer((s) => s.playing);
  const toggle = usePlayer((s) => s.toggle);
  const position = usePlayer((s) => s.position);
  const duration = usePlayer((s) => s.duration);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const isLiked = useLibrary((s) => (track ? s.isLiked(track.id) : false));
  const toggleNowPlaying = useUI((s) => s.toggleNowPlaying);

  if (!track) return null;

  const pct = duration > 0 ? Math.min(100, (position / duration) * 100) : 0;

  return (
    <div
      onClick={toggleNowPlaying}
      className="fixed bottom-[68px] inset-x-2 z-40 bg-[#16161a]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 shadow-2xl cursor-pointer select-none active:scale-[0.99] transition-transform"
    >
      <div className="flex items-center gap-3">
        {/* Cover Thumbnail */}
        <div className="relative w-11 h-11 rounded-xl overflow-hidden bg-white/5 shrink-0 border border-white/10 shadow-md">
          {track.thumb ? (
            <img src={track.thumb} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-[10px]">No Art</div>
          )}
        </div>

        {/* Title & Artist */}
        <div className="flex-1 min-w-0 pr-1">
          <p className="text-[13px] font-semibold text-white truncate leading-tight">
            {track.title}
          </p>
          <p className="text-[11px] text-white/60 truncate leading-tight mt-0.5">
            {track.artist}
          </p>
        </div>

        {/* Like Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggleLike(track);
          }}
          className="p-2 text-white/60 hover:text-white transition-colors"
          title="Save to Liked Songs"
          aria-label="Like track"
        >
          <Heart className={`w-4 h-4 ${isLiked ? "fill-white text-white" : ""}`} />
        </button>

        {/* Play/Pause Button */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            toggle();
          }}
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-90 transition-transform shrink-0"
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>
      </div>

      {/* Progress Bar Line */}
      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
        <div className="h-full bg-white rounded-full transition-all duration-200" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
