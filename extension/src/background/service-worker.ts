import { WsClient } from "./ws-client";
import {
  ContractEvent,
  DEFAULT_SETTINGS,
  ExtensionSettings,
  Source,
} from "../types";

let wsClient: WsClient | null = null;
let currentSettings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let pendingEvents: ContractEvent[] = [];

function generateUuid(): string {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// 1. Initialize settings & WebSocket connection
chrome.storage.local.get(DEFAULT_SETTINGS, (items) => {
  currentSettings = { ...DEFAULT_SETTINGS, ...items } as ExtensionSettings;
  initWsClient();
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName === "local") {
    let configChanged = false;
    if (changes.port) {
      currentSettings.port = changes.port.newValue;
      configChanged = true;
    }
    if (changes.token) {
      currentSettings.token = changes.token.newValue;
      configChanged = true;
    }
    if (configChanged && wsClient) {
      wsClient.updateConfig(currentSettings.port, currentSettings.token);
    }
  }
});

function initWsClient() {
  if (wsClient) {
    wsClient.disconnect();
  }

  wsClient = new WsClient(currentSettings.port, currentSettings.token, {
    onStatusChange: (status) => {
      chrome.storage.local.set({ connectionStatus: status });
      console.log(`[Island Background] Status: ${status}`);
      if (status === "connected") {
        sendCurrentFocusReport();
      }
    },
    onCommand: (cmd) => {
      handleServerCommand(cmd);
    },
    onAck: (ack) => {
      console.log(`[Island Background] Ack for ${ack.id}: ${ack.status}`);
    },
  });

  wsClient.connect();

  if (pendingEvents.length > 0) {
    const toSend = [...pendingEvents];
    pendingEvents = [];
    for (const ev of toSend) {
      wsClient.sendEvent(ev);
    }
  }
}

// 2. 30s Alarm Keepalive per §1.10.1 & §5.2
chrome.alarms.create("island-keepalive", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "island-keepalive") {
    if (wsClient && wsClient.getStatus() === "disconnected") {
      console.log("[Island Background] Keepalive reconnect trigger");
      wsClient.connect();
    }
  }
});

// 3. Message receiver from content scripts
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "contentEvent" && message.payload) {
    handleContentEvent(message.payload, sender);
    sendResponse({ ok: true });
    return true;
  }
  if (message?.type === "testConnection") {
    if (wsClient) {
      wsClient.connect();
    }
    sendResponse({ ok: true });
    return true;
  }
  return false;
});

function handleContentEvent(
  payload: {
    source: Source;
    kind: "done" | "needs_input";
    title: string;
    text: string;
    category?: string;
    dedupeKeySuffix: string;
    url?: string;
  },
  sender: chrome.runtime.MessageSender
) {
  const tabId = sender.tab?.id ?? 0;
  const windowId = sender.tab?.windowId ?? 0;
  const eventId = generateUuid();
  const dedupeKey = `${payload.source}:web:tab${tabId}-${payload.dedupeKeySuffix}`;

  const event: ContractEvent = {
    id: eventId,
    source: payload.source,
    surface: "web",
    kind: payload.kind,
    title: payload.title,
    text: payload.text,
    category: payload.category,
    target: {
      type: "browserTab",
      tabId,
      windowId,
      url: payload.url,
    },
    createdAt: new Date().toISOString(),
    dedupeKey,
  };

  console.log(`[Island Background] Emitting event ${eventId} (${payload.source} ${payload.kind})`);
  if (wsClient) {
    wsClient.sendEvent(event);
  } else {
    pendingEvents.push(event);
  }
}

// 4. Focus Tracking and Reporting (§1.10.1 & §5.4)
async function sendCurrentFocusReport() {
  try {
    const windows = await chrome.windows.getAll({ populate: true });
    const focusedWin = windows.find((w) => w.focused);
    if (!focusedWin) {
      wsClient?.sendFocusReport({
        type: "focus",
        windowFocused: false,
      });
      return;
    }

    const activeTab = focusedWin.tabs?.find((t) => t.active);
    const site = activeTab?.url
      ? new URL(activeTab.url).hostname
      : undefined;

    wsClient?.sendFocusReport({
      type: "focus",
      windowFocused: true,
      windowId: focusedWin.id,
      tabId: activeTab?.id,
      site,
    });
  } catch (e) {
    // Ignore error
  }
}

chrome.tabs.onActivated.addListener(() => {
  sendCurrentFocusReport();
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    wsClient?.sendFocusReport({
      type: "focus",
      windowFocused: false,
    });
  } else {
    sendCurrentFocusReport();
  }
});

chrome.tabs.onUpdated.addListener((_tabId, changeInfo) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    sendCurrentFocusReport();
  }
});

chrome.tabs.onRemoved.addListener(() => {
  sendCurrentFocusReport();
});

// 5. Focus Command Execution (§1.10.1 & §5.4)
async function handleServerCommand(cmd: {
  requestId: string;
  command: "focusTab";
  tabId: number;
  windowId: number;
}) {
  if (cmd.command === "focusTab") {
    try {
      if (cmd.windowId) {
        await chrome.windows.update(cmd.windowId, { focused: true });
      }
      if (cmd.tabId) {
        await chrome.tabs.update(cmd.tabId, { active: true });
      }
      wsClient?.sendCommandResult(cmd.requestId, true);
    } catch (err: any) {
      console.warn("[Island Background] focusTab command failed:", err);
      wsClient?.sendCommandResult(cmd.requestId, false, err?.message || "Tab not found");
    }
  }
}
