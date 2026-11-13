import { claudeConfig } from "./claude.config";
import { chatgptConfig } from "./chatgpt.config";
import { geminiConfig } from "./gemini.config";
import { SiteConfig } from "./types";

export * from "./types";
export { claudeConfig, chatgptConfig, geminiConfig };

export const SITE_CONFIGS: SiteConfig[] = [
  claudeConfig,
  chatgptConfig,
  geminiConfig,
];

export function getSiteConfigForHostname(hostname: string): SiteConfig | null {
  const host = hostname.toLowerCase();
  for (const config of SITE_CONFIGS) {
    if (config.hostnames.some((h) => host === h || host.endsWith("." + h))) {
      return config;
    }
  }
  return null;
}
