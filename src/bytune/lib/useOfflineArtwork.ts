import { useEffect, useState, useSyncExternalStore } from "react";
import { upgradeArtwork } from "./artwork";
import {
  peekOfflineArtworkUrl,
  resolveOfflineArtworkUrl,
  subscribeOfflineArtwork,
} from "./offlineAudioVault";

let artworkCacheTick = 0;
let subscribedToVault = false;
const versionListeners = new Set<() => void>();

function ensureVaultSubscription(): void {
  if (subscribedToVault) return;
  subscribedToVault = true;
  subscribeOfflineArtwork(() => {
    artworkCacheTick++;
    for (const listener of versionListeners) {
      try {
        listener();
      } catch {
        /* ignore */
      }
    }
  });
}

function subscribeArtworkVersion(cb: () => void): () => void {
  ensureVaultSubscription();
  versionListeners.add(cb);
  return () => versionListeners.delete(cb);
}

function getArtworkVersion(): number {
  return artworkCacheTick;
}

/**
 * Returns a local offline artwork URL (`blob:` from IndexedDB or `data:` from
 * native Android storage) whenever cached, falling back seamlessly to the
 * upgraded remote URL so offline Liked Songs and recently cached covers render
 * immediately with zero broken images.
 */
export function useResolvedArtwork(
  src?: string | null,
  trackId?: string | null,
  preferredSize = 600
): string | undefined {
  const version = useSyncExternalStore(subscribeArtworkVersion, getArtworkVersion, () => 0);
  void version;

  const [asyncLocalUrl, setAsyncLocalUrl] = useState<string | null>(() =>
    peekOfflineArtworkUrl(src, trackId)
  );

  useEffect(() => {
    const syncHit = peekOfflineArtworkUrl(src, trackId);
    setAsyncLocalUrl(syncHit);
    if (!src && !trackId) return;
    let cancelled = false;
    void resolveOfflineArtworkUrl(src, trackId).then((url) => {
      if (!cancelled && url) {
        setAsyncLocalUrl(url);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [src, trackId]);

  const syncHit = peekOfflineArtworkUrl(src, trackId);
  if (syncHit) return syncHit;
  if (asyncLocalUrl) return asyncLocalUrl;
  return upgradeArtwork(src ?? undefined, preferredSize);
}
