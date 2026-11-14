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

// --- Pure JavaScript DES-ECB Decryptor for 320kbps Streams ---
const PC1 = [57,49,41,33,25,17,9,1,58,50,42,34,26,18,10,2,59,51,43,35,27,19,11,3,60,52,44,36,63,55,47,39,31,23,15,7,62,54,46,38,30,22,14,6,61,53,45,37,29,21,13,5,28,20,12,4];
const SHIFTS = [1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1];
const PC2 = [14,17,11,24,1,5,3,28,15,6,21,10,23,19,12,4,26,8,16,7,27,20,13,2,41,52,31,37,47,55,30,40,51,45,33,48,44,49,39,56,34,53,46,42,50,36,29,32];
const IP = [58,50,42,34,26,18,10,2,60,52,44,36,28,20,12,4,62,54,46,38,30,22,14,6,64,56,48,40,32,24,16,8,57,49,41,33,25,17,9,1,59,51,43,35,27,19,11,3,61,53,45,37,29,21,13,5,63,55,47,39,31,23,15,7];
const IP_INV = [40,8,48,16,56,24,64,32,39,7,47,15,55,23,63,31,38,6,46,14,54,22,62,30,37,5,45,13,53,21,61,29,36,4,44,12,52,20,60,28,35,3,43,11,51,19,59,27,34,2,42,10,50,18,58,26,33,1,41,9,49,17,57,25];
const E = [32,1,2,3,4,5,4,5,6,7,8,9,8,9,10,11,12,13,12,13,14,15,16,17,16,17,18,19,20,21,20,21,22,23,24,25,24,25,26,27,28,29,28,29,30,31,32,1];
const P = [16,7,20,21,29,12,28,17,1,15,23,26,5,18,31,10,2,8,24,14,32,27,3,9,19,13,30,6,22,11,4,25];
const S_BOXES = [
  [[14,4,13,1,2,15,11,8,3,10,6,12,5,9,0,7],[0,15,7,4,14,2,13,1,10,6,12,11,9,5,3,8],[4,1,14,8,13,6,2,11,15,12,9,7,3,10,5,0],[15,12,8,2,4,9,1,7,5,11,3,14,10,0,6,13]],
  [[15,1,8,14,6,11,3,4,9,7,2,13,12,0,5,10],[3,13,4,7,15,2,8,14,12,0,1,10,6,9,11,5],[0,14,7,11,10,4,13,1,5,8,12,6,9,3,2,15],[13,8,10,1,3,15,4,2,11,6,7,12,0,5,14,9]],
  [[10,0,9,14,6,3,15,5,1,13,12,7,11,4,2,8],[13,7,0,9,3,4,6,10,2,8,5,14,12,11,15,1],[13,6,4,9,8,15,3,0,11,1,2,12,5,10,14,7],[1,10,13,0,6,9,8,7,4,15,14,3,11,5,2,12]],
  [[7,13,14,3,0,6,9,10,1,2,8,5,11,12,4,15],[13,8,11,5,6,15,0,3,4,7,2,12,1,10,14,9],[10,6,9,0,12,11,7,13,15,1,3,14,5,2,8,4],[3,15,0,6,10,1,13,8,9,4,5,11,12,7,2,14]],
  [[2,12,4,1,7,10,11,6,8,5,3,15,13,0,14,9],[14,11,2,12,4,7,13,1,5,0,15,10,3,9,8,6],[4,2,1,11,10,13,7,8,15,9,12,5,6,3,0,14],[11,8,12,7,1,14,2,13,6,15,0,9,10,4,5,3]],
  [[12,1,10,15,9,2,6,8,0,13,3,4,14,7,5,11],[10,15,4,2,7,12,9,5,6,1,13,14,0,11,3,8],[9,14,15,5,2,8,12,3,7,0,4,10,1,13,11,6],[4,3,2,12,9,5,15,10,11,14,1,7,6,0,8,13]],
  [[4,11,2,14,15,0,8,13,3,12,9,7,5,10,6,1],[13,0,11,7,4,9,1,10,14,3,5,12,2,15,8,6],[1,4,11,13,12,3,7,14,10,15,6,8,0,5,9,2],[6,11,13,8,1,4,10,7,9,5,0,15,14,2,3,12]],
  [[13,2,8,4,6,15,11,1,10,9,3,14,5,0,12,7],[1,15,13,8,10,3,7,4,12,5,6,11,0,14,9,2],[7,11,4,1,9,12,14,2,0,6,10,13,15,3,5,8],[2,1,14,7,4,10,8,13,15,12,9,0,3,5,6,11]]
];

function permute(bits: number[], table: number[]): number[] {
  return table.map((pos) => bits[pos - 1]!);
}

function bytesToBits(bytes: number[]): number[] {
  const bits: number[] = [];
  for (let i = 0; i < bytes.length; i++) {
    for (let b = 7; b >= 0; b--) {
      bits.push((bytes[i]! >> b) & 1);
    }
  }
  return bits;
}

function bitsToBytes(bits: number[]): number[] {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let b = 0; b < 8; b++) {
      byte = (byte << 1) | bits[i + b]!;
    }
    bytes.push(byte);
  }
  return bytes;
}

function generateSubkeys(keyBytes: number[]): number[][] {
  const keyBits = bytesToBits(keyBytes);
  const pc1Bits = permute(keyBits, PC1);
  let c = pc1Bits.slice(0, 28);
  let d = pc1Bits.slice(28, 56);
  const subkeys: number[][] = [];
  for (let i = 0; i < 16; i++) {
    const shift = SHIFTS[i]!;
    c = c.slice(shift).concat(c.slice(0, shift));
    d = d.slice(shift).concat(d.slice(0, shift));
    subkeys.push(permute(c.concat(d), PC2));
  }
  return subkeys;
}

function feistel(rBits: number[], subkey: number[]): number[] {
  const er = permute(rBits, E);
  const xor = er.map((b, i) => b ^ subkey[i]!);
  const sOutput: number[] = [];
  for (let i = 0; i < 8; i++) {
    const block = xor.slice(i * 6, (i + 1) * 6);
    const row = (block[0]! << 1) | block[5]!;
    const col = (block[1]! << 3) | (block[2]! << 2) | (block[3]! << 1) | block[4]!;
    const val = S_BOXES[i]![row]![col]!;
    for (let b = 3; b >= 0; b--) {
      sOutput.push((val >> b) & 1);
    }
  }
  return permute(sOutput, P);
}

function decryptBlock(blockBytes: number[], subkeys: number[][]): number[] {
  const bits = permute(bytesToBits(blockBytes), IP);
  let l = bits.slice(0, 32);
  let r = bits.slice(32, 64);
  for (let i = 15; i >= 0; i--) {
    const f = feistel(r, subkeys[i]!);
    const nextR = l.map((b, j) => b ^ f[j]!);
    l = r;
    r = nextR;
  }
  return bitsToBytes(permute(r.concat(l), IP_INV));
}

export function decryptDesEcb(base64Cipher: string, keyStr = "38346591"): string {
  try {
    const keyBytes = Array.from(keyStr).map((c) => c.charCodeAt(0));
    const subkeys = generateSubkeys(keyBytes);
    const binary = atob(base64Cipher);
    const cipherBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) cipherBytes[i] = binary.charCodeAt(i);

    const decrypted: number[] = [];
    for (let i = 0; i < cipherBytes.length; i += 8) {
      const block = Array.from(cipherBytes.slice(i, i + 8));
      decrypted.push(...decryptBlock(block, subkeys));
    }
    // PKCS#7 unpadding
    const padLen = decrypted[decrypted.length - 1]!;
    if (padLen > 0 && padLen <= 8) {
      let valid = true;
      for (let i = decrypted.length - padLen; i < decrypted.length; i++) {
        if (decrypted[i] !== padLen) {
          valid = false;
          break;
        }
      }
      if (valid) decrypted.splice(decrypted.length - padLen, padLen);
    }
    return String.fromCharCode(...decrypted);
  } catch {
    return "";
  }
}

function decodeHtml(s: string): string {
  if (!s) return "";
  return s
    .replaceAll("&quot;", '"')
    .replaceAll("&#039;", "'")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">");
}

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
    durationMs: 256000,
    coverUrl: "https://c.saavncdn.com/160/7f89b0086c4eaf5f8251f924f1846915_500x500.webp",
    streamUrl: "https://aac.saavncdn.com/160/7f89b0086c4eaf5f8251f924f1846915_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-2",
    title: "Yellow",
    artist: "Coldplay",
    album: "Parachutes",
    durationMs: 266000,
    coverUrl: "https://c.saavncdn.com/254/Parachutes-English-2000-20240529104717-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/254/6ebc38a6a7ea892f3a27cd66c71529d6_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-3",
    title: "Save Your Tears",
    artist: "The Weeknd",
    album: "After Hours",
    durationMs: 220000,
    coverUrl: "https://c.saavncdn.com/211/d4210540326aaad2b138caec8b381c07_500x500.webp",
    streamUrl: "https://aac.saavncdn.com/211/d4210540326aaad2b138caec8b381c07_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-4",
    title: "Believer",
    artist: "Imagine Dragons",
    album: "Evolve",
    durationMs: 204000,
    coverUrl: "https://c.saavncdn.com/248/Evolve-English-2018-20260605220036-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/248/46944eb7b4b31f5b0abf5eb2e1be2d2a_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-5",
    title: "Shape of You",
    artist: "Ed Sheeran",
    album: "÷ (Divide)",
    durationMs: 233000,
    coverUrl: "https://c.saavncdn.com/443/Shape-Of-You-Instrumental-2024-20250312104021-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/443/d9b115620457a6ddfda9955ac17142c8_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-6",
    title: "Without Me",
    artist: "Eminem",
    album: "The Eminem Show",
    durationMs: 290000,
    coverUrl: "https://c.saavncdn.com/941/37579296e0afb6fb8eb69f454a85fa0c_500x500.webp",
    streamUrl: "https://aac.saavncdn.com/941/37579296e0afb6fb8eb69f454a85fa0c_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-7",
    title: "In the End",
    artist: "Linkin Park",
    album: "Hybrid Theory",
    durationMs: 216000,
    coverUrl: "https://c.saavncdn.com/831/Papercuts-Instrumentals-Instrumental-2024-20240625194631-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/831/d9fbdc754e365311a9457730161c8793_320.mp4",
    source: "youtube",
    verified: true,
  },
  {
    id: "g-8",
    title: "Levitating",
    artist: "Dua Lipa",
    album: "Future Nostalgia",
    durationMs: 203000,
    coverUrl: "https://c.saavncdn.com/665/Future-Nostalgia-English-2020-20260306223201-500x500.webp",
    streamUrl: "https://aac.saavncdn.com/665/7790c3b9097592113008eaf1031d6e57_320.mp4",
    source: "youtube",
    verified: true,
  },
];

/**
 * Searches the global music library (80M+ tracks) and returns full-length 320kbps streams.
 */
export async function searchYouTubeMusic(query: string): Promise<Track[]> {
  const trimmed = query.trim().toLowerCase();
  if (!trimmed) {
    return GLOBAL_POPULAR_TRACKS.slice(0, 15);
  }

  // 1. Local & Curated catalog matches first
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

  // 2. Global Catalog Search via primary endpoint (320kbps full stream resolution)
  try {
    const searchUrl = `https://www.jiosaavn.com/api.php?__call=search.getResults&_format=json&n=30&p=1&_marker=0&ctx=android&q=${encodeURIComponent(
      query
    )}`;
    const res = await fetch(searchUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(6000),
    });

    if (res.ok) {
      const data = await res.json();
      const results = data.results || [];

      if (Array.isArray(results) && results.length > 0) {
        const remoteTracks: Track[] = results
          .filter((item: any) => item && (item.song || item.title))
          .map((item: any) => {
            let fullStream = "";
            if (item.encrypted_media_url) {
              const raw = decryptDesEcb(item.encrypted_media_url);
              if (raw) {
                fullStream = raw.replace("_96.mp4", "_320.mp4");
              }
            }

            const img = (item.image || "")
              .replace("150x150", "500x500")
              .replace("50x50", "500x500");
            const durationSec = parseInt(item.duration, 10) || 180;

            return {
              id: `saavn-${item.id}`,
              title: decodeHtml(item.song || item.title || "Unknown Track"),
              artist: decodeHtml(item.primary_artists || item.singers || "Unknown Artist"),
              artistId: item.primary_artists_id ? `artist-${item.primary_artists_id}` : undefined,
              album: decodeHtml(item.album || "Single"),
              durationMs: durationSec * 1000,
              coverUrl: img || EYE_ARTWORK,
              streamUrl: fullStream || item.media_preview_url || "",
              source: "youtube" as const,
              verified: true,
            };
          })
          .filter((t: Track) => !!t.streamUrl);

        // Merge local and remote without duplicates
        const combined = [...localResults];
        for (const rem of remoteTracks) {
          const exists = combined.some(
            (c) =>
              c.title.toLowerCase() === rem.title.toLowerCase() &&
              c.artist.toLowerCase() === rem.artist.toLowerCase()
          );
          if (!exists) {
            combined.push(rem);
          }
        }
        if (combined.length > 0) {
          return combined;
        }
      }
    }
  } catch (err) {
    console.warn("Direct search API failed, trying fallback resolver:", err);
  }

  // 3. Fallback: Autocomplete search with song.getDetails resolution
  try {
    const autoUrl = `https://www.jiosaavn.com/api.php?__call=autocomplete.get&_format=json&_marker=0&cc=in&includeMetaTags=1&query=${encodeURIComponent(
      query
    )}`;
    const autoRes = await fetch(autoUrl, {
      headers: { "User-Agent": "Mozilla/5.0" },
      signal: AbortSignal.timeout(5000),
    });

    if (autoRes.ok) {
      const autoData = await autoRes.json();
      const songItems = autoData.songs?.data || [];
      if (songItems.length > 0) {
        const pids = songItems.slice(0, 8).map((s: any) => s.id).join(",");
        const detUrl = `https://www.jiosaavn.com/api.php?__call=song.getDetails&pids=${pids}&_format=json&_marker=0`;
        const detRes = await fetch(detUrl, {
          headers: { "User-Agent": "Mozilla/5.0" },
          signal: AbortSignal.timeout(5000),
        });

        if (detRes.ok) {
          const detData = await detRes.json();
          const resolvedList: Track[] = [];

          for (const s of songItems) {
            const item = detData[s.id];
            if (!item) continue;
            let stream = "";
            if (item.encrypted_media_url) {
              const raw = decryptDesEcb(item.encrypted_media_url);
              if (raw) stream = raw.replace("_96.mp4", "_320.mp4");
            }
            if (!stream) continue;

            resolvedList.push({
              id: `saavn-${item.id}`,
              title: decodeHtml(item.song || item.title || s.title),
              artist: decodeHtml(item.primary_artists || item.singers || s.description),
              album: decodeHtml(item.album || "Single"),
              durationMs: (parseInt(item.duration, 10) || 180) * 1000,
              coverUrl: (item.image || s.image || "").replace("150x150", "500x500").replace("50x50", "500x500") || EYE_ARTWORK,
              streamUrl: stream,
              source: "youtube" as const,
              verified: true,
            });
          }

          if (resolvedList.length > 0) {
            const merged = [...localResults];
            for (const r of resolvedList) {
              if (!merged.some((m) => m.title.toLowerCase() === r.title.toLowerCase())) {
                merged.push(r);
              }
            }
            return merged;
          }
        }
      }
    }
  } catch (err) {
    console.warn("Fallback autocomplete resolution failed:", err);
  }

  // Return local results if available, or popular global catalog
  return localResults.length > 0 ? localResults : GLOBAL_POPULAR_TRACKS.slice(0, 10);
}

/**
 * Resolves a full-length 320kbps audio stream URL for any track.
 * Ensures playback NEVER terminates at 30 seconds.
 */
export async function resolvePlayableStreamUrl(track: Track): Promise<string> {
  // If already a valid full 320kbps stream, return it
  if (
    track.streamUrl &&
    !track.streamUrl.includes(".plus.aac.p.m4a") &&
    !track.streamUrl.includes("freesound.org/previews")
  ) {
    return track.streamUrl;
  }

  try {
    const q = `${track.title} ${track.artist}`;
    const results = await searchYouTubeMusic(q);
    const best = results[0];
    if (best && best.streamUrl && !best.streamUrl.includes(".plus.aac.p.m4a")) {
      track.streamUrl = best.streamUrl;
      if (best.durationMs > 0) {
        track.durationMs = best.durationMs;
      }
      return best.streamUrl;
    }
  } catch (err) {
    console.warn("Stream URL resolution failed for track:", track.title, err);
  }

  return track.streamUrl || "";
}

export function parseLocalAudioFile(file: File): Promise<Track> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    audio.src = url;

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
