import React, { useState, useEffect } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { IslandRoot } from "./island/IslandRoot";
import { SettingsShell } from "./settings/SettingsShell";
import { DynamusicShell } from "./dynamusic/DynamusicShell";
import "./shared/theme.css";

function App() {
  const [windowLabel, setWindowLabel] = useState<string>("island");
  const [isTauri, setIsTauri] = useState<boolean>(false);

  useEffect(() => {
    try {
      const win = getCurrentWebviewWindow();
      if (win && win.label) {
        setWindowLabel(win.label);
        setIsTauri(true);
      }
    } catch {
      // In browser development, window can be switched via query param: ?win=settings or ?win=dynamusic
      const params = new URLSearchParams(window.location.search);
      const winParam = params.get("win");
      if (winParam) {
        setWindowLabel(winParam);
      }
    }
  }, []);

  if (windowLabel === "settings") {
    return <SettingsShell />;
  }

  if (windowLabel === "dynamusic") {
    return <DynamusicShell />;
  }

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      {/* Dev switcher in browser preview */}
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
    <App />
  </React.StrictMode>
);
