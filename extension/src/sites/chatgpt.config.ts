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
      'button[data-testid*="stop" i]',
      'button[aria-label*="Stop generating" i]',
      'button[aria-label*="Stop streaming" i]',
      'button[aria-label="Stop"]',
      'button[aria-label*="Stop" i]',
      '[data-testid="fruitjuice-stop-button"]',
      'form button[aria-label*="Stop" i]',
      'fieldset button[aria-label*="Stop" i]',
      '.result-streaming',
      '[data-is-streaming="true"]',
      '.result-thinking',
      '[data-message-author-role="assistant"][data-is-streaming="true"]',
    ],
    needsInput: [
      '[data-testid="confirmation-modal"]',
      '[data-testid="approval-dialog"]',
      'button[data-testid*="confirm" i]',
      'button[data-testid*="allow" i]',
      '[role="dialog"] button[data-testid*="allow" i]',
      '[role="alertdialog"] button[data-testid*="confirm" i]',
    ],
    needsInputTextMatchers: [
      "allow",
      "allow once",
      "allow always",
      "approve",
      "confirm",
      "continue generating",
    ],
    chatTitle: undefined, // Falls back to document.title
  },
  settlingDebounceMs: 400,
  minGenerationDurationMs: 300,
  notes: "Stop generation button toggles in the prompt composer footer. UNVERIFIED until tested on live chatgpt.com.",
};
