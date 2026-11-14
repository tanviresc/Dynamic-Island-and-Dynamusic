import React, { useRef } from "react";
import { Heart, Moon, Sliders, BadgeCheck } from "lucide-react";
import { useDynamusic } from "./useDynamusicStore";
import {
  SpShuffle,
  SpPrev,
  SpPlay,
  SpPause,
  SpNext,
  SpRepeat,
  SpRepeatOne,
  SpLyrics,
  SpQueue,
  SpMiniplayer,
  SpFullscreen,
  SpVolumeHigh,
  SpVolumeOff,
} from "./components/SpotifyIcons";
import { EYE_ARTWORK } from "./initialData";

function formatTime(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds < 10 ? "0" : ""}${seconds}`;
}

export const PlayerBar: React.FC<{
  onOpenEq: () => void;
}> = ({ onOpenEq }) => {
  const {
    currentTrack,
    isPlaying,
    positionMs,
    durationMs,
    volume,
    isShuffle,
    isRepeat,
    togglePlay,
    next,
    prev,
    seek,
    setVolume,
    toggleLike,
    isLiked,
    toggleShuffle,
    toggleRepeat,
    rightPanel,
    toggleRightPanel,
    lyricsCenter,
    toggleLyricsCenter,
    sleepTimerMinutes,
    setSleepTimer,
  } = useDynamusic();

  const progressRef = useRef<HTMLDivElement>(null);
  const volumeRef = useRef<HTMLDivElement>(null);

  const track = currentTrack || {
    id: "temper-1",
    title: "Self Aware",
    artist: "Temper City",
    coverUrl: EYE_ARTWORK,
    durationMs: 180000,
  };

  const liked = isLiked(track.id);
  const progressPercent = durationMs > 0 ? Math.min(100, Math.max(0, (positionMs / durationMs) * 100)) : 0;

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!progressRef.current || durationMs <= 0) return;
    const rect = progressRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const newPos = (clickX / rect.width) * durationMs;
    seek(newPos);
  };

  const handleVolumeClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!volumeRef.current) return;
    const rect = volumeRef.current.getBoundingClientRect();
    const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
    const newVol = Math.max(0, Math.min(1, clickX / rect.width));
    setVolume(newVol);
  };

  const cycleSleepTimer = () => {
    if (!sleepTimerMinutes) setSleepTimer(15);
    else if (sleepTimerMinutes === 15) setSleepTimer(30);
    else if (sleepTimerMinutes === 30) setSleepTimer(60);
    else setSleepTimer(null);
  };

  return (
    <footer className="h-[88px] shrink-0 bg-[#000000] border-t border-white/[0.06] flex items-center justify-between px-4 select-none relative z-50">
      {/* Left: Track Information */}
      <div className="flex items-center gap-3 w-[300px] min-w-0">
        <div className="relative group shrink-0">
          <img
            src={track.coverUrl || EYE_ARTWORK}
            alt={track.title}
            className="w-14 h-14 rounded-[4px] object-cover bg-[#282828] shadow-md"
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className="text-[14px] font-medium text-white truncate hover:underline cursor-pointer"
              title={track.title}
            >
              {track.title}
            </span>
            <BadgeCheck className="w-3.5 h-3.5 text-[#38bdf8] fill-[#38bdf8] shrink-0" stroke="#000" />
          </div>
          <div
            className="text-[12px] text-[#b3b3b3] hover:text-white hover:underline cursor-pointer truncate mt-0.5"
            title={track.artist}
          >
            {track.artist}
          </div>
        </div>

        <button
          type="button"
          onClick={() => toggleLike(track.id)}
          className={`p-2 transition-colors shrink-0 ${
            liked ? "text-[#1ed760]" : "text-[#b3b3b3] hover:text-white"
          }`}
          title={liked ? "Remove from Liked Songs" : "Save to Liked Songs"}
        >
          <Heart className={`w-4 h-4 ${liked ? "fill-current" : ""}`} />
        </button>
      </div>

      {/* Center: Controls & Scrubber */}
      <div className="flex flex-col items-center gap-1.5 w-[560px] max-w-[45vw]">
        {/* Transport buttons */}
        <div className="flex items-center gap-4">
          <button
            onClick={toggleShuffle}
            className={`p-2 transition-colors relative ${
              isShuffle ? "text-[#1ed760]" : "text-[#b3b3b3] hover:text-white"
            }`}
            title="Enable shuffle"
          >
            <SpShuffle className="w-4 h-4" />
            {isShuffle && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1ed760]" />
            )}
          </button>

          <button
            onClick={prev}
            className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
            title="Previous"
          >
            <SpPrev className="w-4 h-4" />
          </button>

          <button
            onClick={togglePlay}
            className="w-8 h-8 rounded-full bg-white text-black flex items-center justify-center hover:scale-105 active:scale-95 shadow transition-all"
            title={isPlaying ? "Pause" : "Play"}
          >
            {isPlaying ? (
              <SpPause className="w-4 h-4 fill-black" />
            ) : (
              <SpPlay className="w-4 h-4 fill-black ml-0.5" />
            )}
          </button>

          <button
            onClick={next}
            className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
            title="Next"
          >
            <SpNext className="w-4 h-4" />
          </button>

          <button
            onClick={toggleRepeat}
            className={`p-2 transition-colors relative ${
              isRepeat ? "text-[#1ed760]" : "text-[#b3b3b3] hover:text-white"
            }`}
            title="Enable repeat"
          >
            {isRepeat ? <SpRepeatOne className="w-4 h-4" /> : <SpRepeat className="w-4 h-4" />}
            {isRepeat && (
              <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-[#1ed760]" />
            )}
          </button>
        </div>

        {/* Timeline seeker */}
        <div className="flex items-center gap-2.5 w-full">
          <span className="text-[11px] text-[#b3b3b3] w-9 text-right tabular-nums select-none">
            {formatTime(positionMs)}
          </span>

          <div
            ref={progressRef}
            onClick={handleSeekClick}
            className="flex-1 h-3 flex items-center cursor-pointer group"
          >
            <div className="w-full h-1 bg-white/20 group-hover:h-1.5 rounded-full overflow-hidden relative transition-all">
              <div
                className="h-full bg-white group-hover:bg-[#1ed760] transition-colors rounded-full"
                style={{ width: `${progressPercent}%` }}
              />
            </div>
          </div>

          <span className="text-[11px] text-[#b3b3b3] w-9 tabular-nums select-none">
            {formatTime(durationMs)}
          </span>
        </div>
      </div>

      {/* Right: Actions, Volume & Tools */}
      <div className="flex items-center justify-end gap-2 w-[300px]">
        {/* Sleep Timer */}
        <button
          onClick={cycleSleepTimer}
          className={`p-2 transition-colors relative ${
            sleepTimerMinutes ? "text-white" : "text-[#b3b3b3] hover:text-white"
          }`}
          title={sleepTimerMinutes ? `Sleep timer: ${sleepTimerMinutes}m` : "Sleep timer"}
        >
          <Moon className="w-4 h-4" />
          {sleepTimerMinutes && (
            <span className="absolute -top-1 -right-1 text-[9px] font-bold text-green-400 bg-black/80 px-1 rounded-full">
              {sleepTimerMinutes}m
            </span>
          )}
        </button>

        {/* Lyrics Toggle */}
        <button
          onClick={toggleLyricsCenter}
          className={`p-2 transition-colors relative ${
            lyricsCenter ? "text-white" : "text-[#b3b3b3] hover:text-white"
          }`}
          title="Lyrics"
        >
          <SpLyrics className="w-4 h-4" />
          {lyricsCenter && (
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
          )}
        </button>

        {/* Queue Toggle */}
        <button
          onClick={toggleRightPanel}
          className={`p-2 transition-colors relative ${
            rightPanel === "queue" ? "text-white" : "text-[#b3b3b3] hover:text-white"
          }`}
          title="Queue"
        >
          <SpQueue className="w-4 h-4" />
          {rightPanel === "queue" && (
            <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-1 h-1 rounded-full bg-white" />
          )}
        </button>

        {/* Equalizer */}
        <button
          onClick={onOpenEq}
          className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
          title="10-Band Graphic Equalizer"
        >
          <Sliders className="w-4 h-4" />
        </button>

        {/* Volume */}
        <div className="flex items-center gap-1.5 ml-1">
          <button
            onClick={() => setVolume(volume > 0 ? 0 : 0.8)}
            className="p-1.5 text-[#b3b3b3] hover:text-white transition-colors"
            title={volume === 0 ? "Unmute" : "Mute"}
          >
            {volume === 0 ? (
              <SpVolumeOff className="w-4 h-4" />
            ) : (
              <SpVolumeHigh className="w-4 h-4" />
            )}
          </button>
          <div
            ref={volumeRef}
            onClick={handleVolumeClick}
            className="w-20 h-3 flex items-center cursor-pointer group"
          >
            <div className="w-full h-1 bg-white/20 group-hover:h-1.5 rounded-full overflow-hidden relative transition-all">
              <div
                className="h-full bg-white group-hover:bg-[#1ed760] transition-colors rounded-full"
                style={{ width: `${volume * 100}%` }}
              />
            </div>
          </div>
        </div>

        {/* Miniplayer */}
        <button
          onClick={() => {}}
          className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
          title="Picture in Picture / Miniplayer"
        >
          <SpMiniplayer className="w-4 h-4" />
        </button>

        {/* Fullscreen */}
        <button
          onClick={() => {
            if (document.fullscreenElement) {
              document.exitFullscreen();
            } else {
              document.documentElement.requestFullscreen();
            }
          }}
          className="p-2 text-[#b3b3b3] hover:text-white transition-colors"
          title="Fullscreen"
        >
          <SpFullscreen className="w-4 h-4" />
        </button>
      </div>
    </footer>
  );
};
