/**
 * Matches the connected Spotify account's Liked Songs against YouTube Music and imports them
 * directly into Dynamusic's `Liked Songs` (`useLibrary.liked`), pushing to Supabase cloud sync
 * and starting in-app offline vault caching.
 */
import { create } from "zustand";
import { hasBridge, requireBridge } from "./bridge";
import { useLibrary } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useUI } from "../stores/ui";
import type { Track } from "../types";

interface SpotifyLikedSyncState {
  syncing: boolean;
  total: number;
  checked: number;
  matchedCount: number;
  lastError: string | null;
}

export const useSpotifyLikedSync = create<SpotifyLikedSyncState>(() => ({
  syncing: false,
  total: 0,
  checked: 0,
  matchedCount: 0,
  lastError: null,
}));

let inFlight: Promise<number> | null = null;

export async function syncSpotifyLikedToLibrary(opts?: { quiet?: boolean }): Promise<number> {
  if (inFlight) return inFlight;
  if (!hasBridge()) return 0;

  const task = (async (): Promise<number> => {
    const ui = useUI.getState();
    useSpotifyLikedSync.setState({ syncing: true, total: 0, checked: 0, matchedCount: 0, lastError: null });
    try {
      const bridge = requireBridge();
      const playlist = await bridge.spotifyPlaylist("liked");
      const songs = Array.isArray(playlist?.songs) ? playlist.songs : [];
      useSpotifyLikedSync.setState({ total: songs.length });

      if (songs.length === 0) {
        if (!opts?.quiet) ui.toast("No Spotify Liked Songs found.");
        return 0;
      }

      const prefer = useSettings.getState().matchLanguage;
      const matchedByIndex: Array<Track | null> = Array(songs.length).fill(null);
      let cursor = 0;
      let checked = 0;
      let matchedCount = 0;

      const worker = async (): Promise<void> => {
        while (cursor < songs.length) {
          const i = cursor++;
          const song = songs[i];
          let track: Track | null = null;
          try {
            track = await bridge.matchSong(song, prefer);
          } catch {
            track = null;
          }
          matchedByIndex[i] = track;
          checked += 1;
          if (track) matchedCount += 1;
          useSpotifyLikedSync.setState({ checked, matchedCount });
        }
      };

      await Promise.all(Array.from({ length: Math.min(4, songs.length) }, () => worker()));

      const matchedTracks = matchedByIndex.filter((t): t is Track => t !== null);
      const added = useLibrary.getState().importLikedTracks(matchedTracks);
      void bridge.syncNow().catch(() => undefined);

      if (!opts?.quiet) {
        ui.toast(
          added > 0
            ? `Imported ${added} Spotify Liked Song${added === 1 ? "" : "s"} & saving offline`
            : `All ${matchedTracks.length} Spotify Liked Songs are already in your Liked Songs`,
          "success"
        );
      }
      return added;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not read Spotify Liked Songs.";
      useSpotifyLikedSync.setState({ lastError: msg });
      if (!opts?.quiet) {
        ui.toast(msg, "error");
      }
      return 0;
    } finally {
      useSpotifyLikedSync.setState({ syncing: false });
      inFlight = null;
    }
  })();

  inFlight = task;
  return task;
}

