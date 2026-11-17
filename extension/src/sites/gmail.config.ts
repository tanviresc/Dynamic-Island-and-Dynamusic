/**
 * Site configuration and DOM selectors for Gmail (mail.google.com).
 * Status: UNVERIFIED (awaits live DOM probe / testing on mail.google.com).
 * Privacy: Never extracts or logs email message bodies or full sender addresses.
 */
export interface GmailSelectorConfig {
  status: "VERIFIED" | "UNVERIFIED";
  hostnames: string[];
  unreadRowSelectors: string[];
  priorityMarkerSelectors: string[];
  priorityLabelKeywords: string[];
}

export const gmailConfig: GmailSelectorConfig = {
  status: "UNVERIFIED",
  hostnames: ["mail.google.com"],
  unreadRowSelectors: [
    'div[role="main"] tr.zA.zE',
    'table[role="grid"] tr.zA.zE',
    "tr.zA.zE",
  ],
  priorityMarkerSelectors: [
    '[aria-label*="Important" i]',
    '[data-tooltip*="Important" i]',
    '[aria-label*="Starred" i]',
    '[data-tooltip*="Starred" i]',
    ".pH",
    ".pG",
  ],
  priorityLabelKeywords: [
    "important",
    "priority",
    "starred",
    "urgent",
    "action required",
    "security",
    "verification",
  ],
};
