import { useSyncExternalStore } from "react";
import { Play, Pause, Heart, Smartphone, Monitor } from "lucide-react";
import { usePlayer, shownTrack } from "../stores/player";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";
import { useMobileMode } from "../stores/mobileMode";
import { getPlaybackClock, subscribePlaybackClock } from "../lib/playbackClock";
import { useSwipeGesture } from "../lib/useSwipeGesture";

function MiniProgressBar({ fallbackDuration }: { fallbackDuration: number }) {
  const clock = useSyncExternalStore(subscribePlaybackClock, getPlaybackClock);
  const dur = clock.duration > 0 ? clock.duration : fallbackDuration;
  const ratio = dur > 0 ? Math.min(1, Math.max(0, clock.position / dur)) : 0;
  return (
    <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
      <div
        className="h-full w-full bg-white rounded-full will-change-transform transition-transform duration-150 ease-linear"
        style={{ transform: `scaleX(${ratio})`, transformOrigin: "left center" }}
      />
    </div>
  );
}

export function MobileMiniPlayer() {
  const track = usePlayer(shownTrack);
  const isPlaying = usePlayer((s) => s.playing);
  const playbackStatus = usePlayer((s) => s.playbackStatus);
  const storeDuration = usePlayer((s) => s.duration);
  const toggle = usePlayer((s) => s.toggle);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const isLiked = useLibrary((s) => (track ? s.isLiked(track.id) : false));
  const toggleNowPlaying = useUI((s) => s.toggleNowPlaying);
  const mode = useMobileMode((s) => s.mode);
  const setMode = useMobileMode((s) => s.setMode);

  const swipe = useSwipeGesture({
    onSwipeRight: () => usePlayer.getState().next(true),
    onSwipeLeft: () => usePlayer.getState().prev(),
    disabled: !track,
  });

  if (!track) return null;

  return (
    <div
      {...swipe.handlers}
      onClick={() => {
        if (swipe.consumeDidSwipe()) return;
        toggleNowPlaying();
      }}
      style={{
        touchAction: "pan-y",
        transform: `translate3d(${swipe.offsetX}px, 0, 0)`,
        transition: swipe.dragging ? "none" : "transform 200ms cubic-bezier(0.22, 1, 0.36, 1)",
      }}
      className="fixed bottom-[68px] inset-x-2 z-40 bg-[#16161a]/95 backdrop-blur-2xl border border-white/10 rounded-2xl p-2 flex flex-col gap-1.5 shadow-2xl cursor-pointer select-none will-change-transform active:scale-[0.985]"
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

        {/* Mode Switcher: Phone or PC Icon */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMode(mode === "phone" ? "pc_remote" : "phone");
          }}
          className="p-2 text-white/70 hover:text-white transition-all active:scale-90"
          title={
            mode === "phone"
              ? "Mobile Mode (Tap to switch to PC Mode)"
              : "PC Mode (Tap to switch to Mobile Mode)"
          }
          aria-label="Toggle playback mode"
        >
          {mode === "phone" ? (
            <Smartphone className="w-4 h-4 text-white" />
          ) : (
            <Monitor className="w-4 h-4 text-emerald-400" />
          )}
        </button>

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
          className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-90 transition-transform shrink-0 relative"
          title={isPlaying ? "Pause" : "Play"}
          aria-label={isPlaying ? "Pause" : "Play"}
        >
          {(playbackStatus === "loading" || playbackStatus === "buffering") && (
            <span
              className="pointer-events-none absolute inset-[-3px] rounded-full border-2 border-white/30 border-t-white animate-spin"
              aria-hidden="true"
            />
          )}
          {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
        </button>
      </div>

      {/* GPU-composited Progress Bar Line isolated from root renders */}
      <MiniProgressBar fallbackDuration={storeDuration} />
    </div>
  );
}
