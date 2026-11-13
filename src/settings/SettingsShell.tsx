import React, { useState } from "react";
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

export const SettingsShell: React.FC = () => {
  const [activeTab, setActiveTab] = useState<SettingsTab>("developer");
  const [reduceMotion, setReduceMotion] = useState<boolean>(false);
  const [showHitRect, setShowHitRect] = useState<boolean>(false);
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [isDnd, setIsDnd] = useState<boolean>(false);

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

        {activeTab !== "general" && activeTab !== "developer" && (
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 16 }}>
              {activeTab.charAt(0).toUpperCase() + activeTab.slice(1)}
            </h2>
            <p style={{ color: "rgba(255, 255, 255, 0.6)", fontSize: 13 }}>
              Configured in Phase 2 persistence integration.
            </p>
          </div>
        )}
      </div>
    </div>
  );
};
