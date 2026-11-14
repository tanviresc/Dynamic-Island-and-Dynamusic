import { Track } from "./types";
import {
  JUMP_BACK_IN_TRACKS,
  LIKED_SONGS,
  TEMPER_CITY_ARTIST,
  CALVIN_HARRIS_ARTIST,
  ARCTIC_MONKEYS_ARTIST,
  ARIANA_GRANDE_ARTIST,
  EYE_ARTWORK,
} from "./initialData";

export const GLOBAL_POPULAR_TRACKS: Track[] = [
  ...JUMP_BACK_IN_TRACKS,
  ...LIKED_SONGS,
  ...TEMPER_CITY_ARTIST.topTracks,
  ...CALVIN_HARRIS_ARTIST.topTracks,
  ...ARCTIC_MONKEYS_ARTIST.topTracks,
  ...ARIANA_GRANDE_ARTIST.topTracks,
  {
    id: "g-1",
    title: "Viva La Vida",
    artist: "Coldplay",
    album: "Viva La Vida or Death and All His Friends",
    durationMs: 242000,
    coverUrl: "https://images.unsplash.com/photo-1518495973542-4542c06a5843?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/a3/30/8e/a3308eed-660c-1dbd-22f3-c59bf6b3be37/mzaf_17734898382909562725.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-2",
    title: "Yellow",
    artist: "Coldplay",
    album: "Parachutes",
    durationMs: 266000,
    coverUrl: "https://images.unsplash.com/photo-1508739773434-c26b3d09e071?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview221/v4/66/f3/1a/66f31a76-e17f-1d42-efc8-5b485303dfc8/mzaf_16238321200373079017.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-3",
    title: "Save Your Tears",
    artist: "The Weeknd",
    album: "After Hours",
    durationMs: 215000,
    coverUrl: "https://images.unsplash.com/photo-1514525253161-7a46d19cd819?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/d5/8b/63/d58b63ce-7f05-728b-a496-e14f9d27a1c3/mzaf_15096572733989395240.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-4",
    title: "Believer",
    artist: "Imagine Dragons",
    album: "Evolve",
    durationMs: 204000,
    coverUrl: "https://images.unsplash.com/photo-1470225620780-dba8ba36b745?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/28/65/52/286552a4-b97c-d641-7b0b-22d7fe89f7f4/mzaf_15801752495914619472.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-5",
    title: "Shape of You",
    artist: "Ed Sheeran",
    album: "÷ (Divide)",
    durationMs: 233000,
    coverUrl: "https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/80/7e/8e/807e8e97-40ad-a0a6-1216-e414168c17b5/mzaf_13506141381226065545.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-6",
    title: "Cruel Summer",
    artist: "Taylor Swift",
    album: "Lover",
    durationMs: 178000,
    coverUrl: "https://images.unsplash.com/photo-1618005182384-a83a8bd57fbe?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/71/39/29/71392942-5f34-3158-b807-fcf87dbd7671/mzaf_11306355883204481076.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-7",
    title: "In the End",
    artist: "Linkin Park",
    album: "Hybrid Theory",
    durationMs: 216000,
    coverUrl: "https://images.unsplash.com/photo-1494232410401-ad00d5433cfa?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview125/v4/65/59/05/655905d4-4b53-48b9-8c66-411a0da16671/mzaf_6403980327318854483.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-8",
    title: "Levitating",
    artist: "Dua Lipa",
    album: "Future Nostalgia",
    durationMs: 203000,
    coverUrl: "https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=400&auto=format&fit=crop&q=80",
    streamUrl: "https://audio-ssl.itunes.apple.com/itunes-assets/AudioPreview115/v4/e5/2d/a9/e52da937-25e4-7d52-2fc4-219ec2d0111e/mzaf_10332882260682229555.plus.aac.p.m4a",
    source: "youtube",
    verified: true,
  },
];

export async function searchYouTubeMusic(query: string): Promise<Track[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return GLOBAL_POPULAR_TRACKS.slice(0, 15);
  }

  // 1. Local catalog matching (instant, reliable, works offline)
  const seenIds = new Set<string>();
  const localResults: Track[] = [];

  for (const t of GLOBAL_POPULAR_TRACKS) {
    if (seenIds.has(t.id)) continue;
    const match =
      t.title.toLowerCase().includes(trimmed) ||
      t.artist.toLowerCase().includes(trimmed) ||
      (t.album && t.album.toLowerCase().includes(trimmed));
    if (match) {
      seenIds.add(t.id);
      localResults.push(t);
    }
  }

  // 2. Query Apple/iTunes Global Music Catalog (100M+ real tracks with audio streams)
  try {
    const itunesUrl = `https://itunes.apple.com/search?term=${encodeURIComponent(
      query
    )}&media=music&entity=song&limit=30`;
    const res = await fetch(itunesUrl);
    if (res.ok) {
      const data = await res.json();
      if (Array.isArray(data.results) && data.results.length > 0) {
        const remoteTracks: Track[] = data.results.map((item: any, i: number) => {
          const highResArt = (item.artworkUrl100 || "").replace(
            "100x100bb",
            "600x600bb"
          );
          return {
            id: `itunes-${item.trackId || i}`,
            title: item.trackName || "Unknown Song",
            artist: item.artistName || "Unknown Artist",
            artistId: item.artistId ? `art-${item.artistId}` : undefined,
            album: item.collectionName || "Single",
            durationMs: item.trackTimeMillis || 180000,
            coverUrl: highResArt || EYE_ARTWORK,
            streamUrl: item.previewUrl,
            source: "youtube",
            verified: true,
          };
        });

        // Filter out duplicates and merge
        const combined = [...remoteTracks];
        for (const loc of localResults) {
          const exists = combined.some(
            (c) =>
              c.title.toLowerCase() === loc.title.toLowerCase() &&
              c.artist.toLowerCase() === loc.artist.toLowerCase()
          );
          if (!exists) {
            combined.unshift(loc);
          }
        }
        return combined;
      }
    }
  } catch (err) {
    console.warn("Global catalog search failed, using local database:", err);
  }

  return localResults.length > 0 ? localResults : GLOBAL_POPULAR_TRACKS.slice(0, 10);
}

export function parseLocalAudioFile(file: File): Promise<Track> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = url;

    // Parse clean title and artist from filename: "Artist - Title.mp3" or "Title.mp3"
    const nameWithoutExt = file.name.replace(/\.[^/.]+$/, "");
    let title = nameWithoutExt;
    let artist = "Local Device";

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
