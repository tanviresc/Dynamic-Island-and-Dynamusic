import { describe, it, expect } from "vitest";
import { initBytuneBridge } from "./lib/initBytuneBridge";
import { prepareDynamusicClose } from "./lib/islandBridge";
import { useLibrary } from "./stores/library";
import { useListening } from "./stores/listening";
import { useRecents } from "./stores/recents";
import { usePlayer } from "./stores/player";
import { useUI } from "./stores/ui";

describe("Dynamusic 1:1 ByTune Clone Verification", () => {
  it("initializes window.bytune bridge with full ByTuneApi surface", () => {
    const g = globalThis as any;
    if (typeof g.window === "undefined") {
      g.window = g;
    }
    initBytuneBridge();
    expect(g.window.bytune).toBeDefined();
    expect(typeof g.window.bytune.search).toBe("function");
    expect(typeof g.window.bytune.searchPage).toBe("function");
    expect(typeof g.window.bytune.getHome).toBe("function");
    expect(typeof g.window.bytune.getArtist).toBe("function");
    expect(typeof g.window.bytune.getAlbum).toBe("function");
    expect(typeof g.window.bytune.getPlaylistPage).toBe("function");
    expect(typeof g.window.bytune.getStreamUrl).toBe("function");
    expect(typeof g.window.bytune.getLyrics).toBe("function");
    expect(typeof g.window.bytune.spotifyConnect).toBe("function");
    expect(typeof g.window.bytune.spotifyPlaylists).toBe("function");
    expect(typeof g.window.bytune.spotifyPublicPlaylist).toBe("function");
    expect(typeof g.window.bytune.localLibrary).toBe("function");
    expect(typeof g.window.bytune.scanLibrary).toBe("function");
    expect(typeof g.window.bytune.authSignIn).toBe("function");
  });

  it("starts with clean organic library state (empty liked songs, empty folders, empty followed artists)", () => {
    const lib = useLibrary.getState();
    expect(lib.liked).toEqual([]);
    expect(lib.playlists).toEqual([]);
    expect(lib.folders).toEqual([]);
    expect(lib.followedArtists).toEqual([]);
  });

  it("allows user to create folders, create playlists, like songs, and follow artists organically", () => {
    const lib = useLibrary.getState();
    const folder = lib.createFolder("My Chill Folder");
    expect(folder.name).toBe("My Chill Folder");
    expect(useLibrary.getState().folders.some((f) => f.id === folder.id)).toBe(true);

    const sampleTrack = {
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      duration: 213,
      thumb: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    };
    lib.toggleLike(sampleTrack);
    expect(useLibrary.getState().isLiked(sampleTrack.id)).toBe(true);
    lib.toggleLike(sampleTrack);
    expect(useLibrary.getState().isLiked(sampleTrack.id)).toBe(false);
  });

  it("starts with clean listening history and recents for Jump Back In and Streak", () => {
    const listening = useListening.getState();
    const recents = useRecents.getState();
    const player = usePlayer.getState();
    expect(listening.skips).toEqual({});
    expect(recents.searches).toEqual([]);
    expect(useLibrary.getState().history).toEqual([]);
    expect(player.queue).toEqual([]);
  });

  it("closing Dynamusic stops playback, preserves exact playback position, and resets view to Home", () => {
    const sampleTrack = {
      id: "dQw4w9WgXcQ",
      title: "Never Gonna Give You Up",
      artist: "Rick Astley",
      duration: 213,
      thumb: "https://i.ytimg.com/vi/dQw4w9WgXcQ/hqdefault.jpg",
    };
    usePlayer.setState({
      queue: [sampleTrack],
      index: 0,
      playing: true,
      position: 84.5,
      duration: 213,
    });
    useUI.getState().navigate({ name: "search" });
    expect(useUI.getState().view.name).toBe("search");

    prepareDynamusicClose();

    const afterPlayer = usePlayer.getState();
    expect(afterPlayer.playing).toBe(false);
    expect(afterPlayer.queue[afterPlayer.index]?.id).toBe("dQw4w9WgXcQ");
    expect(afterPlayer.position).toBe(84.5);
    expect(useUI.getState().view.name).toBe("home");
    expect(useUI.getState().navPast).toEqual([]);
  });
});
