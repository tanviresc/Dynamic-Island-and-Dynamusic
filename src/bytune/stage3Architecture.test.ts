import { beforeEach, describe, expect, it } from "vitest";
import { cleanTrackQuery, cleanTrackTitle } from "./lib/mobileStandaloneFallback";
import { buildLyricsCacheKeys, getCachedLyrics, saveCachedLyrics } from "./lib/lyricsCache";
import { processHierarchicalBack, resetBackExitTimer, type BackUIAdapter } from "./lib/backNavigation";
import { usePlayer } from "./stores/player";
import type { Track } from "./types";

function makeTrack(id: string, title = `Track ${id}`, artist = "Artist"): Track {
  return {
    id,
    title,
    artist,
    album: "Album",
    duration: 210,
    thumb: `https://example.com/${id}.jpg`,
  };
}

describe("Stage 3 architectural guarantees", () => {
  describe("Query & metadata sanitization", () => {
    it("strips noisy video tags and feat clauses from titles and extracts primary artist", () => {
      expect(cleanTrackTitle("Finding Her (Official Music Video) [4K] (feat. X)")).toBe("Finding Her");
      expect(cleanTrackTitle("Sweater Weather - Remastered 2023")).toBe("Sweater Weather");
      expect(cleanTrackQuery("Aarzu [Official Audio] (feat. A)", "Noor, Khan & Madhurxo")).toEqual({
        title: "Aarzu",
        artist: "Noor",
      });
    });
  });

  describe("Persistent lyrics cache", () => {
    it("normalizes cache keys by track ID and cleaned metadata and persists across reads", async () => {
      const keys = buildLyricsCacheKeys({
        id: "vid123",
        title: "Solo (Official Video) (feat. Demi Lovato)",
        artist: "Clean Bandit & Demi Lovato",
      });
      expect(keys).toEqual(["id:vid123", "meta:solo|clean bandit"]);

      await saveCachedLyrics(
        { id: "vid123", title: "Solo (Official Video)", artist: "Clean Bandit" },
        { plain: "It's Friday night", synced: null, source: "LRCLIB" }
      );
      const hit = await getCachedLyrics({
        id: "",
        title: "Solo [HD]",
        artist: "Clean Bandit, Guest",
      });
      expect(hit).toEqual({ plain: "It's Friday night", synced: null, source: "LRCLIB" });
    });
  });

  describe("Hierarchical Android back navigation stack", () => {
    function makeAdapter(overrides: Partial<BackUIAdapter> = {}): {
      adapter: BackUIAdapter;
      calls: string[];
    } {
      const calls: string[] = [];
      const adapter: BackUIAdapter = {
        contextMenu: null,
        dialog: null,
        playlistPicker: null,
        rightPanel: "details",
        viewName: "home",
        searchQuery: "",
        lyricsCenter: false,
        nowPlayingOpen: false,
        navPastLength: 0,
        closeContextMenu: () => calls.push("closeContextMenu"),
        closeDialog: () => calls.push("closeDialog"),
        closePlaylistPicker: () => calls.push("closePlaylistPicker"),
        closePanels: () => calls.push("closePanels"),
        setSearchQuery: () => calls.push("clearSearch"),
        toggleLyrics: () => calls.push("closeLyrics"),
        toggleNowPlaying: () => calls.push("closeNowPlaying"),
        goBack: () => calls.push("goBack"),
        goHome: () => calls.push("goHome"),
        showExitToast: () => calls.push("showExitToast"),
        minimizeApp: () => calls.push("minimizeApp"),
        ...overrides,
      };
      return { adapter, calls };
    }

    beforeEach(() => {
      resetBackExitTimer();
    });

    it("unwinds strictly from topmost overlays -> lyrics -> now playing -> search query -> nav stack -> home -> double-tap exit", () => {
      const s1 = makeAdapter({ contextMenu: {}, dialog: {}, lyricsCenter: true, nowPlayingOpen: true });
      expect(processHierarchicalBack(s1.adapter, 1000)).toBe("closed_overlay");
      expect(s1.calls).toEqual(["closeContextMenu"]);

      const s2 = makeAdapter({ lyricsCenter: true, nowPlayingOpen: true });
      expect(processHierarchicalBack(s2.adapter, 1000)).toBe("closed_lyrics");
      expect(s2.calls).toEqual(["closeLyrics"]);

      const s3 = makeAdapter({ nowPlayingOpen: true, navPastLength: 2, viewName: "playlist" });
      expect(processHierarchicalBack(s3.adapter, 1000)).toBe("closed_now_playing");
      expect(s3.calls).toEqual(["closeNowPlaying"]);

      const s4 = makeAdapter({ viewName: "search", searchQuery: "tame impala", navPastLength: 1 });
      expect(processHierarchicalBack(s4.adapter, 1000)).toBe("closed_overlay");
      expect(s4.calls).toEqual(["clearSearch"]);

      const s5 = makeAdapter({ viewName: "album", navPastLength: 2 });
      expect(processHierarchicalBack(s5.adapter, 1000)).toBe("popped_nav");
      expect(s5.calls).toEqual(["goBack"]);

      const s6 = makeAdapter({ viewName: "library", navPastLength: 0 });
      expect(processHierarchicalBack(s6.adapter, 1000)).toBe("navigated_home");
      expect(s6.calls).toEqual(["goHome"]);

      const s7 = makeAdapter({ viewName: "home", navPastLength: 0 });
      expect(processHierarchicalBack(s7.adapter, 1000)).toBe("prompted_exit");
      expect(processHierarchicalBack(s7.adapter, 1800)).toBe("minimized");
      expect(s7.calls).toEqual(["showExitToast", "minimizeApp"]);
    });
  });

  describe("Dual-layer queue ordering and instant loading status", () => {
    it("drains priorityQueue ahead of contextQueue and sets immediate loading status", () => {
      const p1 = makeTrack("p1");
      const p2 = makeTrack("p2");
      const q1 = makeTrack("q1");
      const u1 = makeTrack("u1");

      const store = usePlayer.getState();
      store.playQueue([p1, p2], 0, "playlist:1");
      expect(usePlayer.getState().currentTrack?.id).toBe("p1");
      expect(usePlayer.getState().playbackStatus).toBe("loading");

      store.addToQueue([q1], false);
      store.addToQueue([u1], true);

      // Next track must come from priorityQueue ("u1"), followed by "q1", before resuming contextQueue ("p2")
      store.next(true);
      expect(usePlayer.getState().currentTrack?.id).toBe("u1");
      expect(usePlayer.getState().playbackStatus).toBe("loading");

      store.next(true);
      expect(usePlayer.getState().currentTrack?.id).toBe("q1");

      store.next(true);
      expect(usePlayer.getState().currentTrack?.id).toBe("p2");
    });
  });
});
