import React, { useState } from "react";
import { DynamusicProvider, useDynamusic } from "./useDynamusicStore";
import { TopBar } from "./components/TopBar";
import { Sidebar } from "./components/Sidebar";
import { RightRail } from "./components/RightRail";
import { PlayerBar } from "./PlayerBar";
import { EqualizerModal } from "./EqualizerModal";
import { SyncedLyricsView } from "./SyncedLyricsView";
import { HomeView } from "./views/HomeView";
import { ArtistView } from "./views/ArtistView";
import { LikedView } from "./views/LikedView";
import { SpotifyView } from "./views/SpotifyView";
import { FolderView } from "./views/FolderView";
import { LocalMusicView } from "./views/LocalMusicView";
import { DownloadsView } from "./views/DownloadsView";
import { ReplayView } from "./views/ReplayView";
import { SearchView } from "./views/SearchView";

const ViewRouter: React.FC = () => {
  const { navView, lyricsCenter, addLocalFiles } = useDynamusic();

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addLocalFiles(e.dataTransfer.files);
    }
  };

  const renderCurrentView = () => {
    switch (navView.name) {
      case "home":
        return <HomeView />;
      case "artist":
        return <ArtistView artistId={"artistId" in navView ? navView.artistId : undefined} />;
      case "liked":
        return <LikedView />;
      case "spotify":
        return <SpotifyView />;
      case "folder":
        return <FolderView folderId={"folderId" in navView ? navView.folderId : undefined} />;
      case "local":
        return <LocalMusicView />;
      case "downloads":
        return <DownloadsView />;
      case "replay":
        return <ReplayView />;
      case "search":
        return <SearchView />;
      default:
        return <HomeView />;
    }
  };

  return (
    <main
      className="flex-1 min-w-0 flex flex-col bg-[#121214] rounded-2xl overflow-hidden relative border border-white/[0.04]"
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {lyricsCenter ? (
        <SyncedLyricsView />
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto px-8 pt-5 pb-8 custom-scroll relative">
          {renderCurrentView()}
        </div>
      )}
    </main>
  );
};

const DynamusicMain: React.FC = () => {
  const [isEqOpen, setIsEqOpen] = useState(false);

  React.useEffect(() => {
    document.body.style.backgroundColor = "#000000";
    return () => {
      document.body.style.backgroundColor = "transparent";
    };
  }, []);

  return (
    <div className="h-screen w-screen flex flex-col bg-black text-white overflow-hidden select-none font-sans">
      <TopBar />

      {/* 3-Pane shell: Sidebar (280px) · Main Content · Right Rail (316px) */}
      <div className="flex flex-1 min-h-0 gap-2 px-2 pb-1 pt-1 overflow-hidden">
        <Sidebar />
        <ViewRouter />
        <RightRail />
      </div>

      <PlayerBar onOpenEq={() => setIsEqOpen(true)} />
      <EqualizerModal isOpen={isEqOpen} onClose={() => setIsEqOpen(false)} />
    </div>
  );
};

export const DynamusicShell: React.FC = () => {
  return (
    <DynamusicProvider>
      <DynamusicMain />
    </DynamusicProvider>
  );
};
