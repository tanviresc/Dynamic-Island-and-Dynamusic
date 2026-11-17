/**
 * Strict 5-layer hierarchical back-button handler for Android hardware/gesture Back.
 * Prevents abrupt app exit from modals, lyrics, Now Playing sheet, or sub-pages.
 */
import { useUI } from "../stores/ui";

export type BackPressOutcome =
  | "closed_overlay"
  | "closed_lyrics"
  | "closed_now_playing"
  | "popped_nav"
  | "navigated_home"
  | "prompted_exit"
  | "minimized";

export interface BackUIAdapter {
  contextMenu: unknown | null;
  dialog: unknown | null;
  playlistPicker: unknown | null;
  rightPanel: "details" | "queue" | "room";
  viewName: string;
  searchQuery: string;
  lyricsCenter: boolean;
  nowPlayingOpen: boolean;
  navPastLength: number;
  closeContextMenu(): void;
  closeDialog(): void;
  closePlaylistPicker(): void;
  closePanels(): void;
  setSearchQuery(q: string): void;
  toggleLyrics(): void;
  toggleNowPlaying(): void;
  goBack(): void;
  goHome(): void;
  showExitToast(): void;
  minimizeApp(): void;
}

const EXIT_DOUBLE_TAP_WINDOW_MS = 2000;
let lastRootBackMs = 0;

export function resetBackExitTimer(): void {
  lastRootBackMs = 0;
}

export function processHierarchicalBack(
  ui: BackUIAdapter,
  nowMs = Date.now()
): BackPressOutcome {
  // Layer 5: Topmost overlays (context menu, modal dialog, playlist picker, Queue/Room drawer, active search)
  if (ui.contextMenu) {
    ui.closeContextMenu();
    return "closed_overlay";
  }
  if (ui.dialog) {
    ui.closeDialog();
    return "closed_overlay";
  }
  if (ui.playlistPicker) {
    ui.closePlaylistPicker();
    return "closed_overlay";
  }
  if (ui.rightPanel !== "details") {
    ui.closePanels();
    return "closed_overlay";
  }

  // Layer 4: Lyrics view -> collapse back to underlying screen or Now Playing sheet
  if (ui.lyricsCenter) {
    ui.toggleLyrics();
    return "closed_lyrics";
  }

  // Layer 3: Full-Screen Now Playing sheet -> collapse down to Mini-Player
  if (ui.nowPlayingOpen) {
    ui.toggleNowPlaying();
    return "closed_now_playing";
  }

  // Layer 5b: Active search query -> clear search results before leaving Search tab
  if (ui.viewName === "search" && ui.searchQuery.trim().length > 0) {
    ui.setSearchQuery("");
    return "closed_overlay";
  }

  // Layer 2: Sub-Pages / non-Home tab -> pop back stack or return to Home
  if (ui.navPastLength > 0) {
    ui.goBack();
    return "popped_nav";
  }
  if (ui.viewName !== "home") {
    ui.goHome();
    return "navigated_home";
  }

  // Layer 1: Home root -> double back to minimize/exit without killing audio playback
  if (lastRootBackMs > 0 && nowMs - lastRootBackMs <= EXIT_DOUBLE_TAP_WINDOW_MS) {
    lastRootBackMs = 0;
    ui.minimizeApp();
    return "minimized";
  }

  lastRootBackMs = nowMs;
  ui.showExitToast();
  return "prompted_exit";
}

function minimizeNativeApp(): void {
  try {
    const cap = (
      globalThis as {
        Capacitor?: { Plugins?: { MediaKeepalive?: { minimizeApp?: () => Promise<void> } } };
      }
    )?.Capacitor;
    void cap?.Plugins?.MediaKeepalive?.minimizeApp?.();
  } catch {
    /* ignore on desktop */
  }
}

export function handleAndroidBackButton(): BackPressOutcome {
  const s = useUI.getState();
  return processHierarchicalBack({
    contextMenu: s.contextMenu,
    dialog: s.dialog,
    playlistPicker: s.playlistPicker,
    rightPanel: s.rightPanel,
    viewName: s.view.name,
    searchQuery: s.searchQuery,
    lyricsCenter: s.lyricsCenter,
    nowPlayingOpen: s.nowPlayingOpen,
    navPastLength: s.navPast.length,
    closeContextMenu: s.closeContextMenu,
    closeDialog: s.closeDialog,
    closePlaylistPicker: s.closePlaylistPicker,
    closePanels: s.closePanels,
    setSearchQuery: s.setSearchQuery,
    toggleLyrics: s.toggleLyrics,
    toggleNowPlaying: s.toggleNowPlaying,
    goBack: s.goBack,
    goHome: () => s.navigate({ name: "home" }),
    showExitToast: () => s.toast("Press back again to exit", "info", 1800),
    minimizeApp: minimizeNativeApp,
  });
}

