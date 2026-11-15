import { describe, expect, it } from "vitest";
import { parseContentRangeStart, streamIdentity, streamTtlMs } from "./audio-format";

describe("audio-format stream integrity helpers", () => {
  it("computes stable yt identity when itag and clen match despite refreshed signature params", () => {
    const first = streamIdentity({
      url: "https://rr3---sn.googlevideo.com/videoplayback?expire=1799999999&sig=AAA",
      mime: 'audio/mp4; codecs="mp4a.40.2"',
      itag: 140,
      clen: 4_123_456,
    });
    const refreshed = streamIdentity({
      url: "https://rr5---sn.googlevideo.com/videoplayback?expire=1800001000&sig=BBB",
      mime: 'audio/mp4; codecs="mp4a.40.2"',
      itag: 140,
      clen: 4_123_456,
    });
    expect(first).toBe(refreshed);
    expect(first).toBe("yt:140:4123456:audio/mp4");
  });

  it("distinguishes unknown-itag fallback URLs instead of collapsing to ?:?", () => {
    const jiosaavn = streamIdentity({
      url: "https://aac.saavncdn.com/123/abcd_320.mp4?token=1",
      mime: "audio/mp4",
    });
    const piped = streamIdentity({
      url: "https://proxy.piped.private.coffee/videoplayback?id=xyz",
      mime: "audio/mp4",
    });
    const otherJio = streamIdentity({
      url: "https://aac.saavncdn.com/999/other_320.mp4",
      mime: "audio/mp4",
    });
    expect(jiosaavn).not.toBe(piped);
    expect(jiosaavn).not.toBe(otherJio);
  });

  it("parses Content-Range byte start offsets safely", () => {
    expect(parseContentRangeStart("bytes 1048576-2097151/5000000")).toBe(1048576);
    expect(parseContentRangeStart("bytes 0-511/1024")).toBe(0);
    expect(parseContentRangeStart(null)).toBeNull();
    expect(parseContentRangeStart("items 1-10/20")).toBeNull();
  });

  it("bounds stream TTL using query expire param with safety margin", () => {
    const now = 1_700_000_000_000;
    const expireSec = Math.floor((now + 30 * 60_000) / 1000);
    const ttl = streamTtlMs(`https://example.com/videoplayback?expire=${expireSec}`, now);
    expect(ttl).toBeGreaterThan(24 * 60_000);
    expect(ttl).toBeLessThanOrEqual(25 * 60_000);
  });
});

