import { afterEach, describe, expect, it, vi } from "vitest";
import {
  base64ToBlob,
  cacheBlobUrlLru,
  setActiveOfflineTrackIds,
  syncLikedSongsToOfflineVault,
} from "./lib/offlineAudioVault";
import type { Track } from "./types";

describe("offlineAudioVault reliability & memory safety", () => {
  const originalNavigatorOnline = navigator.onLine;
  const revokeSpy = vi.fn();
  const originalRevoke = URL.revokeObjectURL;

  afterEach(() => {
    setActiveOfflineTrackIds([]);
    URL.revokeObjectURL = originalRevoke;
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: originalNavigatorOnline,
    });
    vi.restoreAllMocks();
  });

  it("decodes base64 audio payloads directly into typed Blobs", () => {
    const raw = new Uint8Array([0x00, 0x01, 0x02, 0x66, 0x74, 0x79, 0x70]);
    const b64 = btoa(String.fromCharCode(...raw));
    const blob = base64ToBlob(b64, "audio/mp4");
    expect(blob.size).toBe(raw.length);
    expect(blob.type).toBe("audio/mp4");
  });

  it("retains pinned playback blob URLs when LRU evicts past capacity", () => {
    revokeSpy.mockClear();
    URL.revokeObjectURL = revokeSpy;

    setActiveOfflineTrackIds(["active-track-1"]);
    cacheBlobUrlLru("active-track-1", "blob:active-1");

    for (let i = 0; i < 40; i++) {
      cacheBlobUrlLru(`other-${i}`, `blob:other-${i}`);
    }

    const revokedUrls = revokeSpy.mock.calls.map((c) => c[0]);
    expect(revokedUrls).not.toContain("blob:active-1");
    expect(revokedUrls.length).toBeGreaterThan(0);
  });

  it("short-circuits syncLikedSongsToOfflineVault when device is offline", async () => {
    Object.defineProperty(navigator, "onLine", {
      configurable: true,
      value: false,
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const tracks: Track[] = [
      { id: "yt-offline-1", title: "Offline Song", artist: "Artist", thumb: "", duration: 180 },
    ];
    await syncLikedSongsToOfflineVault(tracks);

    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

