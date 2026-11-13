import { Source } from "../types";

export type VerificationStatus = "VERIFIED" | "UNVERIFIED";

export interface SiteConfig {
  source: Source;
  displayName: string;
  hostnames: string[];
  status: VerificationStatus;
  selectors: {
    /** Selectors for elements present ONLY while generation is in progress (e.g. stop button) */
    generating: string[];
    /** Selectors for elements indicating user approval or clarification is needed */
    needsInput: string[];
    /** Optional selector for extracting chat title element; falls back to document.title */
    chatTitle?: string;
  };
  settlingDebounceMs: number;
  minGenerationDurationMs: number;
  notes: string;
}
