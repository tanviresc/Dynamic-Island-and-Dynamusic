import { SiteConfig } from "./types";

/**
 * Site configuration for ChatGPT (chatgpt.com)
 * Heuristics status: UNVERIFIED (awaits live probe / verification in Phase 5 human checkpoint)
 */
export const chatgptConfig: SiteConfig = {
  source: "chatgpt",
  displayName: "ChatGPT",
  hostnames: ["chatgpt.com", "chat.openai.com"],
  status: "UNVERIFIED",
  selectors: {
    generating: [
      'button[data-testid="stop-button"]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label*="Stop" i][data-testid*="stop"]',
      '[data-testid="fruitjuice-stop-button"]',
    ],
    needsInput: [
      '[data-testid="confirmation-modal"]',
      '[data-testid="approval-dialog"]',
      'button[data-testid*="confirm" i]',
      '[role="dialog"] button[data-testid*="allow" i]',
    ],
    chatTitle: undefined, // Falls back to document.title
  },
  settlingDebounceMs: 400,
  minGenerationDurationMs: 800,
  notes: "Stop generation button toggles in the prompt composer footer. UNVERIFIED until tested on live chatgpt.com.",
};
