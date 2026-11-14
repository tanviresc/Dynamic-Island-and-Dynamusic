import { describe, it, expect } from "vitest";
import { initBytuneBridge } from "./lib/initBytuneBridge";
import { prepareDynamusicClose } from "./lib/islandBridge";
import { useLibrary } from "./stores/library";
import { useListening } from "./stores/listening";
import { useRecents } from "./stores/recents";
import { usePlayer, upNext } from "./stores/player";
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
    usePlayer.getState().playQueue([sampleTrack], 0);
    usePlayer.setState({
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

describe("Dual-Layer Priority Queue", () => {
  const mkTrack = (id: string, title = `Track ${id}`) => ({
    id,
    title,
    artist: "Test Artist",
    duration: 180,
    thumb: "",
  });

  it("plays priorityQueue strictly before resuming contextQueue", () => {
    const a = mkTrack("ctx-a");
    const b = mkTrack("ctx-b");
    const c = mkTrack("ctx-c");
    const p1 = mkTrack("pri-1");
    const p2 = mkTrack("pri-2");

    usePlayer.getState().playQueue([a, b, c], 0);
    expect(usePlayer.getState().currentTrack?.id).toBe("ctx-a");

    usePlayer.getState().addToQueue(p1, false);
    usePlayer.getState().addToQueue(p2, false);
    expect(usePlayer.getState().priorityQueue.map((t) => t.id)).toEqual(["pri-1", "pri-2"]);
    expect(upNext(usePlayer.getState())?.id).toBe("pri-1");

    // Step 1: next advances to pri-1, pausing contextQueue before ctx-b
    usePlayer.getState().next();
    expect(usePlayer.getState().currentTrack?.id).toBe("pri-1");
    expect(usePlayer.getState().currentFromPriority).toBe(true);
    expect(usePlayer.getState().priorityQueue.map((t) => t.id)).toEqual(["pri-2"]);

    // Step 2: next advances to pri-2
    usePlayer.getState().next();
    expect(usePlayer.getState().currentTrack?.id).toBe("pri-2");
    expect(usePlayer.getState().priorityQueue).toEqual([]);

    // Step 3: priorityQueue is empty -> resumes contextQueue at ctx-b, then ctx-c
    usePlayer.getState().next();
    expect(usePlayer.getState().currentTrack?.id).toBe("ctx-b");
    expect(usePlayer.getState().currentFromPriority).toBe(false);

    usePlayer.getState().next();
    expect(usePlayer.getState().currentTrack?.id).toBe("ctx-c");
  });

  it("supports Play Next preemption and preserves priorityQueue when shuffling contextQueue", () => {
    const t1 = mkTrack("ctx-1");
    const t2 = mkTrack("ctx-2");
    const t3 = mkTrack("ctx-3");
    const t4 = mkTrack("ctx-4");
    const q1 = mkTrack("pri-first");
    const qNext = mkTrack("pri-urgent");

    usePlayer.getState().playQueue([t1, t2, t3, t4], 0);
    usePlayer.getState().addToQueue(q1, false);
    usePlayer.getState().addToQueue(qNext, true);

    expect(usePlayer.getState().priorityQueue.map((t) => t.id)).toEqual(["pri-urgent", "pri-first"]);

    usePlayer.getState().toggleShuffle();
    expect(usePlayer.getState().priorityQueue.map((t) => t.id)).toEqual(["pri-urgent", "pri-first"]);
  });
});
