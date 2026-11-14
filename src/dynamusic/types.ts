export interface Track {
  id: string;
  title: string;
  artist: string;
  album?: string;
  durationMs: number;
  coverUrl: string;
  streamUrl?: string;
  source: "youtube" | "local" | "demo";
  isLiked?: boolean;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface EqualizerPreset {
  name: string;
  gains: number[]; // 10 bands (-12dB to +12dB)
}

export interface RoomParticipant {
  id: string;
  name: string;
  isHost: boolean;
  avatarColor: string;
}

export interface ListenTogetherRoom {
  code: string;
  name: string;
  hostName: string;
  participants: RoomParticipant[];
  track?: Track;
  isPlaying: boolean;
  positionMs: number;
}

export interface IPCMusicState {
  title: string;
  artist: string;
  album?: string;
  albumArt?: string;
  isPlaying: boolean;
  positionMs: number;
  durationMs: number;
  volume: number;
  lyricsCurrentLine?: string;
}
