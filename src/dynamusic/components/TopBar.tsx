import React, { useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  RotateCw,
  Home,
  Search,
  Compass,
  Minus,
  Square,
  X,
} from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useDynamusic } from "../useDynamusicStore";
import bytuneLogo from "../../assets/brand/bytune-logo.svg";
import bytuneText from "../../assets/brand/bytune-Text.svg";

export const TopBar: React.FC = () => {
  const {
    canGoBack,
    canGoForward,
    goBack,
    goForward,
    reloadView,
    navigate,
    performSearch,
    searchQuery,
    setSearchQuery,
  } = useDynamusic();

  const [inputVal, setInputVal] = useState(searchQuery);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVal.trim()) {
      setSearchQuery(inputVal);
      performSearch(inputVal);
    }
  };

  const handleMinimize = async () => {
    try {
      const win = getCurrentWindow();
      await win.minimize();
    } catch {
      // web fallback
    }
  };

  const handleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
    } catch {
      // web fallback
    }
  };

  const handleClose = async () => {
    try {
      const win = getCurrentWindow();
      await win.close();
    } catch {
      // web fallback
    }
  };

  return (
    <header
      className="h-[52px] shrink-0 flex items-center justify-between px-3 select-none"
      style={{
        background: "rgba(0, 0, 0, 0.72)",
        backdropFilter: "blur(24px) saturate(140%)",
        borderBottom: "1px solid rgba(255, 255, 255, 0.05)",
        ...({ WebkitAppRegion: "drag" } as React.CSSProperties),
      }}
    >
      {/* Left: Brand mark + History chevrons + Refresh */}
      <div
        className="flex items-center gap-3"
        style={{ ...({ WebkitAppRegion: "no-drag" } as React.CSSProperties) }}
      >
        <button
          onClick={() => navigate({ name: "home" })}
          className="flex items-center gap-2 hover:opacity-90 transition-opacity"
          title="ByTune Home"
        >
          <img src={bytuneLogo} alt="" aria-hidden className="h-[22px] w-auto block" />
          <img src={bytuneText} alt="ByTune" className="h-[17px] w-auto block" />
        </button>

        <div className="flex items-center gap-1 ml-1 text-white/70">
          <button
            onClick={goBack}
            disabled={!canGoBack}
            title="Go back"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/70 transition-colors"
          >
            <ChevronLeft className="w-4 h-4 stroke-[2.5]" />
          </button>
          <button
            onClick={goForward}
            disabled={!canGoForward}
            title="Go forward"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-white/70 transition-colors"
          >
            <ChevronRight className="w-4 h-4 stroke-[2.5]" />
          </button>
          <button
            onClick={reloadView}
            title="Reload view"
            className="w-7 h-7 rounded-full flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors"
          >
            <RotateCw className="w-3.5 h-3.5 stroke-[2.2]" />
          </button>
        </div>
      </div>

      {/* Center: Home pill + Wide Search input pill */}
      <div
        className="flex items-center gap-2 flex-1 max-w-[540px] mx-4"
        style={{ ...({ WebkitAppRegion: "no-drag" } as React.CSSProperties) }}
      >
        <button
          onClick={() => navigate({ name: "home" })}
          title="Home"
          className="w-10 h-10 rounded-full bg-white/10 hover:bg-white/15 text-white flex items-center justify-center transition-colors shrink-0"
        >
          <Home className="w-4 h-4" />
        </button>

        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <div className="flex items-center bg-[#1f1f22]/90 hover:bg-[#28282c] focus-within:bg-[#28282c] border border-white/10 focus-within:border-white/30 h-10 rounded-full px-3.5 transition-colors">
            <Search className="w-4 h-4 text-white/50 shrink-0 mr-2.5" />
            <input
              type="text"
              placeholder="What do you want to play?"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              className="bg-transparent border-none outline-none text-[13.5px] text-white placeholder-white/45 w-full font-medium"
            />
            <button
              type="button"
              onClick={() => navigate({ name: "home" })}
              title="Explore"
              className="text-white/45 hover:text-white ml-2 transition-colors shrink-0"
            >
              <Compass className="w-4 h-4" />
            </button>
          </div>
        </form>
      </div>

      {/* Right: Streak + Avatar + Window controls */}
      <div
        className="flex items-center gap-2"
        style={{ ...({ WebkitAppRegion: "no-drag" } as React.CSSProperties) }}
      >
        {/* Streak chip: 🔥 9 days */}
        <div
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-white/[0.06] hover:bg-white/[0.1] border border-white/10 text-[12.5px] font-semibold text-white/90 select-none transition-colors"
          title="Listening Streak: 9 days"
        >
          <span className="text-orange-400">🔥</span>
          <span>9 days</span>
        </div>

        {/* Profile Avatar: Lime-green circle with black R */}
        <button
          title="Settings & Profile"
          className="w-8 h-8 rounded-full bg-[#a3e635] text-black font-extrabold text-[13.5px] flex items-center justify-center hover:scale-105 active:scale-95 transition-transform"
        >
          R
        </button>

        {/* Window controls */}
        <div className="flex items-center ml-2 text-white/60">
          <button
            onClick={handleMinimize}
            title="Minimize"
            className="w-8 h-8 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={handleMaximize}
            title="Maximize"
            className="w-8 h-8 flex items-center justify-center hover:bg-white/10 hover:text-white transition-colors"
          >
            <Square className="w-3 h-3" />
          </button>
          <button
            onClick={handleClose}
            title="Close"
            className="w-8 h-8 flex items-center justify-center hover:bg-red-500/80 hover:text-white transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </header>
  );
};
