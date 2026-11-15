import { afterEach, describe, expect, it, vi } from "vitest";
import { fallbackMobileStreamUrl, pickBestPipedAudioUrl } from "./lib/mobileStandaloneFallback";

describe("mobileStandaloneFallback stream resolution", () => {
  const originalCapacitor = (globalThis as { Capacitor?: unknown }).Capacitor;

  afterEach(() => {
    (globalThis as { Capacitor?: unknown }).Capacitor = originalCapacitor;
    vi.restoreAllMocks();
  });

  it("prefers audio/mp4 streams over higher-bitrate webm streams and respects quality caps", () => {
    const streams = [
      { url: "https://cdn.example/opus-high", bitrate: 256_000, mimeType: "audio/webm; codecs=\"opus\"" },
      { url: "https://cdn.example/aac-med", bitrate: 128_000, mimeType: "audio/mp4; codecs=\"mp4a.40.2\"" },
      { url: "https://cdn.example/aac-low", bitrate: 48_000, mimeType: "audio/mp4; codecs=\"mp4a.40.5\"" },
    ];

    expect(pickBestPipedAudioUrl(streams, "high")).toBe("https://cdn.example/aac-med");
    expect(pickBestPipedAudioUrl(streams, "low")).toBe("https://cdn.example/aac-low");
  });

  it("uses native MediaKeepalive.resolveStream loopback proxy when available", async () => {
    const resolveStream = vi.fn().mockResolvedValue({
      proxyUrl: "http://127.0.0.1:41234/stream?id=DxxW6hyNkOM",
      mime: "audio/mp4",
    });
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MediaKeepalive: { resolveStream } },
    };

    const url = await fallbackMobileStreamUrl("DxxW6hyNkOM", {
      forceRotate: true,
      quality: "high",
      title: "Casa Tupka Anthemo",
      artist: "Yo Yo Honey Singh",
    });

    expect(resolveStream).toHaveBeenCalledWith({
      videoId: "DxxW6hyNkOM",
      forceRotate: true,
      quality: "high",
      title: "Casa Tupka Anthemo",
      artist: "Yo Yo Honey Singh",
    });
    expect(url).toBe("http://127.0.0.1:41234/stream?id=DxxW6hyNkOM");
  });

  it("falls back cleanly to Piped mirrors if native plugin throws", async () => {
    const resolveStream = vi.fn().mockRejectedValue(new Error("native unavailable"));
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MediaKeepalive: { resolveStream } },
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          audioStreams: [
            { url: "https://piped.example/audio.m4a", bitrate: 128_000, mimeType: "audio/mp4" },
          ],
        }),
      })
    );

    const url = await fallbackMobileStreamUrl("dQw4w9WgXcQ");
    expect(url).toBe("https://piped.example/audio.m4a");
  });
});

