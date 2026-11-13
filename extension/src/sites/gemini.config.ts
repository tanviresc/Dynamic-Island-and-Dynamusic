import { SiteConfig } from "./types";

/**
 * Site configuration for Gemini (gemini.google.com)
 * Heuristics status: UNVERIFIED (awaits live probe / verification in Phase 5 human checkpoint)
 */
export const geminiConfig: SiteConfig = {
  source: "gemini",
  displayName: "Gemini",
  hostnames: ["gemini.google.com"],
  status: "UNVERIFIED",
  selectors: {
    generating: [
      'button[aria-label*="Stop response" i]',
      'button[aria-label*="Stop" i][data-test-id*="stop"]',
      '[data-test-id="stop-button"]',
      'mat-progress-bar',
      '.sparkle-generating',
    ],
    needsInput: [
      '[data-test-id="confirmation-dialog"]',
      '[role="alertdialog"] button[aria-label*="Allow" i]',
      '[role="dialog"] button[aria-label*="Confirm" i]',
    ],
    chatTitle: undefined, // Falls back to document.title
  },
  settlingDebounceMs: 400,
  minGenerationDurationMs: 800,
  notes: "Stop button or busy indicator during streaming. UNVERIFIED until tested on live gemini.google.com.",
};
