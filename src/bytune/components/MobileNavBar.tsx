import { Home, Compass, Library } from "lucide-react";
import { useUI } from "../stores/ui";

export function MobileNavBar() {
  const view = useUI((s) => s.view);
  const navigate = useUI((s) => s.navigate);

  return (
    <nav className="fixed bottom-0 inset-x-0 h-16 bg-[#0e0e12]/95 border-t border-white/10 z-40 select-none safe-bottom">
      <div className="h-full max-w-md mx-auto flex items-center justify-between px-8">
        {/* Home Tab */}
        <button
          type="button"
          onClick={() => navigate({ name: "home" })}
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
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
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
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
          className={`flex flex-col items-center gap-1 py-1 px-4 rounded-xl transition-all ${
            view.name === "library" || view.name === "playlist" || view.name === "downloads" || view.name === "local"
              ? "text-white font-semibold scale-105"
              : "text-white/50 hover:text-white"
          }`}
        >
          <Library className={`w-5 h-5 ${view.name === "library" || view.name === "playlist" ? "stroke-[2.5]" : "stroke-[1.75]"}`} />
          <span className="text-[11px] leading-tight">Library</span>
        </button>
      </div>
    </nav>
  );
}
