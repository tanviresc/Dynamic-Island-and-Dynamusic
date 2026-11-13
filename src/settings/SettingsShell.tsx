import React, { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { branding } from "../branding";
import { DevTestPanel } from "../devpanel/DevTestPanel";

type SettingsTab =
  | "general"
  | "sources"
  | "email"
  | "display"
  | "monitors"
  | "security"
  | "developer";

interface MonitorOption {
  id: string;
  name: string;
  is_primary: boolean;
  rect: { left: number; top: number; right: number; bottom: number };
  scale_factor: number;
}

export const SettingsShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("developer");
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [showHitRect, setShowHitRect] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDnd, setIsDnd] = useState<boolean>(false);

  // Security Tab State
  const [pairingToken, setPairingToken] = useState<string>("");
  const [isTokenVisible, setIsTokenVisible] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Monitor Settings (§3.4)
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [followActiveMonitor, setFollowActiveMonitor] = useState(true);
  const [fixedMonitorId, setFixedMonitorId] = useState<string>("");

  useEffect(() => {
    invoke<MonitorOption[]>("get_monitors")
      .then((list) => {
        setMonitors(list);
        if (list.length > 0 && !fixedMonitorId) {
          const primary = list.find((m) => m.is_primary) ?? list[0];
          if (primary) {
            setFixedMonitorId(primary.id);
          }
        }
      })
      .catch(() => {});
  }, []);

  const handleMonitorSettingChange = (follow: boolean, fixedId: string) => {
    setFollowActiveMonitor(follow);
    setFixedMonitorId(fixedId);
    invoke("set_monitor_settings", {
      followActive: follow,
      fixedMonitorId: fixedId || null,
    }).catch(() => {});
  };

  useEffect(() => {
    // Fetch pairing token from Tauri backend
    try {
      invoke<string>("get_pairing_token")
        .then((tok) => setPairingToken(tok))
        .catch(() => {});
    } catch {}
  }, []);

  const handleCopyToken = () => {
    if (pairingToken) {
      navigator.clipboard.writeText(pairingToken);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleRegenerateToken = () => {
    if (confirm("Regenerating the pairing token will disconnect all existing sources. Continue?")) {
      try {
        invoke<string>("regenerate_pairing_token")
          .then((newTok) => setPairingToken(newTok))
          .catch(() => {});
      } catch {}
    }
  };

  return (
    <div
      style={{
        display: "flex",
        height: "100vh",
        backgroundColor: "#111113",
        color: "#ffffff",
        fontFamily: "var(--font-family)",
      }}
    >
      {/* Sidebar Navigation */}
      <div
        style={{
          width: 200,
          borderRight: "1px solid rgba(255, 255, 255, 0.08)",
          padding: "20px 12px",
          display: "flex",
          flexDirection: "column",
          gap: 4,
          backgroundColor: "#161618",
        }}
      >
        <div style={{ padding: "0 8px 16px 8px", borderBottom: "1px solid rgba(255, 255, 255, 0.08)", marginBottom: 8 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, color: "#ffffff" }}>{branding.name}</h2>
          <span style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.44)" }}>v{branding.version}</span>
        </div>

        {(
          [
            ["general", "General"],
            ["sources", "Sources"],
            ["email", "Email"],
            ["display", "Display & Timers"],
            ["monitors", "Monitors"],
            ["security", "Security"],
            ["developer", "Developer"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setActiveTab(key)}
            style={{
              textAlign: "left",
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              backgroundColor: activeTab === key ? "rgba(255, 255, 255, 0.12)" : "transparent",
              color: activeTab === key ? "#ffffff" : "rgba(255, 255, 255, 0.65)",
              fontSize: 13,
              fontWeight: activeTab === key ? 600 : 400,
              cursor: "pointer",
              transition: "background-color 0.15s ease",
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Main Content Area */}
      <div style={{ flex: 1, padding: "24px 32px", overflowY: "auto" }}>
        {activeTab === "general" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>General Settings</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isPaused}
                  onChange={(e) => setIsPaused(e.target.checked)}
                />
                <span>Pause (hide all notifications completely, items still queued)</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={isDnd}
                  onChange={(e) => setIsDnd(e.target.checked)}
                />
                <span>Do Not Disturb (show dot only, never expand pill)</span>
              </label>

              <label style={{ display: "flex", alignItems: "center", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={reduceMotion}
                  onChange={(e) => setReduceMotion(e.target.checked)}
                />
                <span>Force Reduced Motion</span>
              </label>
            </div>
          </div>
        )}

        {activeTab === "security" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Security & Pairing</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 500 }}>
              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Server Port
                </label>
                <div style={{ padding: "8px 12px", backgroundColor: "rgba(255, 255, 255, 0.06)", borderRadius: 6, fontSize: 13 }}>
                  127.0.0.1:47821 (Loopback only)
                </div>
              </div>

              <div>
                <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 6 }}>
                  Pairing Token
                </label>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input
                    type={isTokenVisible ? "text" : "password"}
                    readOnly
                    value={pairingToken || "•••••••••••••••••••••••••••••••••••••••••••"}
                    style={{
                      flex: 1,
                      padding: "8px 12px",
                      backgroundColor: "rgba(255, 255, 255, 0.06)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: 13,
                      fontFamily: "monospace",
                      outline: "none",
                    }}
                  />
                  <button
                    onClick={() => setIsTokenVisible(!isTokenVisible)}
                    className="sec-btn"
                  >
                    {isTokenVisible ? "Hide" : "Show"}
                  </button>
                  <button onClick={handleCopyToken} className="sec-btn">
                    {copied ? "Copied!" : "Copy Token"}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.44)", marginTop: 6 }}>
                  Required by the browser extension and external hooks. Never share this token.
                </p>
              </div>

              <div>
                <button
                  onClick={handleRegenerateToken}
                  style={{
                    backgroundColor: "rgba(239, 68, 68, 0.15)",
                    border: "1px solid rgba(239, 68, 68, 0.4)",
                    color: "#f87171",
                    padding: "8px 14px",
                    borderRadius: 6,
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  Regenerate Token
                </button>
              </div>
            </div>
            <style>{`
              .sec-btn {
                background-color: rgba(255, 255, 255, 0.08);
                border: 1px solid rgba(255, 255, 255, 0.16);
                color: #ffffff;
                padding: 8px 12px;
                border-radius: 6px;
                font-size: 12px;
                font-weight: 500;
                cursor: pointer;
              }
              .sec-btn:hover {
                background-color: rgba(255, 255, 255, 0.14);
              }
            `}</style>
          </div>
        )}

        {activeTab === "monitors" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Multi-Monitor Settings</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: 20, maxWidth: 500 }}>
              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={followActiveMonitor}
                  onChange={(e) => handleMonitorSettingChange(e.target.checked, fixedMonitorId)}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>Follow active monitor (Default)</div>
                  <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                    The island follows the monitor containing the active window, with a 500ms debounce to prevent flicker.
                  </div>
                </div>
              </label>

              {!followActiveMonitor && (
                <div style={{ paddingLeft: 28 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, display: "block", marginBottom: 8 }}>
                    Fixed Monitor
                  </label>
                  <select
                    value={fixedMonitorId}
                    onChange={(e) => handleMonitorSettingChange(false, e.target.value)}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      backgroundColor: "rgba(255, 255, 255, 0.08)",
                      border: "1px solid rgba(255, 255, 255, 0.16)",
                      borderRadius: 6,
                      color: "#ffffff",
                      fontSize: 13,
                      outline: "none",
                    }}
                  >
                    {monitors.map((m) => {
                      const width = m.rect.right - m.rect.left;
                      const height = m.rect.bottom - m.rect.top;
                      const scale = Math.round(m.scale_factor * 100);
                      return (
                        <option key={m.id} value={m.id} style={{ backgroundColor: "#1e1e20" }}>
                          {m.name} — {width}×{height} ({scale}%) {m.is_primary ? "• Primary" : ""}
                        </option>
                      );
                    })}
                  </select>
                </div>
              )}
            </div>
          </div>
        )}

        {activeTab === "developer" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>Developer Tools</h2>
            <DevTestPanel
              isReducedMotion={reduceMotion}
              onToggleReducedMotion={() => setReduceMotion(!reduceMotion)}
              showHitRect={showHitRect}
              onToggleHitRect={() => setShowHitRect(!showHitRect)}
            />
          </div>
        )}

        {activeTab !== "general" &&
          activeTab !== "security" &&
          activeTab !== "developer" &&
          activeTab !== "monitors" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </h2>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 13 }}>
              Configured in subsequent integration phases.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
