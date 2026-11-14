/**
 * Platform surface for the renderer.
 *
 * The preload bridge reports the real process.platform; a plain-browser dev
 * run (no bridge) assumes the platform this project targets — macOS — so
 * the layout still previews correctly outside Electron on a Mac.
 */
function detectPlatform(): string {
  if (typeof window !== "undefined") {
    if (window.bytune?.platform) return window.bytune.platform;
    const nav = typeof navigator !== "undefined" ? navigator : undefined;
    const ua = nav?.userAgent || "";
    const plat = nav?.platform || "";
    if (/Mac|Darwin/i.test(plat) || /Macintosh|Mac OS X/i.test(ua)) {
      return "darwin";
    }
    if (/Android/i.test(ua)) {
      return "android";
    }
    if (/Linux/i.test(plat) && !/Win/i.test(plat)) {
      return "linux";
    }
  }
  return "win32";
}

export const platform: string = detectPlatform();

export const isMac = platform === "darwin";
export const isWindows = platform === "win32";

// One class on <html> drives the platform CSS (font stack; caption-button
// visibility is handled in React). Runs at module import, before first paint.
if (typeof document !== "undefined") {
  document.documentElement.classList.toggle("platform-mac", isMac);
  document.documentElement.classList.toggle("platform-windows", platform === "win32");
}
