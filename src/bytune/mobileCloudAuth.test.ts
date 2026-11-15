import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  mobileAuthContinueGuest,
  mobileAuthGetSession,
  mobileAuthSignOut,
  readMobileStore,
  resetMobileDataStores,
  writeMobileStore,
} from "./lib/mobileCloudAuth";
import { deletionKey } from "./lib/deletion-sync";
import { useLibrary } from "./stores/library";
import type { Track } from "./types";

function installMemoryLocalStorage() {
  const map = new Map<string, string>();
  const mockStorage = {
    get length() {
      return map.size;
    },
    clear() {
      map.clear();
    },
    getItem(key: string) {
      return map.has(key) ? map.get(key)! : null;
    },
    key(index: number) {
      return [...map.keys()][index] ?? null;
    },
    removeItem(key: string) {
      map.delete(key);
    },
    setItem(key: string, value: string) {
      map.set(key, String(value));
    },
  };
  Object.defineProperty(globalThis, "localStorage", { value: mockStorage, configurable: true });
  return map;
}

describe("mobileCloudAuth & Spotify liked library import", () => {
  beforeEach(() => {
    installMemoryLocalStorage();
    resetMobileDataStores();
    vi.restoreAllMocks();
  });

  it("fresh install returns mode: null so every new APK user sees Onboarding login", async () => {
    const session = await mobileAuthGetSession();
    expect(session.mode).toBeNull();
    expect(session.userId).toBeNull();
  });

  it("guest onboarding sets guest profile and signOut returns to Onboarding (mode: null) with wiped stores", async () => {
    const guest = await mobileAuthContinueGuest("Tanvir");
    expect(guest.mode).toBe("guest");
    expect(guest.displayName).toBe("Tanvir");

    writeMobileStore("library", { state: { liked: [{ id: "abc" }] }, version: 1 });
    expect(readMobileStore("library")).not.toBeNull();

    const afterSignOut = await mobileAuthSignOut();
    expect(afterSignOut.mode).toBeNull();
    const nextSession = await mobileAuthGetSession();
    expect(nextSession.mode).toBeNull();
  });

  it("importLikedTracks batch-imports Spotify matches cleanly without duplicates and records deletionSync", () => {
    useLibrary.setState({ liked: [], deletionSync: undefined });
    const t1: Track = { id: "yt1", title: "Song One", artist: "Artist A", album: "", duration: 180, thumb: "" };
    const t2: Track = { id: "yt2", title: "Song Two", artist: "Artist B", album: "", duration: 200, thumb: "" };

    const added1 = useLibrary.getState().importLikedTracks([t1, t2, t1]);
    expect(added1).toBe(2);
    expect(useLibrary.getState().liked.map((t) => t.id)).toEqual(["yt1", "yt2"]);
    expect(useLibrary.getState().deletionSync?.adds[deletionKey("liked", "yt1")]).toBeTypeOf("number");
    expect(useLibrary.getState().deletionSync?.adds[deletionKey("liked", "yt2")]).toBeTypeOf("number");

    const added2 = useLibrary.getState().importLikedTracks([t1]);
    expect(added2).toBe(0);
    expect(useLibrary.getState().liked).toHaveLength(2);
  });
});

