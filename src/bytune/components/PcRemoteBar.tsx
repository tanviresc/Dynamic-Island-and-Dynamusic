import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Play, Pause, SkipForward, SkipBack, Volume2, Heart, Wifi, WifiOff } from "lucide-react";
import { getInterpolatedPcPosition, useMobileMode } from "../stores/mobileMode";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";
import { fmtTime } from "../lib/format";
import { useSwipeGesture } from "../lib/useSwipeGesture";

export function PcRemoteBar() {
  const mode = useMobileMode((s) => s.mode);
  const setMode = useMobileMode((s) => s.setMode);
  const pcState = useMobileMode((s) => s.pcState);
  const connectionStatus = useMobileMode((s) => s.connectionStatus);
  const sendCommand = useMobileMode((s) => s.sendPcCommand);
  const reconnectNow = useMobileMode((s) => s.reconnectNow);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const isLiked = useLibrary((s) => (pcState?.track ? s.isLiked(pcState.track.id) : false));
  const toggleNowPlaying = useUI((s) => s.toggleNowPlaying);

  const track = pcState?.track;
  const isPlaying = Boolean(pcState?.playing);
  const duration = pcState?.duration ?? (track?.duration ?? 0);

  // Smooth local interpolation between 2s desktop server state heartbeats
  const [livePos, setLivePos] = useState(() => getInterpolatedPcPosition(pcState));
  useEffect(() => {
    setLivePos(getInterpolatedPcPosition(pcState));
    if (!isPlaying) return;
    const id = window.setInterval(() => {
      setLivePos(getInterpolatedPcPosition(useMobileMode.getState().pcState));
    }, 200);
    return () => window.clearInterval(id);
  }, [isPlaying, pcState?.position, pcState?.serverTimestamp, track?.id]);

  // Scrubber pointer drag state
  const [dragSec, setDragSec] = useState<number | null>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const computeScrubSec = (clientX: number): number => {
    const el = scrubRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };

  // Smooth debounced PC volume control (updates locally immediately, throttles network)
  const [localVol, setLocalVol] = useState<number | null>(null);
  const volThrottleRef = useRef<number>(0);
  const shownVol = localVol ?? (typeof pcState?.volume === "number" ? pcState.volume : 0.8);

  const shownPos = dragSec ?? livePos;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shownPos / duration) * 100)) : 0;

  const swipe = useSwipeGesture({
    onSwipeRight: () => sendCommand("NEXT"),
    onSwipeLeft: () => sendCommand("PREV"),
    disabled: !track,
  });

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
      className="fixed bottom-[68px] inset-x-2 z-40 bg-[#121214]/95 backdrop-blur-2xl border border-emerald-500/30 rounded-2xl p-2.5 flex flex-col gap-1.5 shadow-2xl select-none cursor-pointer will-change-transform max-w-full overflow-hidden"
    >
      {/* Indicator Tag + Connection Health */}
      <div className="flex items-center justify-between text-[11px] font-medium px-1 gap-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            if (connectionStatus !== "connected") reconnectNow();
          }}
          className={`flex items-center gap-1.5 min-w-0 truncate ${
            connectionStatus === "connected"
              ? "text-emerald-400"
              : connectionStatus === "reconnecting"
                ? "text-amber-400"
                : "text-red-400"
          }`}
        >
          {connectionStatus === "connected" ? (
            <Wifi className="w-3 h-3 shrink-0" />
          ) : (
            <WifiOff className="w-3 h-3 shrink-0" />
          )}
          <span className="truncate">
            {connectionStatus === "connected"
              ? "Controlling PC Dynamusic"
              : connectionStatus === "reconnecting"
                ? "Reconnecting to PC..."
                : "PC Offline (Tap to retry)"}
          </span>
        </button>
        <span className="text-white/45 text-[10px] tabular-nums shrink-0">
          {fmtTime(shownPos)} / {fmtTime(duration)}
        </span>
      </div>

      {/* Track & Controls */}
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="relative w-11 h-11 rounded-lg overflow-hidden bg-white/5 shrink-0 border border-white/10">
          {track?.thumb ? (
            <img src={track.thumb} alt={track.title} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-white/30 text-[10px]">PC</div>
          )}
        </div>

        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-white truncate">
            {track ? track.title : "PC Player Idle"}
          </div>
          <div className="text-[11px] text-white/50 truncate">
            {track ? track.artist : "Pick a song on phone or PC"}
          </div>
        </div>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setMode(mode === "phone" ? "pc_remote" : "phone");
          }}
          title={mode === "phone" ? "Switch to PC Remote Mode" : "Switch to Phone Playback Mode"}
          aria-label={mode === "phone" ? "Switch to PC Remote Mode" : "Switch to Phone Playback Mode"}
          className="p-2 rounded-lg text-white/70 hover:text-white hover:bg-white/10 transition-colors shrink-0"
        >
          {mode === "phone" ? (
            <Smartphone className="w-4 h-4 text-white" />
          ) : (
            <Monitor className="w-4 h-4 text-emerald-400" />
          )}
        </button>

        {track && (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              toggleLike(track);
            }}
            className="p-1.5 text-white/60 hover:text-white shrink-0"
            title="Like song"
          >
            <Heart className={`w-4 h-4 ${isLiked ? "fill-white text-white" : ""}`} />
          </button>
        )}

        <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={() => sendCommand("PREV")}
            className="p-1.5 text-white/70 hover:text-white transition-transform active:scale-90"
            title="Previous track on PC"
          >
            <SkipBack className="w-4 h-4 fill-current" />
          </button>

          <button
            type="button"
            onClick={() => sendCommand(isPlaying ? "PAUSE" : "PLAY")}
            className="w-9 h-9 rounded-full bg-white text-black flex items-center justify-center shadow-lg active:scale-95 transition-transform"
            title={isPlaying ? "Pause PC" : "Play PC"}
          >
            {isPlaying ? <Pause className="w-4 h-4 fill-current" /> : <Play className="w-4 h-4 fill-current ml-0.5" />}
          </button>

          <button
            type="button"
            onClick={() => sendCommand("NEXT")}
            className="p-1.5 text-white/70 hover:text-white transition-transform active:scale-90"
            title="Next track on PC"
          >
            <SkipForward className="w-4 h-4 fill-current" />
          </button>
        </div>
      </div>

      {/* PC Volume slider */}
      <div className="flex items-center gap-2 px-1" onClick={(e) => e.stopPropagation()}>
        <Volume2 className="w-3.5 h-3.5 text-emerald-400/80 shrink-0" />
        <input
          type="range"
          min={0}
          max={1}
          step={0.02}
          value={shownVol}
          onChange={(e) => {
            const v = Number(e.target.value);
            setLocalVol(v);
            const now = Date.now();
            if (now - volThrottleRef.current >= 90) {
              volThrottleRef.current = now;
              void sendCommand("VOLUME", v);
            }
          }}
          onPointerUp={() => {
            if (localVol !== null) {
              void sendCommand("VOLUME", localVol);
              setLocalVol(null);
            }
          }}
          aria-label="PC Volume"
          className="flex-1 h-1 accent-emerald-400 cursor-pointer"
        />
      </div>

      {/* Draggable Progress Bar */}
      <div
        ref={scrubRef}
        className="w-full py-1.5 -my-1 cursor-pointer touch-none"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => {
          if (!duration) return;
          e.stopPropagation();
          e.currentTarget.setPointerCapture(e.pointerId);
          setDragSec(computeScrubSec(e.clientX));
        }}
        onPointerMove={(e) => {
          if (dragSec === null) return;
          e.stopPropagation();
          setDragSec(computeScrubSec(e.clientX));
        }}
        onPointerUp={(e) => {
          if (dragSec === null) return;
          e.stopPropagation();
          const finalSec = computeScrubSec(e.clientX);
          setDragSec(null);
          setLivePos(finalSec);
          void sendCommand("SEEK", finalSec);
        }}
        onPointerCancel={() => setDragSec(null)}
      >
        <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-400 rounded-full" style={{ width: `${pct}%` }} />
        </div>
      </div>
    </div>
  );
}
