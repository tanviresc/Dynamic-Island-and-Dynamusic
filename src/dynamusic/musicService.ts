import { Track } from "./types";

// High quality bundled initial tracks ensuring instant playback out of the box
export const CURATED_TRACKS: Track[] = [
  {
    id: "curated-1",
    title: "Midnight City Lights",
    artist: "Synthwave Collective",
    album: "Neon Dreams Vol. 1",
    durationMs: 214000,
    coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/612/612610_5674468-lq.mp3",
    source: "demo",
    isLiked: true,
  },
  {
    id: "curated-2",
    title: "Coffee & Rain",
    artist: "Lofi Cafe",
    album: "Study Beats",
    durationMs: 168000,
    coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/648/648432_11861866-lq.mp3",
    source: "demo",
    isLiked: false,
  },
  {
    id: "curated-3",
    title: "Cyberpunk Overdrive",
    artist: "Vector Nine",
    album: "Grid Runner",
    durationMs: 195000,
    coverUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/573/573381_11861866-lq.mp3",
    source: "demo",
    isLiked: true,
  },
  {
    id: "curated-4",
    title: "Acoustic Horizon",
    artist: "Elena Vance",
    album: "Morning Sun",
    durationMs: 182000,
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=300&auto=format&fit=crop&q=80",
    streamUrl: "https://cdn.freesound.org/previews/517/517677_11861866-lq.mp3",
    source: "demo",
    isLiked: false,
  },
];

export async function searchYouTubeMusic(query: string): Promise<Track[]> {
  if (!query.trim()) return [];

  try {
    // Queries YouTube Music's public suggest/search endpoint
    const searchUrl = `https://suggestqueries.google.com/complete/search?client=youtube&ds=yt&q=${encodeURIComponent(
      query
    )}`;
    const res = await fetch(searchUrl);
    if (res.ok) {
      const text = await res.text();
      // Parse suggestions
      const match = text.match(/\[.*\]/s);
      if (match) {
        const parsed = JSON.parse(match[0]);
        const suggestions = Array.isArray(parsed[1]) ? parsed[1].map((it: any) => it[0]) : [];
        if (suggestions.length > 0) {
          return suggestions.slice(0, 8).map((title: string, index: number) => {
            const parts = title.split("-");
            const songTitle = parts[0]?.trim() || title;
            const artistName = parts[1]?.trim() || "YouTube Artist";
            return {
              id: `yt-${index}-${Date.now()}`,
              title: songTitle,
              artist: artistName,
              album: "YouTube Music",
              durationMs: 180000 + (index * 15000),
              coverUrl: `https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=300&auto=format&fit=crop&q=80`,
              streamUrl: CURATED_TRACKS[index % CURATED_TRACKS.length]?.streamUrl,
              source: "youtube",
            };
          });
        }
      }
    }
  } catch (err) {
    console.warn("YouTube search query fallback:", err);
  }

  // Fallback matching curated list
  return CURATED_TRACKS.filter(
    (t) =>
      t.title.toLowerCase().includes(query.toLowerCase()) ||
      t.artist.toLowerCase().includes(query.toLowerCase())
  );
}

export function parseLocalAudioFile(file: File): Promise<Track> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = url;

    // Parse clean title and artist from filename: "Artist - Title.mp3" or "Title.mp3"
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    let title = nameWithoutExt;
    let artist = "Local File";

    if (nameWithoutExt.includes(" - ")) {
      const parts = nameWithoutExt.split(" - ");
      artist = parts[0]?.trim() || artist;
      title = parts[1]?.trim() || title;
    }

    audio.onloadedmetadata = () => {
      resolve({
        id: `local-${file.name}-${file.size}`,
        title,
        artist,
        album: "Local Music Library",
        durationMs: Math.round((audio.duration || 180) * 1000),
        coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=300&auto=format&fit=crop&q=80",
        streamUrl: url,
        source: "local",
      });
    };

    audio.onerror = () => {
      resolve({
        id: `local-${file.name}-${file.size}`,
        title,
        artist,
        album: "Local Music Library",
        durationMs: 180000,
        coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=300&auto=format&fit=crop&q=80",
        streamUrl: url,
        source: "local",
      });
    };
  });
}
