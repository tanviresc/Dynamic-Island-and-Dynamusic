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

