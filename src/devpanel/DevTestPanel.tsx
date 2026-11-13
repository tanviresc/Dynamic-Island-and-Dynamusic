import React from "react";

export interface DevTestPanelProps {
  isReducedMotion: boolean;
  onToggleReducedMotion: () => void;
  showHitRect: boolean;
  onToggleHitRect: () => void;
}

export const DevTestPanel: React.FC<DevTestPanelProps> = ({
  isReducedMotion,
  onToggleReducedMotion,
  showHitRect,
  onToggleHitRect,
}) => {
  const inject = (data: {
    source: string;
    kind: string;
    title: string;
    text: string;
    category?: string;
  }) => {
    window.dispatchEvent(
      new CustomEvent("island:inject", {
        detail: data,
      })
    );
  };

  const setMode = (mode: string) => {
    window.dispatchEvent(
      new CustomEvent("island:set-mode", {
        detail: { mode },
      })
    );
  };

  return (
    <div
      style={{
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "16px",
        backgroundColor: "#161618",
        borderRadius: "8px",
        border: "1px solid rgba(255, 255, 255, 0.08)",
        color: "#ffffff",
      }}
    >
      <div>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 8, color: "#ffffff" }}>
          Developer Event Injector
        </h3>
        <p style={{ fontSize: 12, color: "rgba(255, 255, 255, 0.6)", marginBottom: 12 }}>
          Inject sample events across sources and kinds to verify animations and layout.
        </p>
      </div>

      {/* Quick Injects */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
        <button
          onClick={() =>
            inject({
              source: "claude",
              kind: "done",
              title: "Claude finished",
              text: "Refactor plan for auth module is ready",
            })
          }
          className="dev-btn"
        >
          Claude (Done)
        </button>

        <button
          onClick={() =>
            inject({
              source: "chatgpt",
              kind: "done",
              title: "ChatGPT",
              text: "Search completed: 14 citations found",
            })
          }
          className="dev-btn"
        >
          ChatGPT (Done)
        </button>

        <button
          onClick={() =>
            inject({
              source: "gemini",
              kind: "done",
              title: "Gemini",
              text: "Code explanation generated",
            })
          }
          className="dev-btn"
        >
          Gemini (Done)
        </button>

        <button
          onClick={() =>
            inject({
              source: "antigravity",
              kind: "needs_input",
              title: "Antigravity IDE Agent",
              text: "Approval requested: cargo clippy --fix",
              category: "Needs input",
            })
          }
          className="dev-btn"
          style={{ borderColor: "#0A84FF", color: "#60A5FA" }}
        >
          Antigravity (Needs Input)
        </button>

        <button
          onClick={() =>
            inject({
              source: "antigravity",
              kind: "error",
              title: "Antigravity Task Failed",
              text: "Command exited with code 1: build failed",
              category: "Failed",
            })
          }
          className="dev-btn"
          style={{ borderColor: "#FF453A", color: "#F87171" }}
        >
          Antigravity (Failed)
        </button>

        <button
          onClick={() =>
            inject({
              source: "gmail",
              kind: "new_mail",
              title: "Dean of Engineering",
              text: "Fall 2026 Academic Calendar Update",
              category: "University",
            })
          }
          className="dev-btn"
          style={{ borderColor: "#EA4335", color: "#FCA5A5" }}
        >
          Gmail (University)
        </button>

        <button
          onClick={() =>
            inject({
              source: "gmail",
              kind: "new_mail",
              title: "security-noreply@google.com",
              text: "Critical security alert for your account",
              category: "Security",
            })
          }
          className="dev-btn"
          style={{ borderColor: "#EA4335", color: "#FCA5A5" }}
        >
          Gmail (Security)
        </button>
      </div>

      {/* Long Text Cases */}
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "rgba(255,255,255,0.8)" }}>
          Edge Cases (Wrapping & Ellipsis)
        </h4>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
          <button
            onClick={() =>
              inject({
                source: "claude",
                kind: "done",
                title: "Extremely Long Project Workspace Title Exceeding Single Line Limits",
                text: "Here is a very long notification description that tests two-line clamping and ellipsis behavior according to the 480px maximum pill spec.",
                category: "Long Case",
              })
            }
            className="dev-btn"
          >
            Two-Line Clamped Pill
          </button>

          <button
            onClick={() =>
              inject({
                source: "gemini",
                kind: "done",
                title: "Short",
                text: "OK",
              })
            }
            className="dev-btn"
          >
            Minimal Width Pill (180px)
          </button>

          <button
            onClick={() => {
              for (let i = 1; i <= 3; i++) {
                setTimeout(() => {
                  inject({
                    source: "claude",
                    kind: "done",
                    title: `Claude task #${i}`,
                    text: `Burst task ${i} finished`,
                  });
                }, i * 400);
              }
            }}
            className="dev-btn"
          >
            Burst Simulation (3 items)
          </button>
        </div>
      </div>

      {/* Island Surface State Direct Switcher */}
      <div>
        <h4 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "rgba(255,255,255,0.8)" }}>
          Direct Surface Mode
        </h4>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => setMode("pill")} className="dev-btn">
            Show Pill
          </button>
          <button onClick={() => setMode("dot")} className="dev-btn">
            Show Dot
          </button>
          <button onClick={() => setMode("queue")} className="dev-btn">
            Show Queue Panel
          </button>
          <button onClick={() => setMode("hidden")} className="dev-btn">
            Hide Island
          </button>
        </div>
      </div>

      {/* Toggles */}
      <div style={{ display: "flex", gap: "16px", marginTop: "4px" }}>
        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={isReducedMotion}
            onChange={onToggleReducedMotion}
          />
          Reduce Motion
        </label>

        <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={showHitRect}
            onChange={onToggleHitRect}
          />
          Show Hit Rectangle Bounds
        </label>
      </div>

      <style>{`
        .dev-btn {
          background-color: rgba(255, 255, 255, 0.06);
          border: 1px solid rgba(255, 255, 255, 0.14);
          color: #ffffff;
          padding: 6px 12px;
          border-radius: 6px;
          font-size: 12px;
          font-weight: 500;
          cursor: pointer;
          transition: background-color 0.15s ease, border-color 0.15s ease;
        }
        .dev-btn:hover {
          background-color: rgba(255, 255, 255, 0.12);
          border-color: rgba(255, 255, 255, 0.28);
        }
      `}</style>
    </div>
  );
};
