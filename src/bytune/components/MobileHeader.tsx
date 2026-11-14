import { Search } from "lucide-react";
import { useUI } from "../stores/ui";
import { useSession, shownName } from "../lib/session";
import { avatarFor } from "../lib/avatar";
import { StreakChip } from "./Streak";
import brandLogo from "../assets/brand/bytune-logo.svg";
import brandText from "../assets/brand/bytune-Text.svg";

export function MobileHeader() {
  const navigate = useUI((s) => s.navigate);
  const view = useUI((s) => s.view);

  const sessionMode = useSession((s) => s.mode);
  const username = useSession((s) => s.username);
  const displayName = useSession((s) => s.displayName);
  const { color, letter } = avatarFor(sessionMode, username, shownName({ mode: sessionMode, username, displayName }));

  return (
    <header className="sticky top-0 inset-x-0 z-30 h-14 bg-[#0a0a0c]/90 backdrop-blur-xl border-b border-white/10 px-3 flex items-center justify-between select-none">
      {/* Brand logo */}
      <button
        type="button"
        onClick={() => navigate({ name: "home" })}
        className="flex items-center gap-2 active:opacity-80 transition-opacity"
      >
        <img src={brandLogo} alt="" aria-hidden className="h-6 w-auto block" />
        <img src={brandText} alt="Dynamusic" className="h-4 w-auto block" />
      </button>

      {/* Right Controls */}
      <div className="flex items-center gap-2">
        <StreakChip />

        {/* Search shortcut button */}
        <button
          type="button"
          onClick={() => navigate({ name: "search" })}
          className={`p-2 rounded-full transition-colors ${
            view.name === "search" ? "text-white bg-white/15" : "text-white/70 hover:text-white bg-white/5"
          }`}
          title="Search"
          aria-label="Search"
        >
          <Search className="w-4 h-4" />
        </button>

        {/* Profile Avatar -> Settings */}
        <button
          type="button"
          onClick={() => useUI.getState().openSettings()}
          className="w-8 h-8 rounded-full grid place-items-center bg-white/10 active:scale-95 transition-transform"
          title="Settings & Profile"
          aria-label="Settings"
        >
          <span
            className="grid h-7 w-7 place-items-center rounded-full text-[13px] font-bold leading-none text-black/85"
            style={{ backgroundColor: color }}
          >
            {letter}
          </span>
        </button>
      </div>
    </header>
  );
}

