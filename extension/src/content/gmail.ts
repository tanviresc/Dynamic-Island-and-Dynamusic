import { GmailMonitor } from "../detector/gmail-monitor";
import { gmailConfig } from "../sites/gmail.config";
import { DEFAULT_SETTINGS, ExtensionSettings } from "../types";

(function initGmailContentScript() {
  const hostname = window.location.hostname.toLowerCase();
  if (!gmailConfig.hostnames.some((h) => hostname === h || hostname.endsWith("." + h))) {
    return;
  }

  let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  let monitor: GmailMonitor | null = null;
  let mutationObserver: MutationObserver | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;

  function isGmailEnabled(): boolean {
    return currentSettings.sites.gmail ?? true;
  }

  function startMonitor() {
    if (!isGmailEnabled() || monitor) {
      return;
    }

    monitor = new GmailMonitor({
      config: gmailConfig,
      onEvent: (ev) => {
        if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
          return;
        }
        chrome.runtime.sendMessage({
          type: "contentEvent",
          payload: {
            source: "gmail",
            kind: ev.kind,
            title: ev.title,
            text: ev.text,
            category: ev.category,
            dedupeKeySuffix: ev.dedupeKeySuffix,
            url: window.location.href,
          },
        });
      },
    });

    mutationObserver = new MutationObserver(() => {
      monitor?.evaluate();
    });

    const targetNode = document.body || document.documentElement;
    mutationObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "aria-label", "data-tooltip", "title"],
    });

    pollInterval = setInterval(() => {
      monitor?.evaluate();
    }, 1000);

    // Baseline evaluation
    monitor.evaluate();
  }

  function teardown() {
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (monitor) {
      monitor.dispose();
      monitor = null;
    }
  }

  if (typeof chrome === "undefined" || !chrome.storage?.local) {
    startMonitor();
    return;
  }

  chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
    currentSettings = {
      ...DEFAULT_SETTINGS,
      ...items,
      sites: { ...DEFAULT_SETTINGS.sites, ...(items as ExtensionSettings).sites },
    };
    startMonitor();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
      for (const [key, change] of Object.entries(changes)) {
        (currentSettings as unknown as Record<string, unknown>)[key] = change.newValue;
      }
      if (!isGmailEnabled()) {
        teardown();
      } else if (!monitor) {
        startMonitor();
      }
    }
  });

  window.addEventListener("unload", teardown);
})();
