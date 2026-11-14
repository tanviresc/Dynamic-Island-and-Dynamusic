import React from "react";
import { useDynamusic } from "./useDynamusicStore";
import { EQ_FREQUENCIES, EQ_PRESETS } from "./audioEngine";

export const EqualizerModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({
  isOpen,
  onClose,
}) => {
  const { eqPreset, eqGains, setEqGains, setEqPreset } = useDynamusic();

  if (!isOpen) return null;

  const handleSliderChange = (index: number, value: number) => {
    const updated = [...eqGains];
    updated[index] = value;
    setEqGains(updated);
  };

  const formatFreq = (freq: number) => {
    return freq >= 1000 ? `${freq / 1000}k` : `${freq}`;
  };

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "rgba(0,0,0,0.75)",
        backdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: 580,
          backgroundColor: "#111113",
          border: "1px solid rgba(255,255,255,0.14)",
          borderRadius: 20,
          padding: 24,
          boxShadow: "0 16px 40px rgba(0,0,0,0.8), 0 0 24px rgba(0, 194, 255, 0.2)",
          color: "#fff",
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
          <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, letterSpacing: -0.3 }}>10-Band Graphic Equalizer</h2>
          <button
            onClick={onClose}
            style={{
              background: "transparent",
              border: "none",
              color: "rgba(255,255,255,0.6)",
              fontSize: 20,
              cursor: "pointer",
            }}
          >
            ✕
          </button>
        </div>

        {/* Preset Selector */}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 24 }}>
          {EQ_PRESETS.map((p) => {
            const isSelected = eqPreset === p.name;
            return (
              <button
                key={p.name}
                onClick={() => setEqPreset(p.name)}
                style={{
                  padding: "6px 14px",
                  borderRadius: 20,
                  fontSize: 12,
                  fontWeight: 600,
                  border: isSelected ? "1px solid #00c2ff" : "1px solid rgba(255,255,255,0.12)",
                  background: isSelected ? "rgba(0, 194, 255, 0.2)" : "rgba(255,255,255,0.05)",
                  color: isSelected ? "#00c2ff" : "#ccc",
                  cursor: "pointer",
                  transition: "all 0.2s",
                }}
              >
                {p.name}
              </button>
            );
          })}
        </div>

        {/* Sliders Area */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "flex-end",
            height: 200,
            padding: "10px 0 20px 0",
          }}
        >
          {EQ_FREQUENCIES.map((freq, idx) => {
            const gain = eqGains[idx] || 0;
            return (
              <div
                key={freq}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  gap: 8,
                  height: "100%",
                  justifyContent: "flex-end",
                }}
              >
                <span style={{ fontSize: 10, color: gain > 0 ? "#00c2ff" : gain < 0 ? "#ff5252" : "#888" }}>
                  {gain > 0 ? `+${gain}` : `${gain}`}
                </span>
                <input
                  type="range"
                  min="-12"
                  max="12"
                  step="0.5"
                  value={gain}
                  onChange={(e) => handleSliderChange(idx, parseFloat(e.target.value))}
                  style={{
                    writingMode: "vertical-lr",
                    direction: "rtl",
                    height: 120,
                    width: 24,
                    cursor: "pointer",
                    accentColor: "#00c2ff",
                  }}
                />
                <span style={{ fontSize: 11, fontWeight: 600, color: "#aaa" }}>{formatFreq(freq)}</span>
              </div>
            );
          })}
        </div>

        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 12 }}>
          <button
            onClick={() => setEqPreset("Flat")}
            style={{
              padding: "6px 16px",
              background: "rgba(255,255,255,0.1)",
              border: "1px solid rgba(255,255,255,0.15)",
              color: "#fff",
              borderRadius: 8,
              fontSize: 12,
              cursor: "pointer",
            }}
          >
            Reset to Flat
          </button>
        </div>
      </div>
    </div>
  );
};
