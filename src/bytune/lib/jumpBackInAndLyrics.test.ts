import { describe, expect, it } from "vitest";
import { DAY_MS, jumpBackInTracks, type JournalEntry } from "./recs/taste";
import { buildLineWordModel, easeMelodyProgress } from "./wordTiming";
import { nearestMiddleCardIndex } from "../components/Crate";
import { usePlayer } from "../stores/player";
import { queueTrackPriorityWithToast } from "./trackActions";
import type { Track } from "../types";

function track(id: string, title = `Song ${id}`, artist = `Artist ${id}`): Track {
  return { id, title, artist, duration: 200, thumb: `https://img/${id}.jpg` };
}

describe("jumpBackInTracks rolling 2-day frequency ranking", () => {
  it("prioritizes most frequently played tracks within the last 2 days over older listens", () => {
    const now = 1_700_000_000_000;
    const tA = track("A");
    const tB = track("B");
    const tC = track("C");
    const tOld = track("OLD");

    const entries: JournalEntry[] = [
      // Track OLD played 4 times, 3 days ago -> outside 2-day window
      { track: tOld, at: now - 3 * DAY_MS, heard: 190, out: "done" },
      { track: tOld, at: now - 3 * DAY_MS + 1000, heard: 190, out: "done" },
      { track: tOld, at: now - 3 * DAY_MS + 2000, heard: 190, out: "done" },
      { track: tOld, at: now - 3 * DAY_MS + 3000, heard: 190, out: "done" },
      // Track A played once very recently (2m ago)
      { track: tA, at: now - 120_000, heard: 180, out: "done" },
      // Track B played 3 times over last 36 hours -> highest 2-day listening weight
      { track: tB, at: now - 1.2 * DAY_MS, heard: 185, out: "done" },
      { track: tB, at: now - 0.8 * DAY_MS, heard: 185, out: "done" },
      { track: tB, at: now - 0.2 * DAY_MS, heard: 185, out: "done" },
      // Track C skipped repeatedly -> negative score excluded
      { track: tC, at: now - 60_000, heard: 15, out: "skip" },
    ];

    const result = jumpBackInTracks(entries, [tOld, tA], now, { limit: 6 });
    expect(result[0]?.id).toBe("B");
    expect(result[1]?.id).toBe("A");
    // OLD backfills cleanly after active 2-day tracks
    expect(result.some((t) => t.id === "OLD")).toBe(true);
    expect(result.some((t) => t.id === "C")).toBe(false);
  });
});

describe("wordTiming melody phrasing", () => {
  it("shapes progress curves smoothly and trims oversized silent gaps before next line", () => {
    expect(easeMelodyProgress(0)).toBe(0);
    expect(easeMelodyProgress(1)).toBe(1);
    expect(easeMelodyProgress(0.5)).toBeGreaterThan(0.5);

    const model = buildLineWordModel(
      { time: 10, text: "Hold the note, tonight." },
      22 // 12s instrumental gap after line
    );
    expect(model.words.length).toBe(4);
    const totalDur = model.spans[model.spans.length - 1].end - model.spans[0].start;
    expect(totalDur).toBeLessThan(10);
    // Punctuation/sustained ending gets more time than short article "the"
    const theDur = model.spans[1].end - model.spans[1].start;
    const tonightDur = model.spans[3].end - model.spans[3].start;
    expect(tonightDur).toBeGreaterThan(theDur);
  });
});

describe("Crate middle-card selection & swipe priority queue", () => {
  it("picks the sleeve closest to the visible viewport center on mobile", () => {
    const centers = [96, 164, 232, 300, 368];
    expect(nearestMiddleCardIndex(centers, 180)).toBe(1);
    expect(nearestMiddleCardIndex(centers, 290)).toBe(3);
    expect(nearestMiddleCardIndex([], 100)).toBe(-1);
  });

  it("queues tracks into priorityQueue cleanly via swipe helper", () => {
    usePlayer.setState({ priorityQueue: [], contextQueue: [], currentTrack: track("NOW"), index: 0, queue: [track("NOW")] });
    const addedTrack = track("Q1");
    queueTrackPriorityWithToast(addedTrack);
    expect(usePlayer.getState().priorityQueue.map((t) => t.id)).toEqual(["Q1"]);
  });
});
