/**
 * Liked Songs: a wall of the covers of the songs you liked; how many, how long, and who you like most;
 * then the songs, each lit by its own cover as the pointer passes. A song dropped on the page is liked
 * (App's panel drop).
 */
import { useEffect, useState } from "react";
import { Check, Download, Heart, Play, Shuffle, Smartphone } from "lucide-react";
import { CollectionHero, HERO_PLAY } from "../components/CollectionHero";
import { HERO_ROUND } from "../components/PlaylistHero";
import { TrackList } from "../components/TrackList";
import { Btn, EmptyState } from "../components/primitives";
import { collectionFacts } from "../lib/collection";
import { downloadAll } from "../lib/downloads";
import {
  getSavedOfflineCount,
  subscribeOfflineVault,
  syncLikedSongsToOfflineVault,
} from "../lib/offlineAudioVault";
import { useLibrary } from "../stores/library";
import { usePlayer } from "../stores/player";
import { useUI } from "../stores/ui";

export function LikedView() {
  const liked = useLibrary((s) => s.liked);
  const navigate = useUI((s) => s.navigate);
  const toast = useUI((s) => s.toast);
  const openDialog = useUI((s) => s.openDialog);
  const [, setVaultTick] = useState(0);
  const [lanUrl, setLanUrl] = useState<string>("http://192.168.0.2:47822");

  useEffect(() => {
    return subscribeOfflineVault(() => setVaultTick((n) => n + 1));
  }, []);

  useEffect(() => {
    fetch("http://127.0.0.1:47822/lan-info")
      .then((r) => r.json())
      .then((d: { urls?: string[] }) => {
        if (Array.isArray(d?.urls) && d.urls[0]) setLanUrl(d.urls[0]);
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    if (liked.length > 0) {
      void syncLikedSongsToOfflineVault(liked);
    }
  }, [liked]);

  const savedOfflineCount = getSavedOfflineCount(liked.map((t) => t.id));
  const allSavedOffline = liked.length > 0 && savedOfflineCount >= liked.length;
  const facts = collectionFacts(liked);
  const play = (shuffle: boolean): void => {
    if (!liked.length) return;
    if (shuffle) usePlayer.setState({ shuffle: true });
    usePlayer.getState().playQueue(liked, shuffle ? Math.floor(Math.random() * liked.length) : 0, "__liked__");
  };

  const handleSaveAllOffline = (): void => {
    if (!liked.length) return;
    void syncLikedSongsToOfflineVault(liked);
    downloadAll(liked, "Liked Songs");
    toast("Saving Liked Songs offline on PC & Mobile vault");
  };

  const handleShowPhoneSync = (): void => {
    try {
      void navigator.clipboard?.writeText(lanUrl);
    } catch {
      /* ignore */
    }
    openDialog({
      title: "Dynamusic on Your Phone (Offline Sync)",
      body: `Open ${lanUrl} in your phone's browser on the same Wi-Fi and tap "Add to Home Screen / Install App". Every song you like on PC or Mobile is saved inside the app so you can listen offline anywhere outside home. (Link copied to clipboard)`,
      confirmLabel: "Got it",
      notice: true,
      onConfirm: () => undefined,
    });
  };

  return (
    <div className="pb-16">
      <CollectionHero
        icon={Heart}
        kind="Liked by you · Stored offline in app"
        title="Liked Songs"
        covers={liked.map((t) => t.thumb)}
        facts={
          <>
            {[facts.songs, facts.length].filter(Boolean).join(" · ")}
            {liked.length > 0 && (
              <>
                {" · "}
                <span className="font-semibold text-white">
                  {allSavedOffline
                    ? "All saved offline in app"
                    : `${savedOfflineCount}/${liked.length} saved offline`}
                </span>
              </>
            )}
            {facts.topArtist && (
              <>
                {" · Your most liked: "}
                <span className="font-semibold text-white">{facts.topArtist.name}</span>
              </>
            )}
          </>
        }
      >
        <button type="button" className={HERO_PLAY} aria-label="Play Liked Songs" disabled={!liked.length} onClick={() => play(false)}>
          <Play className="w-5 h-5 fill-current" />
          Play
        </button>
        <button type="button" className={HERO_ROUND} aria-label="Shuffle" title="Shuffle" disabled={!liked.length} onClick={() => play(true)}>
          <Shuffle className="w-5 h-5" />
        </button>
        <button
          type="button"
          className={HERO_ROUND}
          aria-label="Save all Liked Songs offline"
          title={allSavedOffline ? "All Liked Songs saved offline in app" : "Save all Liked Songs for offline listening"}
          disabled={!liked.length}
          onClick={handleSaveAllOffline}
        >
          {allSavedOffline ? <Check className="w-5 h-5 text-emerald-400" /> : <Download className="w-5 h-5" />}
        </button>
        <button
          type="button"
          className={HERO_ROUND}
          aria-label="Phone offline sync link"
          title={`Open on Phone (${lanUrl})`}
          onClick={handleShowPhoneSync}
        >
          <Smartphone className="w-5 h-5" />
        </button>
      </CollectionHero>

      <div className="mt-6">
        {liked.length ? (
          <TrackList tracks={liked} from="__liked__" showAlbum />
        ) : (
          <EmptyState
            icon={Heart}
            title="Songs you like will show up here"
            body="Click the heart on any song, in the player, a playlist or search, and it lands here. Its cover joins the wall above."
            action={
              <Btn variant="white" onClick={() => navigate({ name: "search" })}>
                Find something to like
              </Btn>
            }
          />
        )}
      </div>
    </div>
  );
}
