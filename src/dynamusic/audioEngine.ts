import { Track, EqualizerPreset } from "./types";

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS: EqualizerPreset[] = [
  { name: "Flat", gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0] },
  { name: "Bass Boost", gains: [7, 6, 5, 2, 0, 0, 0, 1, 2, 3] },
  { name: "Electronic", gains: [5, 4, 2, 0, -2, 2, 1, 3, 4, 5] },
  { name: "Rock", gains: [4, 3, 2, -1, -2, 1, 2, 3, 4, 4] },
  { name: "Pop", gains: [-1, 1, 3, 4, 4, 2, -1, -1, 1, 2] },
  { name: "Vocal Boost", gains: [-3, -2, -1, 2, 4, 5, 4, 2, 0, -1] },
  { name: "Acoustic", gains: [3, 3, 2, 1, 2, 2, 3, 3, 3, 2] },
];

export type AudioEventListener = (event: {
  currentTimeMs: number;
  durationMs: number;
  isPlaying: boolean;
  hasEnded: boolean;
}) => void;

class DynamusicAudioEngine {
  private audio: HTMLAudioElement | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaElementAudioSourceNode | null = null;
  private eqFilters: BiquadFilterNode[] = [];
  private gainNode: GainNode | null = null;
  private analyserNode: AnalyserNode | null = null;
  private listeners: Set<AudioEventListener> = new Set();
  private isInitialized = false;

  constructor() {
    this.getAudio();
  }

  private getAudio(): HTMLAudioElement | null {
    if (!this.audio && typeof window !== "undefined" && typeof Audio !== "undefined") {
      this.audio = new Audio();
      this.audio.crossOrigin = "anonymous";
      this.audio.preload = "auto";

      this.audio.addEventListener("timeupdate", () => this.notify());
      this.audio.addEventListener("playing", () => this.notify());
      this.audio.addEventListener("pause", () => this.notify());
      this.audio.addEventListener("ended", () => this.notify(true));
    }
    return this.audio;
  }

  private initAudioContext() {
    if (this.isInitialized || typeof window === "undefined") return;

    try {
      const AudioCtxClass = window.AudioContext || (window as any).webkitAudioContext;
      const audio = this.getAudio();
      if (!AudioCtxClass || !audio) return;

      this.audioCtx = new AudioCtxClass();
      this.sourceNode = this.audioCtx.createMediaElementSource(audio);

      // Create 10-band graphic equalizer
      this.eqFilters = EQ_FREQUENCIES.map((freq, idx) => {
        const filter = this.audioCtx!.createBiquadFilter();
        if (idx === 0) {
          filter.type = "lowshelf";
        } else if (idx === EQ_FREQUENCIES.length - 1) {
          filter.type = "highshelf";
        } else {
          filter.type = "peaking";
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = 0;
        return filter;
      });

      // Volume Gain
      this.gainNode = this.audioCtx.createGain();
      this.gainNode.gain.value = 1.0;

      // Realtime Analyser for visualizer
      this.analyserNode = this.audioCtx.createAnalyser();
      this.analyserNode.fftSize = 64;
      this.analyserNode.smoothingTimeConstant = 0.8;

      // Connect graph: source -> filter0 -> ... -> filter9 -> gain -> analyser -> destination
      let prevNode: AudioNode = this.sourceNode;
      for (const filter of this.eqFilters) {
        prevNode.connect(filter);
        prevNode = filter;
      }
      prevNode.connect(this.gainNode);
      this.gainNode.connect(this.analyserNode);
      this.analyserNode.connect(this.audioCtx.destination);

      this.isInitialized = true;
    } catch (err) {
      console.warn("Web Audio context initialization deferred until user gesture:", err);
    }
  }

  public async load(track: Track, autoPlay = true) {
    this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }

    const audio = this.getAudio();
    if (audio && track.streamUrl) {
      audio.src = track.streamUrl;
      audio.load();
      if (autoPlay) {
        try {
          await audio.play();
        } catch {
          // Playback blocked pending user gesture
        }
      }
    }
  }

  public async play() {
    this.initAudioContext();
    if (this.audioCtx && this.audioCtx.state === "suspended") {
      await this.audioCtx.resume();
    }
    const audio = this.getAudio();
    return audio ? audio.play() : Promise.resolve();
  }

  public pause() {
    this.getAudio()?.pause();
  }

  public togglePlay() {
    const audio = this.getAudio();
    if (!audio) return;
    if (audio.paused) {
      this.play();
    } else {
      this.pause();
    }
  }

  public seek(positionMs: number) {
    const audio = this.getAudio();
    if (audio) {
      audio.currentTime = positionMs / 1000;
    }
  }

  public setVolume(volume: number) {
    const clamped = Math.max(0, Math.min(1, volume));
    const audio = this.getAudio();
    if (audio) {
      audio.volume = clamped;
    }
    if (this.gainNode && this.audioCtx) {
      this.gainNode.gain.setValueAtTime(clamped, this.audioCtx.currentTime);
    }
  }

  public setEqGains(gains: number[]) {
    this.initAudioContext();
    if (!this.eqFilters.length) return;
    gains.forEach((gain, index) => {
      const filter = this.eqFilters[index];
      if (filter && this.audioCtx) {
        filter.gain.setValueAtTime(gain, this.audioCtx.currentTime);
      }
    });
  }

  public getVisualizerLevels(barCount = 4): number[] {
    const audio = this.getAudio();
    if (!this.analyserNode || !audio || audio.paused) {
      return Array(barCount).fill(0.08);
    }

    const buffer = new Uint8Array(this.analyserNode.frequencyBinCount);
    this.analyserNode.getByteFrequencyData(buffer);

    const step = Math.floor(buffer.length / barCount);
    const levels: number[] = [];

    for (let i = 0; i < barCount; i++) {
      let sum = 0;
      for (let j = 0; j < step; j++) {
        sum += buffer[i * step + j] || 0;
      }
      const avg = sum / step / 255;
      levels.push(Math.max(0.1, avg));
    }

    return levels;
  }

  public subscribe(listener: AudioEventListener) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(hasEnded = false) {
    const audio = this.getAudio();
    const state = {
      currentTimeMs: Math.round((audio?.currentTime || 0) * 1000),
      durationMs: Math.round((audio?.duration || 0) * 1000),
      isPlaying: audio ? !audio.paused && !audio.ended : false,
      hasEnded,
    };
    for (const listener of this.listeners) {
      listener(state);
    }
  }

  public getCurrentTimeMs(): number {
    return Math.round((this.getAudio()?.currentTime || 0) * 1000);
  }

  public getDurationMs(): number {
    return Math.round((this.getAudio()?.duration || 0) * 1000);
  }

  public isPlaying(): boolean {
    const audio = this.getAudio();
    return audio ? !audio.paused && !audio.ended : false;
  }
}

export const audioEngine = new DynamusicAudioEngine();
