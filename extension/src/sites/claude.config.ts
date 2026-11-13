import { SiteConfig } from "./types";

/**
 * Site configuration for Claude (claude.ai)
 * Heuristics status: UNVERIFIED (awaits live probe / verification in Phase 5 human checkpoint)
 */
export const claudeConfig: SiteConfig = {
  source: "claude",
  displayName: "Claude",
  hostnames: ["claude.ai"],
  status: "UNVERIFIED",
  selectors: {
    generating: [
      'button[aria-label*="Stop" i]',
      'button[aria-label*="Cancel" i]',
      '[data-testid="stop-button"]',
      'button.stop-button',
      '[aria-label="Stop Response"]',
    ],
    needsInput: [
      '[data-testid="tool-approval"]',
      '[data-testid="permission-dialog"]',
      'button[aria-label*="Allow" i]',
      'button[aria-label*="Approve" i]',
      '[role="alertdialog"] button:not([aria-label*="Close" i])',
    ],
    chatTitle: undefined, // Falls back to document.title
  },
  settlingDebounceMs: 1500,
  minGenerationDurationMs: 800,
  notes: "Stop button appears during generation in chat interface. UNVERIFIED until tested on live claude.ai.",
};
