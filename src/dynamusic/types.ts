export interface Track {
  id: string;
  title: string;
  artist: string;
  artistId?: string;
  album?: string;
  albumId?: string;
  durationMs: number;
  coverUrl: string;
  streamUrl?: string;
  source?: "youtube" | "local" | "demo" | "spotify";
  isLiked?: boolean;
  explicit?: boolean;
  verified?: boolean;
}

export interface LyricLine {
  timeMs: number;
  text: string;
}

export interface EqualizerPreset {
  name: string;
  gains: number[]; // 10 bands (-12dB to +12dB)
}

export interface ArtistProfile {
  id: string;
  name: string;
  thumb: string;
  banner: string;
  verified: boolean;
  monthlyListeners: string;
  subscribers?: string;
  bio: string;
  topTracks: Track[];
  albums: {
    id: string;
    title: string;
    year: string;
    thumb: string;
    type: "Album" | "Single" | "EP";
  }[];
}

export interface Playlist {
  id: string;
  title: string;
  subtitle: string;
  thumb: string;
  trackCount: number;
  pinned?: boolean;
  tracks: Track[];
}

export interface PlaylistFolder {
  id: string;
  name: string;
  subtitle: string;
  thumb: string;
  playlists: Playlist[];
}

export type NavView =
  | { name: "home" }
  | { name: "artist"; artistId: string }
  | { name: "album"; albumId: string }
  | { name: "playlist"; playlistId: string }
  | { name: "folder"; folderId: string }
  | { name: "liked" }
  | { name: "spotify" }
  | { name: "replay" }
  | { name: "local" }
  | { name: "downloads" }
  | { name: "search" };

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
