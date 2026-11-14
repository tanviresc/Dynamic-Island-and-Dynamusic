import React, { createContext, useContext, useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Track, LyricLine, IPCMusicState } from "./types";
import { audioEngine, EQ_PRESETS } from "./audioEngine";
import { CURATED_TRACKS, parseLocalAudioFile } from "./musicService";
import { fetchLyricsFromLrclib, getCurrentLyric } from "./lyricsService";

interface DynamusicContextType {
  queue: Track[];
  currentIndex: number;
  currentTrack: Track | null;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  lyrics: LyricLine[];
  currentLyric: LyricLine | null;
  currentLyricIndex: number;
  eqPreset: string;
  eqGains: number[];
  visualizerBars: number[];
  isShuffle: boolean;
  isRepeat: boolean;
  likedTrackIds: Set<string>;

  // Actions
  playTrack: (track: Track, newQueue?: Track[]) => Promise<void>;
  togglePlay: () => void;
  next: () => void;
  prev: () => void;
  seek: (positionMs: number) => void;
  setVolume: (volume: number) => void;
  setEqGains: (gains: number[]) => void;
  setEqPreset: (presetName: string) => void;
  toggleLike: (trackId: string) => void;
  addLocalFiles: (files: FileList | File[]) => Promise<void>;
  toggleShuffle: () => void;
  toggleRepeat: () => void;
}

const DynamusicContext = createContext<DynamusicContextType | null>(null);

export const DynamusicProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [queue, setQueue] = useState<Track[]>(CURATED_TRACKS);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [positionMs, setPositionMs] = useState<number>(0);
  const [durationMs, setDurationMs] = useState<number>(CURATED_TRACKS[0]?.durationMs || 180000);
  const [volume, setVolumeState] = useState<number>(0.85);
  const [lyrics, setLyrics] = useState<LyricLine[]>([]);
  const [currentLyric, setCurrentLyric] = useState<LyricLine | null>(null);
  const [currentLyricIndex, setCurrentLyricIndex] = useState<number>(-1);
  const [eqPreset, setEqPresetState] = useState<string>("Flat");
  const [eqGains, setEqGainsState] = useState<number[]>(EQ_PRESETS[0]!.gains);
  const [visualizerBars, setVisualizerBars] = useState<number[]>([0.1, 0.1, 0.1, 0.1]);
  const [isShuffle, setIsShuffle] = useState<boolean>(false);
  const [isRepeat, setIsRepeat] = useState<boolean>(false);
  const [likedTrackIds, setLikedTrackIds] = useState<Set<string>>(new Set(["curated-1", "curated-3"]));

  const currentTrack = queue[currentIndex] || null;
  const currentTrackRef = useRef<Track | null>(currentTrack);
  currentTrackRef.current = currentTrack;

  // Sync to Tauri backend & Island overlay
  const syncToTauri = useCallback((track: Track | null, playing: boolean, posMs: number, durMs: number, vol: number, activeLyric?: string) => {
    try {
      if (!track) {
        invoke("update_music_state", { state: null });
        return;
      }
      const ipcState: IPCMusicState = {
        title: track.title,
        artist: track.artist,
        album: track.album,
        albumArt: track.coverUrl,
        isPlaying: playing,
        positionMs: posMs,
        durationMs: durMs || track.durationMs,
        volume: vol,
        lyricsCurrentLine: activeLyric,
      };
      invoke("update_music_state", { state: ipcState });
    } catch {
      // In browser or non-tauri mode
    }
  }, []);

  // Play track function
  const playTrack = useCallback(async (track: Track, newQueue?: Track[]) => {
    if (newQueue) {
      setQueue(newQueue);
      const idx = newQueue.findIndex((t) => t.id === track.id);
      setCurrentIndex(idx >= 0 ? idx : 0);
    } else {
      const idx = queue.findIndex((t) => t.id === track.id);
      if (idx >= 0) {
        setCurrentIndex(idx);
      } else {
        setQueue((prev) => [track, ...prev]);
        setCurrentIndex(0);
      }
    }

    setPositionMs(0);
    setDurationMs(track.durationMs);
    await audioEngine.load(track, true);
    setIsPlaying(true);

    // Fetch synced lyrics from LRCLIB
    fetchLyricsFromLrclib(track.artist, track.title, track.durationMs / 1000).then((synced) => {
      setLyrics(synced);
    });

    syncToTauri(track, true, 0, track.durationMs, volume);
  }, [queue, volume, syncToTauri]);

  const togglePlay = useCallback(() => {
    if (!currentTrack) {
      if (queue[0]) {
        playTrack(queue[0]);
      }
      return;
    }
    audioEngine.togglePlay();
    const nextPlaying = !isPlaying;
    setIsPlaying(nextPlaying);
    syncToTauri(currentTrack, nextPlaying, positionMs, durationMs, volume, currentLyric?.text);
  }, [currentTrack, queue, isPlaying, positionMs, durationMs, volume, currentLyric, playTrack, syncToTauri]);

  const next = useCallback(() => {
    if (!queue.length) return;
    let nextIdx = currentIndex + 1;
    if (isShuffle) {
      nextIdx = Math.floor(Math.random() * queue.length);
    } else if (nextIdx >= queue.length) {
      nextIdx = isRepeat ? 0 : queue.length - 1;
    }
    const track = queue[nextIdx];
    if (track) {
      playTrack(track);
    }
  }, [queue, currentIndex, isShuffle, isRepeat, playTrack]);

  const prev = useCallback(() => {
    if (!queue.length) return;
    if (positionMs > 3000) {
      // Rewind to start if already played > 3 seconds
      audioEngine.seek(0);
      setPositionMs(0);
      return;
    }
    let prevIdx = currentIndex - 1;
    if (prevIdx < 0) {
      prevIdx = queue.length - 1;
    }
    const track = queue[prevIdx];
    if (track) {
      playTrack(track);
    }
  }, [queue, currentIndex, positionMs, playTrack]);

  const seek = useCallback((posMs: number) => {
    audioEngine.seek(posMs);
    setPositionMs(posMs);
    if (currentTrack) {
      syncToTauri(currentTrack, isPlaying, posMs, durationMs, volume, currentLyric?.text);
    }
  }, [currentTrack, isPlaying, durationMs, volume, currentLyric, syncToTauri]);

  const setVolume = useCallback((vol: number) => {
    setVolumeState(vol);
    audioEngine.setVolume(vol);
    if (currentTrack) {
      syncToTauri(currentTrack, isPlaying, positionMs, durationMs, vol, currentLyric?.text);
    }
  }, [currentTrack, isPlaying, positionMs, durationMs, currentLyric, syncToTauri]);

  const setEqGains = useCallback((gains: number[]) => {
    setEqGainsState(gains);
    audioEngine.setEqGains(gains);
  }, []);

  const setEqPreset = useCallback((presetName: string) => {
    setEqPresetState(presetName);
    const preset = EQ_PRESETS.find((p) => p.name === presetName);
    if (preset) {
      setEqGainsState(preset.gains);
      audioEngine.setEqGains(preset.gains);
    }
  }, []);

  const toggleLike = useCallback((trackId: string) => {
    setLikedTrackIds((prev) => {
      const nextSet = new Set(prev);
      if (nextSet.has(trackId)) {
        nextSet.delete(trackId);
      } else {
        nextSet.add(trackId);
      }
      return nextSet;
    });
  }, []);

  const addLocalFiles = useCallback(async (files: FileList | File[]) => {
    const fileArray = Array.from(files);
    const parsedTracks: Track[] = [];
    for (const f of fileArray) {
      if (f.type.startsWith("audio/") || /\.(mp3|flac|wav|m4a|aac|ogg|opus)$/i.test(f.name)) {
        const track = await parseLocalAudioFile(f);
        parsedTracks.push(track);
      }
    }
    if (parsedTracks.length > 0) {
      setQueue((prev) => [...parsedTracks, ...prev]);
      if (!isPlaying) {
        const first = parsedTracks[0];
        if (first) {
          playTrack(first);
        }
      }
    }
  }, [isPlaying, playTrack]);

  const toggleShuffle = useCallback(() => setIsShuffle((v) => !v), []);
  const toggleRepeat = useCallback(() => setIsRepeat((v) => !v), []);

  // Subscribe to audio engine events
  useEffect(() => {
    const unsub = audioEngine.subscribe((ev) => {
      setPositionMs(ev.currentTimeMs);
      if (ev.durationMs > 0) {
        setDurationMs(ev.durationMs);
      }
      setIsPlaying(ev.isPlaying);

      // Compute synced lyrics
      if (lyrics.length > 0) {
        const { current, currentIndex: idx } = getCurrentLyric(lyrics, ev.currentTimeMs);
        setCurrentLyric(current);
        setCurrentLyricIndex(idx);
      }

      // Update frequency visualizer
      const bars = audioEngine.getVisualizerLevels(4);
      setVisualizerBars(bars);

      if (ev.hasEnded) {
        next();
      }
    });

    return unsub;
  }, [lyrics, next]);

  // Listen for commands from Tauri Dynamic Island overlay
  useEffect(() => {
    let unlisten: (() => void) | undefined;
    listen<{ command: string; payload?: any }>("dynamusic://command", (event) => {
      const { command, payload } = event.payload;
      switch (command) {
        case "play":
          audioEngine.play();
          setIsPlaying(true);
          break;
        case "pause":
          audioEngine.pause();
          setIsPlaying(false);
          break;
        case "toggle_play":
          togglePlay();
          break;
        case "next":
          next();
          break;
        case "prev":
          prev();
          break;
        case "seek":
          if (typeof payload === "number") {
            seek(payload);
          }
          break;
        case "volume":
          if (typeof payload === "number") {
            setVolume(payload);
          }
          break;
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, [togglePlay, next, prev, seek, setVolume]);

  return (
    <DynamusicContext.Provider
      value={{
        queue,
        currentIndex,
        currentTrack,
        isPlaying,
        positionMs,
        durationMs,
        volume,
        lyrics,
        currentLyric,
        currentLyricIndex,
        eqPreset,
        eqGains,
        visualizerBars,
        isShuffle,
        isRepeat,
        likedTrackIds,
        playTrack,
        togglePlay,
        next,
        prev,
        seek,
        setVolume,
        setEqGains,
        setEqPreset,
        toggleLike,
        addLocalFiles,
        toggleShuffle,
        toggleRepeat,
      }}
    >
      {children}
    </DynamusicContext.Provider>
  );
};

export function useDynamusic(): DynamusicContextType {
  const context = useContext(DynamusicContext);
  if (!context) {
    throw new Error("useDynamusic must be used within a DynamusicProvider");
  }
  return context;
}
