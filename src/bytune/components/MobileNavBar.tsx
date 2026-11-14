import { Home, Compass, Library, Smartphone, Monitor } from "lucide-react";
import { useUI } from "../stores/ui";
import { useMobileMode, type MobileMode } from "../stores/mobileMode";

export function MobileNavBar() {
  const view = useUI((s) => s.view);
  const navigate = useUI((s) => s.navigate);
  const mode = useMobileMode((s) => s.mode);
  const setMode = useMobileMode((s) => s.setMode);

  return (
    <nav className="mobile-only-nav fixed bottom-0 inset-x-0 h-16 bg-[#0a0a0c]/90 backdrop-blur-xl border-t border-white/10 z-40 flex items-center justify-around px-2 select-none">
      <button
        type="button"
        onClick={() => navigate({ name: "home" })}
        className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-lg transition-colors ${
          view.name === "home" ? "text-white font-medium" : "text-white/50 hover:text-white"
        }`}
      >
        <Home className="w-5 h-5" />
        <span className="text-[10px] leading-tight tracking-tight">Home</span>
      </button>

      <button
        type="button"
        onClick={() => navigate({ name: "search" })}
        className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-lg transition-colors ${
          view.name === "search" ? "text-white font-medium" : "text-white/50 hover:text-white"
        }`}
      >
        <Compass className="w-5 h-5" />
        <span className="text-[10px] leading-tight tracking-tight">Explore</span>
      </button>

      <button
        type="button"
        onClick={() => navigate({ name: "library" })}
        className={`flex flex-col items-center gap-1 py-1 px-2.5 rounded-lg transition-colors ${
          view.name === "library" || view.name === "playlist" ? "text-white font-medium" : "text-white/50 hover:text-white"
        }`}
      >
        <Library className="w-5 h-5" />
        <span className="text-[10px] leading-tight tracking-tight">Library</span>
      </button>

      <div className="h-6 w-px bg-white/10 my-auto" />

      {/* Mode Switch: Mobile Mode vs PC Remote Mode */}
      <div className="flex items-center bg-white/10 p-0.5 rounded-full border border-white/10">
        <button
          type="button"
          onClick={() => setMode("phone")}
          title="Phone Mode: play and listen on this device"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
            mode === "phone"
              ? "bg-white text-black shadow-sm"
              : "text-white/60 hover:text-white"
          }`}
        >
          <Smartphone className="w-3.5 h-3.5" />
          <span>Phone</span>
        </button>

        <button
          type="button"
          onClick={() => setMode("pc_remote")}
          title="PC Mode: control playback on your PC from phone"
          className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-semibold transition-all ${
            mode === "pc_remote"
              ? "bg-emerald-500 text-black shadow-sm"
              : "text-white/60 hover:text-white"
          }`}
        >
          <Monitor className="w-3.5 h-3.5" />
          <span>PC</span>
        </button>
      </div>
    </nav>
  );
}
