import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackMobileArtist,
  fallbackMobileLyrics,
  fallbackMobileSearch,
  fallbackMobileStreamUrl,
  pickBestPipedAudioUrl,
} from "./lib/mobileStandaloneFallback";

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

  it("parses standalone artist pages via native ytmRequest without PC pairing", async () => {
    const ytmRequest = vi.fn().mockResolvedValue({
      raw: JSON.stringify({
        header: {
          musicImmersiveHeaderRenderer: {
            title: { runs: [{ text: "JENNIE" }] },
            description: { runs: [{ text: "Solo artist." }] },
            subscriptionButton: {
              subscribeButtonRenderer: {
                longSubscriberCountText: { runs: [{ text: "10M subscribers" }] },
              },
            },
            thumbnail: {
              musicThumbnailRenderer: {
                thumbnail: {
                  thumbnails: [{ url: "https://lh3.googleusercontent.com/jennie=w544-h544", width: 544, height: 544 }],
                },
              },
            },
          },
        },
        contents: {
          singleColumnBrowseResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    });
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MediaKeepalive: { ytmRequest } },
    };

    const page = await fallbackMobileArtist("UCjennie123");
    expect(ytmRequest).toHaveBeenCalledWith({
      endpoint: "browse",
      body: { browseId: "UCjennie123" },
    });
    expect(page.artist.id).toBe("UCjennie123");
    expect(page.artist.name).toBe("JENNIE");
    expect(page.artist.thumb).toContain("jennie");
    expect(page.subscriberCount).toBe("10M subscribers");
  });

  it("resolves word-synced lyrics via native MediaKeepalive.resolveLyrics", async () => {
    const resolveLyrics = vi.fn().mockResolvedValue({
      found: true,
      source: "LyricsPlus",
      wordSynced: true,
      synced: [
        {
          time: 1.5,
          end: 3.0,
          text: "Hello world",
          words: [
            { start: 1.5, end: 2.1, text: "Hello" },
            { start: 2.2, end: 3.0, text: "world" },
          ],
        },
      ],
      plain: null,
    });
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MediaKeepalive: { resolveLyrics } },
    };

    const lyrics = await fallbackMobileLyrics({
      id: "abc123def45",
      title: "Flower In A Hurricane (feat. Kim)",
      artist: "Justice, Tame Impala, SZA & Grand Theft Auto",
      duration: 210,
    });

    expect(lyrics?.source).toBe("LyricsPlus");
    expect(lyrics?.wordSynced).toBe(true);
    expect(lyrics?.synced?.[0].words).toHaveLength(2);
  });

  it("falls back to direct LRCLIB fetch and parses LRC timestamps cleanly", async () => {
    (globalThis as { Capacitor?: unknown }).Capacitor = undefined;

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          syncedLyrics: "[00:05.50]First line\n[00:10.00]Second line\n[00:15.25]Third line",
          plainLyrics: "First line\nSecond line\nThird line",
        }),
      })
    );

    const lyrics = await fallbackMobileLyrics({
      id: "xyz98765432",
      title: "Aarzu",
      artist: "Noor, Khan & Madhurxo",
      duration: 188,
    });

    expect(lyrics?.source).toBe("LRCLIB");
    expect(lyrics?.synced).toHaveLength(3);
    expect(lyrics?.synced?.[0]).toEqual({ time: 5.5, text: "First line" });
  });

  it("returns classified artist rows from YTM search fallback", async () => {
    const ytmRequest = vi.fn().mockResolvedValue({
      raw: JSON.stringify({
        contents: {
          tabbedSearchResultsRenderer: {
            tabs: [
              {
                tabRenderer: {
                  content: {
                    sectionListRenderer: {
                      contents: [
                        {
                          musicShelfRenderer: {
                            title: { runs: [{ text: "Artists" }] },
                            contents: [
                              {
                                musicResponsiveListItemRenderer: {
                                  navigationEndpoint: {
                                    browseEndpoint: {
                                      browseId: "UCartist777",
                                      browseEndpointContextSupportedConfigs: {
                                        browseEndpointContextMusicConfig: { pageType: "MUSIC_PAGE_TYPE_ARTIST" },
                                      },
                                    },
                                  },
                                  thumbnail: {
                                    musicThumbnailRenderer: {
                                      thumbnail: {
                                        thumbnails: [
                                          { url: "https://lh3.googleusercontent.com/artist777=w120-h120", width: 120, height: 120 },
                                        ],
                                      },
                                    },
                                  },
                                  flexColumns: [
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: "Noor" }] },
                                      },
                                    },
                                    {
                                      musicResponsiveListItemFlexColumnRenderer: {
                                        text: { runs: [{ text: "Artist • 1M monthly audience" }] },
                                      },
                                    },
                                  ],
                                },
                              },
                            ],
                          },
                        },
                      ],
                    },
                  },
                },
              },
            ],
          },
        },
      }),
    });
    (globalThis as { Capacitor?: unknown }).Capacitor = {
      Plugins: { MediaKeepalive: { ytmRequest } },
    };

    const res = await fallbackMobileSearch("Noor");
    expect(res.artists).toHaveLength(1);
    expect(res.artists[0].id).toBe("UCartist777");
    expect(res.artists[0].name).toBe("Noor");
  });
});

