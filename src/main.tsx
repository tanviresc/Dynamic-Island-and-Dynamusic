import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { IslandRoot } from "./island/IslandRoot";
import { SettingsShell } from "./settings/SettingsShell";
import { initBytuneBridge } from "./bytune/lib/initBytuneBridge";
import { initIslandBridge } from "./bytune/lib/islandBridge";
import ByTuneApp from "./bytune/App";
import { PipApp } from "./bytune/pip/PipApp";
import { ErrorBoundary } from "./bytune/components/ErrorBoundary";
import { endIntro } from "./bytune/intro";
import "./bytune/lib/platform";
import "./bytune/index.css";
import "./shared/theme.css";

initBytuneBridge();

function detectInitialWindowLabel(): { label: string; isTauri: boolean } {
  try {
    const win = getCurrentWebviewWindow();
    if (win && win.label) {
      return { label: win.label, isTauri: true };
    }
  } catch {
    /* fallback to URL search params */
  }
  const params = new URLSearchParams(window.location.search);
  const explicit = params.get("win") || params.get("window");
  if (explicit) {
    return { label: explicit, isTauri: false };
  }
  const isMobileOrSidecarPort =
    window.location.port === "47822" ||
    /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent || "");
  return { label: isMobileOrSidecarPort ? "dynamusic" : "island", isTauri: false };
}

if (typeof window !== "undefined" && !("__TAURI_INTERNALS__" in window) && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  });
}

function RootRouter() {
  const initial = detectInitialWindowLabel();
  const [windowLabel, setWindowLabel] = useState<string>(initial.label);
  const [isTauri, setIsTauri] = useState<boolean>(initial.isTauri);

  useEffect(() => {
    try {
      const win = getCurrentWebviewWindow();
      if (win && win.label) {
        setWindowLabel(win.label);
        setIsTauri(true);
      }
    } catch {
      const params = new URLSearchParams(window.location.search);
      const winParam = params.get("win") || params.get("window");
      if (winParam) {
        setWindowLabel(winParam);
      }
    }
  }, []);

  useEffect(() => {
    if (windowLabel === "dynamusic") {
      initBytuneBridge();
      initIslandBridge();
      endIntro();
    }
  }, [windowLabel]);

  if (windowLabel === "settings") {
    return <SettingsShell />;
  }

  if (windowLabel === "pip") {
    return (
      <ErrorBoundary>
        <PipApp />
      </ErrorBoundary>
    );
  }

  if (windowLabel === "dynamusic") {
    return (
      <ErrorBoundary>
        <ByTuneApp />
      </ErrorBoundary>
    );
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {!isTauri && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            right: 16,
            display: "flex",
            gap: 8,
            zIndex: 9999,
          }}
        >
          <a
            href="?win=island"
            style={{
              padding: "6px 12px",
              backgroundColor: "#222",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
            }}
          >
            Island View
          </a>
          <a
            href="?win=dynamusic"
            style={{
              padding: "6px 12px",
              backgroundColor: "#00c2ff",
              color: "#000",
              fontWeight: 700,
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
            }}
          >
            Dynamusic View
          </a>
          <a
            href="?win=settings"
            style={{
              padding: "6px 12px",
              backgroundColor: "#222",
              color: "#fff",
              borderRadius: 6,
              textDecoration: "none",
              fontSize: 12,
            }}
          >
            Settings View
          </a>
        </div>
      )}

      <IslandRoot />
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <RootRouter />
  </React.StrictMode>
);
