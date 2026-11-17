import { describe, it, expect } from "vitest";
import {
  embeddedLrc,
  parseEnhancedLrc,
  parseLrc,
  parseLrcMetadata,
  validateLrcForTrack,
} from "./lyrics";
import { buildLineWordModel, computeActiveLyricIndex, resolveWordSpans } from "../bytune/lib/wordTiming";

describe("LRC metadata validation & advanced word/line synchronization", () => {
  it("parses LRC header tags including title, artist, length, and offset", () => {
    const raw = [
      "[ti:Midnight City]",
      "[ar:M83]",
      "[al:Hurry Up, We're Dreaming]",
      "[length:04:03]",
      "[offset:+500]",
      "[00:10.00]Waiting in a car",
    ].join("\n");

    const meta = parseLrcMetadata(raw);
    expect(meta).toEqual({
      title: "Midnight City",
      artist: "M83",
      album: "Hurry Up, We're Dreaming",
      lengthSec: 243,
      offsetMs: 500,
    });
  });

  it("rejects mismatched LRC metadata or out-of-range timestamps for a track", () => {
    const wrongSong = [
      "[ti:Completely Different Song]",
      "[ar:Other Artist]",
      "[00:05.00]Wrong lyrics line",
    ].join("\n");

    expect(
      validateLrcForTrack(wrongSong, {
        title: "Midnight City",
        artist: "M83",
        duration: 243,
      })
    ).toBe(false);
    expect(embeddedLrc(wrongSong, { title: "Midnight City", artist: "M83", duration: 243 })).toBeNull();

    const wrongDuration = [
      "[ti:Midnight City]",
      "[ar:M83]",
      "[length:02:10]",
      "[00:10.00]Waiting in a car",
    ].join("\n");
    expect(
      validateLrcForTrack(wrongDuration, {
        title: "Midnight City",
        artist: "M83",
        duration: 243,
      })
    ).toBe(false);

    const linesPastEnd = parseLrc("[04:55.00]Past track end");
    expect(
      validateLrcForTrack(
        "[04:55.00]Past track end",
        { title: "Short Song", artist: "Artist", duration: 180 },
        linesPastEnd
      )
    ).toBe(false);

    const matching = [
      "[ti:Midnight City]",
      "[ar:M83]",
      "[length:04:03]",
      "[00:10.00]Waiting in a car",
    ].join("\n");
    expect(
      validateLrcForTrack(
        matching,
        { title: "Midnight City", artist: "M83", duration: 243 },
        parseLrc(matching)
      )
    ).toBe(true);
  });

  it("supports multi-timestamp lines and [offset:] adjustments in plain LRC", () => {
    const raw = [
      "[offset:500]",
      "[00:12.00][01:24.50]Repeated chorus line",
      "[00:20.00]Second line",
    ].join("\n");

    const lines = parseLrc(raw);
    expect(lines.map((l) => [Number(l.time.toFixed(2)), l.text])).toEqual([
      [11.5, "Repeated chorus line"],
      [19.5, "Second line"],
      [84, "Repeated chorus line"],
    ]);
  });

  it("parses enhanced LRC word tags with closing timestamps cleanly", () => {
    const raw = [
      "[offset:-200]",
      "[00:10.00]<00:10.00>Hello <00:10.50>world<00:11.20>",
      "[00:12.00]<00:12.00>Next <00:12.40>line<00:13.00>",
    ].join("\n");

    const lines = parseEnhancedLrc(raw);
    expect(lines).toHaveLength(2);
    expect(lines[0].text).toBe("Hello world");
    expect(lines[0].words?.map((w) => [w.text, Number(w.start.toFixed(2)), Number(w.end.toFixed(2))])).toEqual([
      ["Hello", 10.2, 10.7],
      ["world", 10.7, 11.4],
    ]);
  });

  it("repairs degenerate word spans and maps proportional word timings for line-only lyrics", () => {
    const repaired = resolveWordSpans(
      [
        { start: 0, end: 0, text: "Whoa" },
        { start: 10.5, end: 11.2, text: "midnight" },
      ],
      10,
      12
    );
    expect(repaired[0].start).toBeCloseTo(10, 2);
    expect(repaired[0].end).toBeGreaterThan(repaired[0].start);
    expect(repaired[1].start).toBeGreaterThanOrEqual(repaired[0].end);
    expect(repaired[1].end).toBeCloseTo(11.2, 2);

    const model = buildLineWordModel({ time: 10, text: "Waiting in a car" }, 14);
    expect(model.spaced).toBe(true);
    expect(model.words.map((w) => w.text)).toEqual(["Waiting", "in", "a", "car"]);
    expect(model.spans[0].start).toBe(10);
    expect(model.spans[3].end).toBeCloseTo(14, 2);
    expect(model.spans[0].end - model.spans[0].start).toBeGreaterThan(
      model.spans[2].end - model.spans[2].start
    );

    const cjkModel = buildLineWordModel({ time: 20, text: "告白气球" }, 22);
    expect(cjkModel.spaced).toBe(false);
    expect(cjkModel.words.map((w) => w.text)).toEqual(["告", "白", "气", "球"]);

    expect(computeActiveLyricIndex([{ time: 10 }, { time: 14 }], 13.86, 0)).toBe(1);
    expect(computeActiveLyricIndex([{ time: 10 }, { time: 14 }], 13.5, 0)).toBe(0);
  });
});
