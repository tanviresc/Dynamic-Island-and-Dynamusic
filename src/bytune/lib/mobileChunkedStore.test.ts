import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  TRACK_CHUNK_SIZE,
  clearChunkedStoreCache,
  readChunkedDataset,
  readChunkedManifestSync,
  readLibraryChunkPage,
  writeChunkedDataset,
} from "./mobileChunkedStore";

function createMemoryLocalStorage() {
  const map = new Map<string, string>();
  return {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => {
      map.set(k, v);
    },
    removeItem: (k: string) => {
      map.delete(k);
    },
    clear: () => map.clear(),
  };
}

describe("mobileChunkedStore", () => {
  const originalLs = (globalThis as { localStorage?: unknown }).localStorage;

  beforeEach(() => {
    clearChunkedStoreCache();
    (globalThis as { localStorage?: unknown }).localStorage = createMemoryLocalStorage();
  });

  afterEach(() => {
    clearChunkedStoreCache();
    (globalThis as { localStorage?: unknown }).localStorage = originalLs;
    vi.restoreAllMocks();
  });

  it("writes a compact boot manifest for large library datasets without blocking boot reads", async () => {
    const liked = Array.from({ length: TRACK_CHUNK_SIZE + 15 }, (_, i) => ({
      id: `trk_${i}`,
      title: `Song ${i}`,
      artist: `Artist ${i % 5}`,
      duration: 180 + i,
      thumb: "",
    }));
    const payload = {
      version: 1,
      state: {
        liked,
        playlists: [{ id: "pl1", name: "Mix", tracks: liked.slice(0, 12), createdAt: 1 }],
        history: liked.slice(0, 40),
        folders: [],
      },
    };

    await writeChunkedDataset("dynamusic:store:library", payload);

    const manifestStub = readChunkedManifestSync<typeof payload>("dynamusic:store:library");
    expect(manifestStub?.state.liked).toHaveLength(liked.length);
    expect(manifestStub?.state.playlists[0].name).toBe("Mix");

    const manifestRaw = globalThis.localStorage.getItem("dynamusic:chunk_manifest:dynamusic:store:library");
    expect(manifestRaw).toBeTruthy();
    const parsedManifest = JSON.parse(manifestRaw!);
    expect(parsedManifest.kind).toBe("library");
    expect(parsedManifest.counts.liked).toBe(liked.length);
    expect(parsedManifest.counts.likedPages).toBe(2);
    expect(parsedManifest.header.previewLiked).toHaveLength(25);

    const page1 = await readLibraryChunkPage<{ id: string }>("dynamusic:store:library", "liked", 1);
    expect(page1.totalPages).toBe(2);
    expect(page1.items).toHaveLength(15);
    expect(page1.items[0].id).toBe(`trk_${TRACK_CHUNK_SIZE}`);
  });

  it("migrates legacy monolithic localStorage JSON datasets cleanly on first read", async () => {
    const legacy = {
      version: 1,
      state: {
        liked: [{ id: "legacy_1", title: "Old Track", artist: "Artist", duration: 200, thumb: "" }],
        playlists: [],
        history: [],
      },
    };
    globalThis.localStorage.setItem("dynamusic:store:library", JSON.stringify(legacy));

    const loaded = await readChunkedDataset<typeof legacy>("dynamusic:store:library");
    expect(loaded?.state.liked[0].id).toBe("legacy_1");

    const removedAfter = await writeChunkedDataset("dynamusic:store:library", null);
    expect(removedAfter).toBeUndefined();
    expect(readChunkedManifestSync("dynamusic:store:library")).toBeNull();
  });
});
