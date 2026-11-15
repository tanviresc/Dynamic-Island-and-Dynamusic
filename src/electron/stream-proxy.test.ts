import { EventEmitter } from "events";
import type http from "http";
import { afterEach, describe, expect, it, vi } from "vitest";
import { streamIdentity } from "./audio-format";

const resolveStreamMock = vi.fn();

vi.mock("electron", () => ({
  app: { getPath: () => "." },
}));

vi.mock("./local-library", () => ({
  localStreamPath: () => null,
}));

vi.mock("./music-service", () => ({
  resolveStream: (...args: unknown[]) => resolveStreamMock(...args),
  evictOldest: (map: Map<unknown, unknown>, max: number) => {
    while (map.size > max) {
      const k = map.keys().next().value;
      if (k === undefined) break;
      map.delete(k);
    }
  },
}));

import { handleStreamProxyRequest } from "./stream-proxy";

function createMockReqRes(url: string, range?: string) {
  const req = new EventEmitter() as unknown as http.IncomingMessage;
  req.url = url;
  req.headers = range ? { range } : {};

  let statusCode = 0;
  let headers: Record<string, string> = {};
  const chunks: Buffer[] = [];
  let destroyed = false;
  let destroyErr: unknown = null;

  const res = new EventEmitter() as unknown as http.ServerResponse & {
    getStatus: () => number;
    getHeaders: () => Record<string, string>;
    getBody: () => Buffer;
    wasDestroyed: () => boolean;
    getDestroyError: () => unknown;
  };
  (res as unknown as { writeHead: unknown }).writeHead = (code: number, hdrs?: Record<string, string>) => {
    statusCode = code;
    if (hdrs) headers = { ...hdrs };
    return res;
  };
  (res as unknown as { write: unknown }).write = (chunk: Uint8Array | string) => {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return true;
  };
  (res as unknown as { end: unknown }).end = (chunk?: Uint8Array | string) => {
    if (chunk) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    res.emit("finish");
    return res;
  };
  (res as unknown as { destroy: unknown }).destroy = (err?: Error) => {
    destroyed = true;
    destroyErr = err ?? null;
    res.emit("close");
    return res;
  };
  Object.defineProperty(res, "writableEnded", { get: () => false });
  res.getStatus = () => statusCode;
  res.getHeaders = () => headers;
  res.getBody = () => Buffer.concat(chunks);
  res.wasDestroyed = () => destroyed;
  res.getDestroyError = () => destroyErr;

  return { req, res };
}

describe("stream-proxy corruption & splice prevention", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    resolveStreamMock.mockReset();
  });

  it("rejects upstream HTTP 200 when player requested non-zero Range offset", async () => {
    const url = "https://cdn.example.com/track-a.mp4";
    resolveStreamMock.mockResolvedValue({
      url,
      mime: "audio/mp4",
      lufs: -12,
      identity: streamIdentity({ url, mime: "audio/mp4" }),
    });

    globalThis.fetch = vi.fn().mockResolvedValue(
      new Response(Uint8Array.from([1, 2, 3, 4]), {
        status: 200,
        headers: { "content-type": "audio/mp4", "content-length": "4" },
      })
    ) as unknown as typeof fetch;

    const { req, res } = createMockReqRes("/?id=track-range-200", "bytes=1024-");
    await handleStreamProxyRequest(req, res);

    expect(res.getStatus()).toBe(409);
    expect(res.getBody().byteLength).toBe(0);
  });

  it("aborts cleanly on mid-stream rendition change even on initial bytes=0- request", async () => {
    const initialStream = {
      url: "https://cdn.example.com/opus-251",
      mime: 'audio/webm; codecs="opus"',
      lufs: -11,
      itag: 251,
      clen: 4_000_000,
      identity: streamIdentity({
        url: "https://cdn.example.com/opus-251",
        mime: 'audio/webm; codecs="opus"',
        itag: 251,
        clen: 4_000_000,
      }),
    };
    const changedStream = {
      url: "https://aac.saavncdn.com/song_320.mp4",
      mime: "audio/mp4",
      lufs: null,
      identity: streamIdentity({
        url: "https://aac.saavncdn.com/song_320.mp4",
        mime: "audio/mp4",
      }),
    };

    resolveStreamMock
      .mockResolvedValueOnce(initialStream)
      .mockResolvedValueOnce(changedStream);

    let fetchCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        // First slice returns partial bytes (less than full 512KB chunk? No: 100 bytes out of 4MB triggers continuation)
        return new Response(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3]), {
          status: 206,
          headers: {
            "content-type": 'audio/webm; codecs="opus"',
            "content-range": "bytes 0-3/4000000",
          },
        });
      }
      // Second slice triggers 403 -> mid-stream refresh returns changed rendition!
      return new Response("Forbidden", { status: 403 });
    }) as unknown as typeof fetch;

    const { req, res } = createMockReqRes("/?id=track-mid-change", "bytes=0-");
    await handleStreamProxyRequest(req, res);

    expect(res.getStatus()).toBe(206);
    expect(res.getBody()).toEqual(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]));
    expect(res.wasDestroyed()).toBe(true);
  });
});
