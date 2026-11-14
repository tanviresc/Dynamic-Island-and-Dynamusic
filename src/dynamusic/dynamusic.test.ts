import { describe, it, expect } from "vitest";
import { parseLrc, getCurrentLyric } from "./lyricsService";
import { EQ_FREQUENCIES, EQ_PRESETS } from "./audioEngine";
import {
  TEMPER_CITY_ARTIST,
  JUMP_BACK_IN_TRACKS,
  LIKED_SONGS,
  PLAYLISTS_FOR_YOU,
  SPOTIFY_PLAYLISTS,
  USER_FOLDERS,
  ARTISTS_DATABASE,
} from "./initialData";

describe("Dynamusic LRCLIB Synced Lyrics Parser", () => {
  it("parses valid LRC format timestamps correctly", () => {
    const lrc = `
[00:12.30]First line of the song
[00:18.50]Second line with feeling
[01:05.123]Chorus drops here
    `.trim();

    const result = parseLrc(lrc);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({
      timeMs: 12300,
      text: "First line of the song",
    });
    expect(result[1]).toEqual({
      timeMs: 18500,
      text: "Second line with feeling",
    });
    expect(result[2]).toEqual({
      timeMs: 65123,
      text: "Chorus drops here",
    });
  });

  it("handles unsorted lines by returning them in chronological order", () => {
    const lrc = `
[00:25.00]Line 2
[00:10.00]Line 1
    `.trim();

    const result = parseLrc(lrc);
    expect(result[0]?.text).toBe("Line 1");
    expect(result[1]?.text).toBe("Line 2");
  });

  it("finds the exact active lyric line based on current playback timestamp", () => {
    const lyrics = [
      { timeMs: 10000, text: "Verse 1 start" },
      { timeMs: 20000, text: "Verse 1 middle" },
      { timeMs: 30000, text: "Chorus" },
    ];

    expect(getCurrentLyric(lyrics, 5000).current).toBeNull();
    expect(getCurrentLyric(lyrics, 10000).current?.text).toBe("Verse 1 start");
    expect(getCurrentLyric(lyrics, 15000).current?.text).toBe("Verse 1 start");
    expect(getCurrentLyric(lyrics, 25000).current?.text).toBe("Verse 1 middle");
    expect(getCurrentLyric(lyrics, 40000).current?.text).toBe("Chorus");
  });
});

describe("Dynamusic 10-Band Graphic Equalizer", () => {
  it("defines standard 10 audio frequency bands from 32Hz to 16kHz", () => {
    expect(EQ_FREQUENCIES).toEqual([32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000]);
    expect(EQ_FREQUENCIES).toHaveLength(10);
  });

  it("provides valid presets with exactly 10 gain values between -12dB and +12dB", () => {
    expect(EQ_PRESETS.length).toBeGreaterThanOrEqual(5);

    for (const preset of EQ_PRESETS) {
      expect(preset.gains).toHaveLength(10);
      for (const gain of preset.gains) {
        expect(gain).toBeGreaterThanOrEqual(-12);
        expect(gain).toBeLessThanOrEqual(12);
      }
    }
  });

  it("has Flat preset with all zero gains", () => {
    const flat = EQ_PRESETS.find((p) => p.name === "Flat");
    expect(flat).toBeDefined();
    expect(flat!.gains.every((g) => g === 0)).toBe(true);
  });
});

describe("Dynamusic Initial Replica Database (Matching ByTune Screenshot)", () => {
  it("includes all 6 exact Jump back in cards from the screenshot", () => {
    expect(JUMP_BACK_IN_TRACKS).toHaveLength(6);
    expect(JUMP_BACK_IN_TRACKS[0]?.title).toBe("Self Aware");
    expect(JUMP_BACK_IN_TRACKS[0]?.artist).toBe("Temper City");
    expect(JUMP_BACK_IN_TRACKS[1]?.title).toBe("Blinding Lights");
    expect(JUMP_BACK_IN_TRACKS[2]?.title).toBe("I Want You Back");
    expect(JUMP_BACK_IN_TRACKS[3]?.title).toBe("Billie Jean");
    expect(JUMP_BACK_IN_TRACKS[4]?.title).toBe("September");
    expect(JUMP_BACK_IN_TRACKS[5]?.title).toBe("Gimme! Gimme! Gimme! (A Man After Midnight)");
  });

  it("includes the 9 Liked songs imported from Spotify", () => {
    expect(LIKED_SONGS).toHaveLength(9);
    for (const song of LIKED_SONGS) {
      expect(song.isLiked).toBe(true);
      expect(song.source).toBe("spotify");
    }
  });

  it("has Temper City verified artist profile with top tracks, monthly listeners, and bio", () => {
    expect(TEMPER_CITY_ARTIST.name).toBe("Temper City");
    expect(TEMPER_CITY_ARTIST.verified).toBe(true);
    expect(TEMPER_CITY_ARTIST.monthlyListeners).toBe("135M monthly listeners");
    expect(TEMPER_CITY_ARTIST.topTracks.length).toBeGreaterThanOrEqual(5);
    expect(TEMPER_CITY_ARTIST.bio).toContain("Israeli alternative rock band");
    expect(ARTISTS_DATABASE["temper-city"]).toBeDefined();
  });

  it("has user folders and connected Spotify playlists", () => {
    expect(USER_FOLDERS).toHaveLength(1);
    expect(USER_FOLDERS[0]?.name).toBe("folder");
    expect(USER_FOLDERS[0]?.playlists).toHaveLength(2);
    expect(SPOTIFY_PLAYLISTS).toHaveLength(4);
    expect(PLAYLISTS_FOR_YOU.length).toBeGreaterThanOrEqual(6);
  });
});
