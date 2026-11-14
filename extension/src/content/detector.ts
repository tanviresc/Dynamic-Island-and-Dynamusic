import { getSiteConfigForHostname } from "../sites";
import { DetectorEngine } from "../detector/engine";
import { ProbeEngine } from "../probe/probe";
import { DEFAULT_SETTINGS, ExtensionSettings, Source } from "../types";

(function initContentScript() {
  const hostname = window.location.hostname;
  const config = getSiteConfigForHostname(hostname);
  if (!config) {
    return;
  }

  let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
  let probeEngine: ProbeEngine | null = null;
  let detectorEngine: DetectorEngine | null = null;
  let mutationObserver: MutationObserver | null = null;
  let pollInterval: ReturnType<typeof setInterval> | null = null;
  let pageMessageListener: ((ev: MessageEvent) => void) | null = null;

  function loadSettingsAndStart() {
    if (typeof chrome === "undefined" || !chrome.storage?.local) {
      startDetector();
      return;
    }

    chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
      currentSettings = { ...DEFAULT_SETTINGS, ...items } as ExtensionSettings;
      startDetector();
    });

    chrome.storage.onChanged.addListener((changes, areaName) => {
      if (areaName === "local") {
        for (const [key, change] of Object.entries(changes)) {
          (currentSettings as any)[key] = change.newValue;
        }
        updateSettings();
      }
    });
  }

  function isSiteEnabled(source: Source): boolean {
    return currentSettings.sites[source] ?? true;
  }

  function getChatTitle(): string {
    if (!currentSettings.showChatTitles) {
      return `${config?.displayName || "AI"} chat`;
    }
    const title = document.title?.trim() || "";
    // Clean up generic suffixes like " - Claude" or " | ChatGPT"
    const cleaned = title
      .replace(/\s*[-–|]\s*(Claude|ChatGPT|Gemini).*$/i, "")
      .trim();
    return cleaned.length > 0 ? cleaned : `${config?.displayName} chat`;
  }

  function startDetector() {
    if (!config) return;
    if (!isSiteEnabled(config.source)) {
      console.log(`[Island] ${config.displayName} monitoring is disabled in settings.`);
      return;
    }

    // 1. Probe Mode
    if (currentSettings.probeMode) {
      probeEngine = new ProbeEngine();
      probeEngine.start();
    }

    // 2. Detector Engine
    detectorEngine = new DetectorEngine({
      config,
      callbacks: {
        onDone: (detail) => {
          const title = `${config.displayName} finished`;
          const text = getChatTitle();
          const dedupeKeySuffix = `gen${detail.genCount}:done`;

          dispatchContentEvent({
            source: config.source,
            kind: "done",
            title,
            text,
            dedupeKeySuffix,
          });
        },
        onNeedsInput: (detail) => {
          const title = `${config.displayName} needs input`;
          const text = detail.promptText || getChatTitle();
          const dedupeKeySuffix = `${detail.promptId}:needs_input`;

          dispatchContentEvent({
            source: config.source,
            kind: "needs_input",
            title,
            text,
            category: "Needs input",
            dedupeKeySuffix,
          });
        },
      },
    });

    // 3. Observe DOM mutations
    mutationObserver = new MutationObserver(() => {
      detectorEngine?.evaluate();
    });

    const targetNode = document.body || document.documentElement;
    mutationObserver.observe(targetNode, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "aria-label",
        "data-testid",
        "data-test-id",
        "data-is-streaming",
        "data-state",
        "disabled",
        "aria-disabled",
        "hidden",
        "class",
      ],
    });

    // Listen to MAIN-world fetch/EventSource stream lifecycle events
    pageMessageListener = (ev: MessageEvent) => {
      if (ev.source !== window || ev.origin !== window.location.origin) return;
      const data = ev.data as { __island?: string; event?: string } | null;
      if (!data || data.__island !== "island-page-hook") return;
      if (data.event === "stream_active") {
        detectorEngine?.setNetworkGenerating(true);
      } else if (data.event === "stream_idle") {
        detectorEngine?.setNetworkGenerating(false);
      }
    };
    window.addEventListener("message", pageMessageListener);

    // 4. Fallback polling tick (500 ms)
    pollInterval = setInterval(() => {
      detectorEngine?.evaluate();
    }, 500);

    // Initial evaluation
    detectorEngine.evaluate();
    console.log(`[Island] Monitoring active for ${config.displayName} (${hostname})`);
  }

  function updateSettings() {
    if (!config) return;
    // Probe mode toggle
    if (currentSettings.probeMode && !probeEngine) {
      probeEngine = new ProbeEngine();
      probeEngine.start();
    } else if (!currentSettings.probeMode && probeEngine) {
      probeEngine.stop();
      probeEngine = null;
    }

    // Site toggle
    if (!isSiteEnabled(config.source)) {
      teardown();
    } else if (!detectorEngine) {
      startDetector();
    }
  }

  function dispatchContentEvent(payload: {
    source: Source;
    kind: "done" | "needs_input";
    title: string;
    text: string;
    category?: string;
    dedupeKeySuffix: string;
  }) {
    if (typeof chrome === "undefined" || !chrome.runtime?.sendMessage) {
      return;
    }

    chrome.runtime.sendMessage({
      type: "contentEvent",
      payload: {
        ...payload,
        url: window.location.href,
      },
    });
  }

  function teardown() {
    if (pageMessageListener) {
      window.removeEventListener("message", pageMessageListener);
      pageMessageListener = null;
    }
    if (mutationObserver) {
      mutationObserver.disconnect();
      mutationObserver = null;
    }
    if (pollInterval) {
      clearInterval(pollInterval);
      pollInterval = null;
    }
    if (detectorEngine) {
      detectorEngine.dispose();
      detectorEngine = null;
    }
    if (probeEngine) {
      probeEngine.stop();
      probeEngine = null;
    }
  }

  window.addEventListener("unload", teardown);
  loadSettingsAndStart();
})();
