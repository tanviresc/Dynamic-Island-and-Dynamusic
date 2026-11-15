/**
 * Cloud-restore → live-store bridge. The sync engine writes restored JSON
 * files to disk from the main process, but the renderer's zustand stores
 * hydrated once at boot — without this bridge the UI keeps showing empty
 * state over restored data (and a later write would clobber the restore).
 * On "sync:restored" we rehydrate the matching stores in place.
 */
import { useLibrary } from "../stores/library";
import { useSettings } from "../stores/settings";
import { useRecents } from "../stores/recents";
import { useListening } from "../stores/listening";
import { invalidateStatsCache } from "./recs/profile";
import { syncLikedSongsToOfflineVault } from "./offlineAudioVault";
import { hasBridge } from "./bridge";
import { storage } from "./persist";
import { DEVICE_SETTINGS_FIELDS } from "../../electron/sync-merge";

const STORE_PERSIST: Record<string, { rehydrate: () => void | Promise<void> }> = {
  library: useLibrary.persist,
  settings: useSettings.persist,
  "recent-searches": useRecents.persist,
  "listening-signals": useListening.persist,
};

function resetStoreInMemory(name: string): void {
  if (name === "library") {
    const init = useLibrary.getInitialState();
    const downloads = useLibrary.getState().downloads;
    useLibrary.setState({
      liked: init.liked,
      playlists: init.playlists,
      folders: init.folders,
      followedArtists: init.followedArtists,
      history: init.history,
      pinnedSingles: init.pinnedSingles,
      libraryOrder: init.libraryOrder,
      deletionSync: undefined,
      downloads,
    });
  } else if (name === "settings") {
    const init = useSettings.getInitialState();
    const cur = useSettings.getState();
    const device = Object.fromEntries(
      DEVICE_SETTINGS_FIELDS.map((k) => [k, (cur as unknown as Record<string, unknown>)[k]])
    );
    useSettings.setState({ ...init, ...device });
  } else if (name === "recent-searches") {
    const init = useRecents.getInitialState();
    useRecents.setState({ searches: init.searches, deletionSync: undefined });
  } else if (name === "listening-signals") {
    const init = useListening.getInitialState();
    useListening.setState({ skips: init.skips, version: init.version });
  }
}

let appliedSeq = 0;

function apply(stores: string[], seq: number): void {
  if (seq <= appliedSeq) return;
  appliedSeq = seq;
  // listening-history is a main-process store (no renderer hydration); the
  // Replay summary read from it just needs its cache dropped.
  if (stores.includes("listening-history")) invalidateStatsCache();
  for (const name of stores) {
    const p = STORE_PERSIST[name];
    if (!p) continue;
    void Promise.resolve(storage.getItem(name))
      .then((raw) => {
        if (raw == null) {
          resetStoreInMemory(name);
          return;
        }
        return p.rehydrate();
      })
      .then(() => {
        if (name === "library") {
          void syncLikedSongsToOfflineVault(useLibrary.getState().liked);
        }
      })
      .catch(() => undefined);
  }
}

/** Subscribe once from App — returns an unsubscribe fn. */
export function watchSyncRestores(): () => void {
  if (!hasBridge()) return () => undefined;
  const off = window.bytune!.onSyncRestored((info) => apply(info.stores ?? [], info.seq ?? 0));
  // Boot race: the session-restore sync at startup can finish just before
  // or after this mounts — re-check the status shortly after boot.
  const t = setTimeout(() => {
    void window.bytune
      ?.syncStatus()
      .then((st) => {
        const s = st as { restoreSeq?: number; restoredStores?: string[] } | undefined;
        if (s?.restoreSeq && s.restoreSeq > appliedSeq) apply(s.restoredStores ?? [], s.restoreSeq);
      })
      .catch(() => undefined);
  }, 4000);
  return () => {
    off();
    clearTimeout(t);
  };
}
