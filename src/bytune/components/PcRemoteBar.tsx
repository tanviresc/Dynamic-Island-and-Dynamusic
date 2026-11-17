import { useEffect, useRef, useState } from "react";
import { Monitor, Smartphone, Play, Pause, SkipForward, SkipBack, Volume2, Heart, Wifi, WifiOff } from "lucide-react";
import { getInterpolatedPcPosition, isTauriDesktop, useMobileMode } from "../stores/mobileMode";
import { useLibrary } from "../stores/library";
import { useUI } from "../stores/ui";
import { fmtTime } from "../lib/format";
import { useSwipeGesture } from "../lib/useSwipeGesture";

function useRemoteLivePosition(
  isPlaying: boolean,
  trackId: string | undefined,
  position: number | undefined,
  serverTimestamp: number | undefined
): [number, (sec: number) => void] {
  const [livePos, setLivePos] = useState(() => getInterpolatedPcPosition(useMobileMode.getState().pcState));
  useEffect(() => {
    setLivePos(getInterpolatedPcPosition(useMobileMode.getState().pcState));
    if (!isPlaying || (typeof document !== "undefined" && document.hidden)) return;
    const id = window.setInterval(() => {
      if (!document.hidden) {
        setLivePos(getInterpolatedPcPosition(useMobileMode.getState().pcState));
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [isPlaying, position, serverTimestamp, trackId]);
  return [livePos, setLivePos];
}

function RemoteTimeText({
  duration,
  isPlaying,
  trackId,
  position,
  serverTimestamp,
}: {
  duration: number;
  isPlaying: boolean;
  trackId?: string;
  position?: number;
  serverTimestamp?: number;
}) {
  const [livePos] = useRemoteLivePosition(isPlaying, trackId, position, serverTimestamp);
  return (
    <span className="text-white/45 text-[10px] tabular-nums shrink-0">
      {fmtTime(livePos)} / {fmtTime(duration)}
    </span>
  );
}

function RemoteProgressScrubber({
  duration,
  isPlaying,
  trackId,
  position,
  serverTimestamp,
  onSeek,
}: {
  duration: number;
  isPlaying: boolean;
  trackId?: string;
  position?: number;
  serverTimestamp?: number;
  onSeek: (sec: number) => void;
}) {
  const [livePos, setLivePos] = useRemoteLivePosition(isPlaying, trackId, position, serverTimestamp);
  const [dragSec, setDragSec] = useState<number | null>(null);
  const scrubRef = useRef<HTMLDivElement>(null);
  const computeScrubSec = (clientX: number): number => {
    const el = scrubRef.current;
    if (!el || duration <= 0) return 0;
    const rect = el.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / Math.max(1, rect.width)));
    return ratio * duration;
  };
  const shownPos = dragSec ?? livePos;
  const pct = duration > 0 ? Math.min(100, Math.max(0, (shownPos / duration) * 100)) : 0;

  return (
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
        onSeek(finalSec);
      }}
      onPointerCancel={() => setDragSec(null)}
    >
      <div className="w-full h-1 bg-white/10 rounded-full overflow-hidden">
        <div
          className="h-full w-full bg-emerald-400 rounded-full origin-left will-change-transform"
          style={{ transform: `scaleX(${pct / 100})` }}
        />
      </div>
    </div>
  );
}

export function PcRemoteBar() {
  const mode = useMobileMode((s) => s.mode);
  const setMode = useMobileMode((s) => s.setMode);
  const pcState = useMobileMode((s) => s.pcState);
  const pcHost = useMobileMode((s) => s.pcHost);
  const desktopOnline = useMobileMode((s) => s.desktopOnline);
  const connectionStatus = useMobileMode((s) => s.connectionStatus);
  const sendCommand = useMobileMode((s) => s.sendPcCommand);
  const reconnectNow = useMobileMode((s) => s.reconnectNow);
  const toggleLike = useLibrary((s) => s.toggleLike);
  const isLiked = useLibrary((s) => (pcState?.track ? s.isLiked(pcState.track.id) : false));
  const toggleNowPlaying = useUI((s) => s.toggleNowPlaying);
  const navigate = useUI((s) => s.navigate);
  const needsHostSetup = !isTauriDesktop() && (pcHost === "127.0.0.1" || pcHost === "localhost" || !pcHost);

  const track = pcState?.track;
  const isPlaying = Boolean(pcState?.playing);
  const duration = pcState?.duration ?? (track?.duration ?? 0);

  // Smooth debounced PC volume control (updates locally immediately, throttles network)
  const [localVol, setLocalVol] = useState<number | null>(null);
  const volThrottleRef = useRef<number>(0);
  const shownVol = localVol ?? (typeof pcState?.volume === "number" ? pcState.volume : 0.8);

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
      className="fixed bottom-[68px] inset-x-2 z-40 bg-[#121214]/[0.97] border border-emerald-500/30 rounded-2xl p-2.5 flex flex-col gap-1.5 shadow-2xl select-none cursor-pointer will-change-transform max-w-full overflow-hidden"
    >
      {/* Indicator Tag + Connection Health */}
      <div className="flex items-center justify-between text-[11px] font-medium px-1 gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              if (needsHostSetup) {
                navigate({ name: "settings", param: "account" });
              } else if (connectionStatus !== "connected") {
                reconnectNow();
              }
            }}
            className={`flex items-center gap-1.5 min-w-0 truncate ${
              needsHostSetup
                ? "text-amber-400"
                : connectionStatus === "connected" && desktopOnline
                  ? "text-emerald-400"
                  : connectionStatus === "connected" || connectionStatus === "reconnecting"
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
              {needsHostSetup
                ? "Tap to enter PC IP"
                : connectionStatus === "connected" && desktopOnline
                  ? "Controlling PC Dynamusic"
                  : connectionStatus === "connected"
                    ? "PC server linked (open player on PC)"
                    : connectionStatus === "reconnecting"
                      ? "Reconnecting to PC..."
                      : "PC Offline (Tap to retry)"}
            </span>
          </button>
          {connectionStatus !== "connected" && !needsHostSetup && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                navigate({ name: "settings", param: "account" });
              }}
              className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px] text-white/80 shrink-0"
            >
              Pair IP
            </button>
          )}
        </div>
        <RemoteTimeText
          duration={duration}
          isPlaying={isPlaying}
          trackId={track?.id}
          position={pcState?.position}
          serverTimestamp={pcState?.serverTimestamp}
        />
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
      <RemoteProgressScrubber
        duration={duration}
        isPlaying={isPlaying}
        trackId={track?.id}
        position={pcState?.position}
        serverTimestamp={pcState?.serverTimestamp}
        onSeek={(sec) => void sendCommand("SEEK", sec)}
      />
    </div>
  );
}
