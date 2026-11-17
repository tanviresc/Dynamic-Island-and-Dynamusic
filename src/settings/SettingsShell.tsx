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

interface DesktopApp {
  id: string;
  displayName: string;
  source: "claude" | "chatgpt" | "gemini";
  processNames: string[];
  enabled: boolean;
  detection: "toast" | "uia";
}

interface OAuthClientConfig {
  clientId: string;
  clientSecret: string;
}

interface GmailAccountConfig {
  alias: string;
  email: string;
  historyId?: string | null;
  lastPollAt?: number | null;
  dryRun: boolean;
  privacyMode: boolean;
  fallbackEnabled: boolean;
  otpPopupOnly: boolean;
  categoryModes: Record<string, "popup" | "queue_only" | "off">;
  labelMap: Record<string, string>;
}

export const SettingsShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("developer");
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [showHitRect, setShowHitRect] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDnd, setIsDnd] = useState<boolean>(false);
  const [autostart, setAutostart] = useState<boolean>(false);

  // Security Tab State
  const [pairingToken, setPairingToken] = useState<string>("");
  const [isTokenVisible, setIsTokenVisible] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  // Monitor Settings (§3.4)
  const [monitors, setMonitors] = useState<MonitorOption[]>([]);
  const [followActiveMonitor, setFollowActiveMonitor] = useState(true);
  const [fixedMonitorId, setFixedMonitorId] = useState<string>("");

  // Desktop Apps State (§6.5 & §6.6)
  const [desktopApps, setDesktopApps] = useState<DesktopApp[]>([]);
  const [appsSaved, setAppsSaved] = useState<boolean>(false);

  // Email Tab State (§7.5)
  const [oauthClient, setOauthClient] = useState<OAuthClientConfig | null>(null);
  const [oauthJsonInput, setOauthJsonInput] = useState<string>("");
  const [showJsonInput, setShowJsonInput] = useState<boolean>(false);
  const [gmailAccounts, setGmailAccounts] = useState<GmailAccountConfig[]>([]);
  const [newAccountAlias, setNewAccountAlias] = useState<string>("");
  const [isAuthenticating, setIsAuthenticating] = useState<boolean>(false);
  const [emailStatusMsg, setEmailStatusMsg] = useState<string>("");

  // Display & Timers State
  const [displayMs, setDisplayMs] = useState<number>(4000);
  const [displaySaved, setDisplaySaved] = useState<boolean>(false);

  useEffect(() => {
    invoke<boolean>("get_autostart")
      .then((val) => setAutostart(val))
      .catch(() => {});
    invoke<OAuthClientConfig | null>("get_gmail_oauth_client")
      .then((cfg) => setOauthClient(cfg))
      .catch(() => {});
    invoke<GmailAccountConfig[]>("get_gmail_accounts")
      .then((accs) => setGmailAccounts(accs))
      .catch(() => {});
    invoke<{ displayMs: number }>("get_display_settings")
      .then((res) => {
        if (res && typeof res.displayMs === "number") {
          setDisplayMs(res.displayMs);
        }
      })
      .catch(() => {});
  }, []);

  const handleUpdateDisplayMs = (nextMs: number) => {
    const clamped = Math.min(15000, Math.max(1000, Math.round(nextMs)));
    setDisplayMs(clamped);
    invoke<{ displayMs: number }>("set_display_settings", { displayMs: clamped })
      .then(() => {
        setDisplaySaved(true);
        setTimeout(() => setDisplaySaved(false), 1500);
      })
      .catch(() => {});
  };

  const handleToggleAutostart = (enabled: boolean) => {
    setAutostart(enabled);
    invoke("set_autostart", { enabled }).catch((err) =>
      alert("Failed to update autostart setting: " + err)
    );
  };

  const handleImportClientJson = (rawJson?: string) => {
    const content = rawJson || oauthJsonInput;
    if (!content.trim()) return;
    invoke<OAuthClientConfig>("import_gmail_oauth_client", { jsonContent: content })
      .then((cfg) => {
        setOauthClient(cfg);
        setOauthJsonInput("");
        setShowJsonInput(false);
        setEmailStatusMsg("OAuth Client imported successfully!");
        setTimeout(() => setEmailStatusMsg(""), 3000);
      })
      .catch((err) => alert("Failed to import OAuth Client: " + err));
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (content) {
        handleImportClientJson(content);
      }
    };
    reader.readAsText(file);
  };

  const handleConnectGmail = () => {
    if (!newAccountAlias.trim()) {
      alert("Please enter an alias for this account (e.g. 'Personal' or 'Work')");
      return;
    }
    setIsAuthenticating(true);
    setEmailStatusMsg("Opening browser for Google authorization... Please sign in and approve.");
    invoke<GmailAccountConfig>("start_gmail_oauth", { alias: newAccountAlias.trim() })
      .then((newAcc) => {
        setGmailAccounts((prev) => [...prev.filter((a) => a.alias !== newAcc.alias), newAcc]);
        setNewAccountAlias("");
        setIsAuthenticating(false);
        setEmailStatusMsg("Account connected successfully!");
        setTimeout(() => setEmailStatusMsg(""), 3000);
      })
      .catch((err) => {
        setIsAuthenticating(false);
        setEmailStatusMsg("");
        alert("Authentication error: " + err);
      });
  };

  const handleRemoveAccount = (alias: string) => {
    if (!confirm(`Are you sure you want to disconnect ${alias}?`)) return;
    invoke("remove_gmail_account", { alias })
      .then(() => {
        setGmailAccounts((prev) => prev.filter((a) => a.alias !== alias));
      })
      .catch((err) => alert("Failed to remove account: " + err));
  };

  const handleUpdateAccount = (updated: GmailAccountConfig) => {
    setGmailAccounts((prev) => prev.map((a) => (a.alias === updated.alias ? updated : a)));
    invoke("save_gmail_account_settings", { account: updated }).catch((err) =>
      alert("Failed to save settings: " + err)
    );
  };

  useEffect(() => {
    invoke<DesktopApp[]>("get_desktop_apps")
      .then((apps) => setDesktopApps(apps))
      .catch(() => {});
  }, []);

  const handleSaveDesktopApps = () => {
    invoke("save_desktop_apps", { apps: desktopApps })
      .then(() => {
        setAppsSaved(true);
        setTimeout(() => setAppsSaved(false), 2000);
      })
      .catch((err) => alert("Failed to save desktop apps: " + err));
  };

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

              <label style={{ display: "flex", alignItems: "flex-start", gap: 12, cursor: "pointer", marginTop: 4 }}>
                <input
                  type="checkbox"
                  checked={autostart}
                  onChange={(e) => handleToggleAutostart(e.target.checked)}
                  style={{ marginTop: 3 }}
                />
                <div>
                  <div style={{ fontSize: 14, fontWeight: 500 }}>Launch on Windows Startup (Autostart)</div>
                  <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                    Starts Island automatically in the background when you log in to Windows.
                  </div>
                </div>
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

        {activeTab === "sources" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Desktop AI Applications</h2>
                <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                  Detect completions and approval requests from native desktop AI apps.
                </p>
              </div>
              <button
                onClick={handleSaveDesktopApps}
                style={{
                  backgroundColor: "#2563eb",
                  color: "#ffffff",
                  padding: "8px 16px",
                  borderRadius: 6,
                  border: "none",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                }}
              >
                {appsSaved ? "Saved!" : "Save Changes"}
              </button>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: 16, maxWidth: 600 }}>
              {desktopApps.map((app, idx) => (
                <div
                  key={app.id}
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 8,
                    padding: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
                      <input
                        type="checkbox"
                        checked={app.enabled}
                        onChange={(e) => {
                          const updated = [...desktopApps];
                          updated[idx] = { ...app, enabled: e.target.checked };
                          setDesktopApps(updated);
                        }}
                      />
                      <span style={{ fontSize: 15, fontWeight: 600 }}>{app.displayName}</span>
                    </label>

                    <select
                      value={app.detection}
                      onChange={(e) => {
                        const updated = [...desktopApps];
                        updated[idx] = { ...app, detection: e.target.value as "toast" | "uia" };
                        setDesktopApps(updated);
                      }}
                      style={{
                        padding: "6px 10px",
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        border: "1px solid rgba(255, 255, 255, 0.16)",
                        borderRadius: 6,
                        color: "#ffffff",
                        fontSize: 12,
                        outline: "none",
                      }}
                    >
                      <option value="uia" style={{ backgroundColor: "#1e1e20" }}>
                        UI Automation (Window Watcher)
                      </option>
                      <option value="toast" style={{ backgroundColor: "#1e1e20" }}>
                        Windows Toast (Notification Listener)
                      </option>
                    </select>
                  </div>

                  <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 4 }}>
                    <label style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)" }}>
                      Process Names (comma separated)
                    </label>
                    <input
                      type="text"
                      value={app.processNames.join(", ")}
                      onChange={(e) => {
                        const names = e.target.value
                          .split(",")
                          .map((s) => s.trim())
                          .filter((s) => s.length > 0);
                        const updated = [...desktopApps];
                        updated[idx] = { ...app, processNames: names };
                        setDesktopApps(updated);
                      }}
                      style={{
                        padding: "6px 10px",
                        backgroundColor: "rgba(255, 255, 255, 0.06)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: 6,
                        color: "#ffffff",
                        fontSize: 12,
                        fontFamily: "monospace",
                        outline: "none",
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "email" && (
          <div>
            <div style={{ marginBottom: 20 }}>
              <h2 style={{ fontSize: 18, fontWeight: 600 }}>Gmail Integration</h2>
              <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                Receive notifications for important incoming emails across up to 2 accounts via Gmail REST metadata polling.
              </p>
            </div>

            {emailStatusMsg && (
              <div
                style={{
                  padding: "10px 14px",
                  borderRadius: 6,
                  backgroundColor: "rgba(59, 130, 246, 0.15)",
                  border: "1px solid rgba(59, 130, 246, 0.4)",
                  color: "#93c5fd",
                  fontSize: 13,
                  marginBottom: 16,
                }}
              >
                {emailStatusMsg}
              </div>
            )}

            {/* 1. Google OAuth Client Setup Card */}
            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 8,
                padding: 16,
                marginBottom: 20,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600 }}>OAuth Client Credentials</div>
                  <div style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                    Imported from Google Cloud Console (Desktop application client JSON).
                  </div>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <span
                    style={{
                      padding: "4px 8px",
                      borderRadius: 4,
                      fontSize: 11,
                      fontWeight: 600,
                      backgroundColor: oauthClient ? "rgba(34, 197, 94, 0.15)" : "rgba(245, 158, 11, 0.15)",
                      color: oauthClient ? "#4ade80" : "#fbbf24",
                      border: `1px solid ${oauthClient ? "rgba(34, 197, 94, 0.3)" : "rgba(245, 158, 11, 0.3)"}`,
                    }}
                  >
                    {oauthClient ? "Configured" : "Not Configured"}
                  </span>
                  {oauthClient && (
                    <button
                      onClick={() => setShowJsonInput(!showJsonInput)}
                      style={{
                        padding: "4px 8px",
                        borderRadius: 4,
                        fontSize: 11,
                        backgroundColor: "rgba(255, 255, 255, 0.08)",
                        border: "1px solid rgba(255, 255, 255, 0.16)",
                        color: "#fff",
                        cursor: "pointer",
                      }}
                    >
                      {showJsonInput ? "Cancel" : "Replace"}
                    </button>
                  )}
                </div>
              </div>

              {(!oauthClient || showJsonInput) && (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 10 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="file"
                      accept=".json"
                      onChange={handleFileUpload}
                      style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.7)" }}
                    />
                    <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.4)" }}>or paste JSON below</span>
                  </div>
                  <textarea
                    rows={4}
                    value={oauthJsonInput}
                    onChange={(e) => setOauthJsonInput(e.target.value)}
                    placeholder="Paste credentials.json here..."
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      backgroundColor: "rgba(0, 0, 0, 0.3)",
                      border: "1px solid rgba(255, 255, 255, 0.12)",
                      borderRadius: 6,
                      color: "#fff",
                      fontSize: 12,
                      fontFamily: "monospace",
                      resize: "vertical",
                      outline: "none",
                    }}
                  />
                  <div>
                    <button
                      onClick={() => handleImportClientJson()}
                      disabled={!oauthJsonInput.trim()}
                      style={{
                        padding: "6px 14px",
                        borderRadius: 6,
                        backgroundColor: "#2563eb",
                        color: "#fff",
                        border: "none",
                        fontSize: 12,
                        fontWeight: 500,
                        cursor: oauthJsonInput.trim() ? "pointer" : "not-allowed",
                        opacity: oauthJsonInput.trim() ? 1 : 0.5,
                      }}
                    >
                      Save Client Configuration
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* 2. Connected Accounts Section */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontSize: 15, fontWeight: 600 }}>Connected Accounts ({gmailAccounts.length}/2)</h3>
              </div>

              {gmailAccounts.length < 2 && (
                <div
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.03)",
                    border: "1px dashed rgba(255, 255, 255, 0.15)",
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Add Account</div>
                  <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <input
                      type="text"
                      placeholder="Account Alias (e.g. Personal, Work)"
                      value={newAccountAlias}
                      onChange={(e) => setNewAccountAlias(e.target.value)}
                      style={{
                        flex: 1,
                        padding: "8px 12px",
                        backgroundColor: "rgba(255, 255, 255, 0.06)",
                        border: "1px solid rgba(255, 255, 255, 0.12)",
                        borderRadius: 6,
                        color: "#fff",
                        fontSize: 13,
                        outline: "none",
                      }}
                    />
                    <button
                      onClick={handleConnectGmail}
                      disabled={!oauthClient || isAuthenticating || !newAccountAlias.trim()}
                      style={{
                        padding: "8px 16px",
                        borderRadius: 6,
                        backgroundColor: oauthClient && !isAuthenticating ? "#2563eb" : "rgba(255, 255, 255, 0.1)",
                        color: "#fff",
                        border: "none",
                        fontSize: 13,
                        fontWeight: 500,
                        cursor: oauthClient && !isAuthenticating ? "pointer" : "not-allowed",
                        opacity: oauthClient && !isAuthenticating ? 1 : 0.5,
                        whiteSpace: "nowrap",
                      }}
                    >
                      {isAuthenticating ? "Authenticating..." : "Connect with Google"}
                    </button>
                  </div>
                  {!oauthClient && (
                    <p style={{ fontSize: 11, color: "#f87171", marginTop: 6 }}>
                      Import OAuth client credentials above before connecting accounts.
                    </p>
                  )}
                </div>
              )}

              {gmailAccounts.map((acc) => (
                <div
                  key={acc.alias}
                  style={{
                    backgroundColor: "rgba(255, 255, 255, 0.04)",
                    border: "1px solid rgba(255, 255, 255, 0.1)",
                    borderRadius: 8,
                    padding: 16,
                    marginBottom: 16,
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <div>
                      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                        <span style={{ fontSize: 15, fontWeight: 600 }}>{acc.alias}</span>
                        <span style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)" }}>({acc.email})</span>
                      </div>
                      <div style={{ fontSize: 11, color: "rgba(255, 255, 255, 0.4)", marginTop: 2 }}>
                        {acc.lastPollAt ? `Last checked: ${new Date(acc.lastPollAt).toLocaleTimeString()}` : "Not polled yet"}
                      </div>
                    </div>
                    <button
                      onClick={() => handleRemoveAccount(acc.alias)}
                      style={{
                        padding: "4px 10px",
                        borderRadius: 4,
                        backgroundColor: "rgba(239, 68, 68, 0.15)",
                        border: "1px solid rgba(239, 68, 68, 0.3)",
                        color: "#f87171",
                        fontSize: 12,
                        cursor: "pointer",
                      }}
                    >
                      Disconnect
                    </button>
                  </div>

                  {/* Mode Toggles */}
                  <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16, paddingTop: 10, borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={acc.dryRun}
                        onChange={(e) => handleUpdateAccount({ ...acc, dryRun: e.target.checked })}
                      />
                      <span>Dry Run Mode (Log label/alias/timestamp only, no notifications shown)</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={acc.privacyMode}
                        onChange={(e) => handleUpdateAccount({ ...acc, privacyMode: e.target.checked })}
                      />
                      <span>Privacy Mode (Hide email subject in notifications)</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={acc.fallbackEnabled}
                        onChange={(e) => handleUpdateAccount({ ...acc, fallbackEnabled: e.target.checked })}
                      />
                      <span>Fallback Rule (Notify on UNREAD + IMPORTANT + INBOX if unlabelled)</span>
                    </label>

                    <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer", fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={acc.otpPopupOnly}
                        onChange={(e) => handleUpdateAccount({ ...acc, otpPopupOnly: e.target.checked })}
                      />
                      <span>OTP / Verification Codes (Always popup immediately, never queue)</span>
                    </label>
                  </div>

                  {/* Category Modes */}
                  <div style={{ paddingTop: 10, borderTop: "1px solid rgba(255, 255, 255, 0.08)" }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: "rgba(255, 255, 255, 0.7)", marginBottom: 8 }}>
                      Category Notification Modes
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))", gap: 8 }}>
                      {["University", "Work", "Jobs", "Money", "Security", "Personal"].map((cat) => {
                        const currentMode = acc.categoryModes[cat] ?? "popup";
                        return (
                          <div
                            key={cat}
                            style={{
                              display: "flex",
                              justifyContent: "space-between",
                              alignItems: "center",
                              padding: "6px 10px",
                              backgroundColor: "rgba(255, 255, 255, 0.03)",
                              borderRadius: 4,
                            }}
                          >
                            <span style={{ fontSize: 12, fontWeight: 500 }}>{cat}</span>
                            <select
                              value={currentMode}
                              onChange={(e) => {
                                const updatedModes = {
                                  ...acc.categoryModes,
                                  [cat]: e.target.value as "popup" | "queue_only" | "off",
                                };
                                handleUpdateAccount({ ...acc, categoryModes: updatedModes });
                              }}
                              style={{
                                padding: "2px 6px",
                                backgroundColor: "rgba(255, 255, 255, 0.08)",
                                border: "1px solid rgba(255, 255, 255, 0.16)",
                                borderRadius: 4,
                                color: "#fff",
                                fontSize: 11,
                                outline: "none",
                              }}
                            >
                              <option value="popup" style={{ backgroundColor: "#1e1e20" }}>Popup</option>
                              <option value="queue_only" style={{ backgroundColor: "#1e1e20" }}>Queue Only</option>
                              <option value="off" style={{ backgroundColor: "#1e1e20" }}>Off</option>
                            </select>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {activeTab === "display" && (
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
              <div>
                <h2 style={{ fontSize: 18, fontWeight: 600 }}>Display & Timers</h2>
                <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.5)", marginTop: 2 }}>
                  Popups hold for the configured duration regardless of window focus changes.
                </p>
              </div>
              {displaySaved && (
                <span style={{ fontSize: 12, color: "#4ade80", fontWeight: 600 }}>Saved</span>
              )}
            </div>

            <div
              style={{
                backgroundColor: "rgba(255, 255, 255, 0.04)",
                border: "1px solid rgba(255, 255, 255, 0.1)",
                borderRadius: 8,
                padding: 16,
                maxWidth: 520,
                display: "flex",
                flexDirection: "column",
                gap: 14,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>Popup Duration</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "#60a5fa" }}>
                  {(displayMs / 1000).toFixed(1)}s ({displayMs} ms)
                </span>
              </div>

              <div style={{ display: "flex", gap: 8 }}>
                {[2000, 4000, 8000].map((preset) => (
                  <button
                    key={preset}
                    onClick={() => handleUpdateDisplayMs(preset)}
                    style={{
                      padding: "6px 14px",
                      borderRadius: 6,
                      border: displayMs === preset ? "1px solid #3b82f6" : "1px solid rgba(255, 255, 255, 0.14)",
                      backgroundColor: displayMs === preset ? "rgba(59, 130, 246, 0.25)" : "rgba(255, 255, 255, 0.06)",
                      color: "#ffffff",
                      fontSize: 12,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    {preset / 1000}s
                  </button>
                ))}
              </div>

              <input
                type="range"
                min={1000}
                max={15000}
                step={500}
                value={displayMs}
                onChange={(e) => handleUpdateDisplayMs(Number(e.target.value))}
                style={{ width: "100%", cursor: "pointer" }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
