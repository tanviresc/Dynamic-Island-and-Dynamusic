import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fallbackMobileArtist,
  fallbackMobileLyrics,
  fallbackMobileSearch,
  fallbackMobileStreamUrl,
  parseLrcText,
  pickBestPipedAudioUrl,
} from "./lib/mobileStandaloneFallback";
import { cleanMobileLyricLines, stripSingerPrefix } from "./lib/lyricsLines";
import {
  getInterpolatedPlaybackPosition,
  resetPlaybackClock,
  setPlaybackClock,
} from "./lib/playbackClock";

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

  it("parses enhanced word-level LRC timestamps and [offset:] for mobile playback", () => {
    const raw = [
      "[offset:500]",
      "[00:10.00]<00:10.00>Hello <00:10.50>world<00:11.20>",
      "[00:12.00]<00:12.00>Taylor Swift: <00:12.20>Singing <00:12.70>now<00:13.20>",
    ].join("\n");
    const parsed = parseLrcText(raw, "Taylor Swift");
    expect(parsed.wordSynced).toBe(true);
    expect(parsed.lines).toHaveLength(2);
    expect(parsed.lines[0].text).toBe("Hello world");
    expect(parsed.lines[0].words?.map((w) => [w.text, Number(w.start.toFixed(2)), Number(w.end.toFixed(2))])).toEqual([
      ["Hello", 9.5, 10],
      ["world", 10, 10.7],
    ]);
    expect(parsed.lines[1].text).toBe("Singing now");
  });

  it("strips singer/speaker prefixes on mobile lyrics without affecting normal lyrics or desktop", () => {
    expect(stripSingerPrefix("Taylor Swift: Shake it off", "Taylor Swift")).toBe("Shake it off");
    expect(stripSingerPrefix("[Justin Bieber]: Stay with me")).toBe("Stay with me");
    expect(stripSingerPrefix("v1: Starting the verse")).toBe("Starting the verse");
    expect(stripSingerPrefix("12:30 in the night")).toBe("12:30 in the night");

    const sample = [
      {
        time: 5,
        text: "SZA: Hold on tonight",
        words: [
          { start: 5, end: 5.2, text: "SZA:" },
          { start: 5.2, end: 5.6, text: "Hold" },
          { start: 5.6, end: 6.0, text: "on" },
          { start: 6.0, end: 6.5, text: "tonight" },
        ],
      },
    ];
    expect(cleanMobileLyricLines(sample, false, "SZA")[0].text).toBe("SZA: Hold on tonight");
    const mobileCleaned = cleanMobileLyricLines(sample, true, "SZA");
    expect(mobileCleaned[0].text).toBe("Hold on tonight");
    expect(mobileCleaned[0].words?.map((w) => w.text)).toEqual(["Hold", "on", "tonight"]);
  });

  it("smoothly interpolates native playback clock while playing and freezes when paused", () => {
    resetPlaybackClock(120);
    setPlaybackClock(10, 120, 30);
    expect(getInterpolatedPlaybackPosition(false, 1)).toBe(10);
    const playingPos = getInterpolatedPlaybackPosition(true, 1.5);
    expect(playingPos).toBeGreaterThanOrEqual(10);
    expect(playingPos).toBeLessThanOrEqual(120);
  });
});

