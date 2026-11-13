// Event contract types matching crates/island-contract

export type Source = "claude" | "chatgpt" | "gemini";
export type Surface = "web";
export type Kind = "done" | "needs_input";

export interface BrowserTabTarget {
  type: "browserTab";
  tabId: number;
  windowId: number;
  url?: string;
}

export interface ContractEvent {
  id: string; // UUID v4
  source: Source;
  surface: Surface;
  kind: Kind;
  title: string;
  text: string;
  category?: string;
  account?: string;
  target: BrowserTabTarget;
  createdAt: string; // ISO 8601
  dedupeKey: string;
}

export interface WebFocusReport {
  type: "focus";
  windowFocused: boolean;
  windowId?: number;
  tabId?: number;
  site?: string;
}

export type WsClientMessage =
  | {
      type: "hello";
      token: string;
      client: string;
      clientVersion: string;
      browser?: string;
    }
  | {
      type: "event";
      event: ContractEvent;
    }
  | WebFocusReport
  | {
      type: "commandResult";
      requestId: string;
      ok: boolean;
      error?: string;
    }
  | {
      type: "ping";
      t: number;
    };

export type WsServerMessage =
  | {
      type: "welcome";
      serverVersion: string;
      appName: string;
    }
  | {
      type: "ack";
      id: string;
      status: "accepted" | "duplicate" | "skipped" | "rejected";
      reason?: string;
    }
  | {
      type: "command";
      requestId: string;
      command: "focusTab";
      tabId: number;
      windowId: number;
    }
  | {
      type: "pong";
      t: number;
    }
  | {
      type: "error";
      code: number;
      reason: string;
    };

export interface ExtensionSettings {
  port: number;
  token: string;
  showChatTitles: boolean;
  probeMode: boolean;
  sites: {
    claude: boolean;
    chatgpt: boolean;
    gemini: boolean;
  };
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  port: 47821,
  token: "",
  showChatTitles: true,
  probeMode: false,
  sites: {
    claude: true,
    chatgpt: true,
    gemini: true,
  },
};
