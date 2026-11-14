import { Home, Compass, Library, Smartphone, Monitor } from "lucide-react";
import { useUI } from "../stores/ui";
import { useMobileMode } from "../stores/mobileMode";

export function MobileNavBar() {
  const view = useUI((s) => s.view);
  const navigate = useUI((s) => s.navigate);
  const mode = useMobileMode((s) => s.mode);
  const setMode = useMobileMode((s) => s.setMode);

  return (
    <nav className="fixed bottom-0 inset-x-0 h-16 bg-[#0a0a0c]/95 backdrop-blur-xl border-t border-white/10 z-40 flex items-center justify-around px-4 select-none safe-bottom">
      {/* Home Tab */}
      <button
        type="button"
        onClick={() => navigate({ name: "home" })}
        className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
          view.name === "home" ? "text-white font-semibold scale-105" : "text-white/50 hover:text-white"
        }`}
      >
        <Home className={`w-5 h-5 ${view.name === "home" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
        <span className="text-[11px] leading-tight">Home</span>
      </button>

      {/* Explore / Search Tab */}
      <button
        type="button"
        onClick={() => navigate({ name: "search" })}
        className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
          view.name === "search" || view.name === "explore" ? "text-white font-semibold scale-105" : "text-white/50 hover:text-white"
        }`}
      >
        <Compass className={`w-5 h-5 ${view.name === "search" || view.name === "explore" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
        <span className="text-[11px] leading-tight">Search</span>
      </button>

      {/* Library Tab */}
      <button
        type="button"
        onClick={() => navigate({ name: "library" })}
        className={`flex flex-col items-center gap-1 py-1 px-3 rounded-xl transition-all ${
          view.name === "library" || view.name === "playlist" || view.name === "downloads" || view.name === "local"
            ? "text-white font-semibold scale-105"
            : "text-white/50 hover:text-white"
        }`}
      >
        <Library className={`w-5 h-5 ${view.name === "library" || view.name === "playlist" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
        <span className="text-[11px] leading-tight">Library</span>
      </button>

      <div className="h-6 w-px bg-white/10 my-auto" />

      {/* Mode Switcher */}
      <button
        type="button"
        onClick={() => setMode(mode === "phone" ? "pc_remote" : "phone")}
        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-semibold border transition-all ${
          mode === "pc_remote"
            ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
            : "bg-white/10 text-white border-white/20"
        }`}
        title={`Current mode: ${mode === "phone" ? "Phone" : "PC Remote"}. Tap to switch.`}
      >
        {mode === "pc_remote" ? (
          <>
            <Monitor className="w-3.5 h-3.5 text-emerald-400" />
            <span>PC Mode</span>
          </>
        ) : (
          <>
            <Smartphone className="w-3.5 h-3.5 text-white" />
            <span>Phone Mode</span>
          </>
        )}
      </button>
    </nav>
  );
}
