import { gmailConfig, GmailSelectorConfig } from "../sites/gmail.config";

export interface GmailDetectionEvent {
  kind: "finished" | "needs_input";
  title: string;
  text: string;
  category?: string;
  dedupeKeySuffix: string;
}

export interface GmailMonitorOptions {
  config?: GmailSelectorConfig;
  querySelectorAll?: (selector: string) => Iterable<Element>;
  getDocumentTitle?: () => string;
  onEvent: (event: GmailDetectionEvent) => void;
}

export function parseTitleUnreadCount(title: string): number | null {
  if (!title) return null;
  const match = title.match(/\((\d[\d,]*)\)/);
  if (!match || !match[1]) return null;
  const parsed = parseInt(match[1].replace(/,/g, ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export class GmailMonitor {
  private config: GmailSelectorConfig;
  private querySelectorAll: (selector: string) => Iterable<Element>;
  private getDocumentTitle: () => string;
  private onEvent: (event: GmailDetectionEvent) => void;

  private initialized = false;
  private seenRowKeys = new Set<string>();
  private lastTitleUnreadCount: number | null = null;
  private eventSeq = 0;

  constructor(options: GmailMonitorOptions) {
    this.config = options.config ?? gmailConfig;
    this.querySelectorAll =
      options.querySelectorAll ??
      ((sel: string) =>
        typeof document !== "undefined" ? document.querySelectorAll(sel) : []);
    this.getDocumentTitle =
      options.getDocumentTitle ??
      (() => (typeof document !== "undefined" ? document.title || "" : ""));
    this.onEvent = options.onEvent;
  }

  public evaluate(): void {
    const unreadRows = this.collectUnreadRows();
    const rowEntries = unreadRows.map((row, idx) => ({
      key: this.extractRowKey(row, idx),
      isPriority: this.isPriorityRow(row),
    }));

    const titleCount = parseTitleUnreadCount(this.getDocumentTitle());

    if (!this.initialized) {
      for (const entry of rowEntries) {
        this.seenRowKeys.add(entry.key);
      }
      this.lastTitleUnreadCount = titleCount;
      this.initialized = true;
      return;
    }

    let emittedFromRows = false;
    for (const entry of rowEntries) {
      if (this.seenRowKeys.has(entry.key)) {
        continue;
      }
      this.seenRowKeys.add(entry.key);
      emittedFromRows = true;
      this.eventSeq += 1;

      if (entry.isPriority) {
        this.onEvent({
          kind: "needs_input",
          title: "Gmail · Priority mail",
          text: "New priority thread in inbox",
          category: "Priority",
          dedupeKeySuffix: `priority-${this.eventSeq}:needs_input`,
        });
      } else {
        this.onEvent({
          kind: "finished",
          title: "Gmail · New mail",
          text: "New unread email arrived",
          dedupeKeySuffix: `unread-${this.eventSeq}:done`,
        });
      }
    }

    // Fallback when Gmail updates unread badge count in title before/without row DOM match
    if (
      !emittedFromRows &&
      titleCount !== null &&
      this.lastTitleUnreadCount !== null &&
      titleCount > this.lastTitleUnreadCount
    ) {
      const delta = titleCount - this.lastTitleUnreadCount;
      this.eventSeq += 1;
      this.onEvent({
        kind: "finished",
        title: "Gmail · New mail",
        text: delta === 1 ? "1 new unread email" : `${delta} new unread emails`,
        dedupeKeySuffix: `count-${titleCount}-${this.eventSeq}:done`,
      });
    }

    if (titleCount !== null) {
      this.lastTitleUnreadCount = titleCount;
    }

    // Cap seen keys to prevent unbounded growth in long-lived tabs
    if (this.seenRowKeys.size > 1000) {
      const recent = Array.from(this.seenRowKeys).slice(-400);
      this.seenRowKeys = new Set(recent);
    }
  }

  private collectUnreadRows(): Element[] {
    for (const selector of this.config.unreadRowSelectors) {
      try {
        const list = Array.from(this.querySelectorAll(selector));
        if (list.length > 0) {
          return list;
        }
      } catch {
        continue;
      }
    }
    return [];
  }

  private extractRowKey(row: Element, fallbackIdx: number): string {
    const legacyId = row.getAttribute("data-legacy-thread-id");
    if (legacyId) return `thread:${legacyId}`;
    const threadId = row.getAttribute("data-thread-id");
    if (threadId) return `thread:${threadId}`;
    const idAttr = row.getAttribute("id");
    if (idAttr) return `id:${idAttr}`;
    const aria = row.getAttribute("aria-label");
    if (aria) return `aria:${aria.slice(0, 64)}`;
    return `row:${fallbackIdx}`;
  }

  private isPriorityRow(row: Element): boolean {
    if (typeof row.querySelector === "function") {
      for (const sel of this.config.priorityMarkerSelectors) {
        try {
          if (row.querySelector(sel) !== null) {
            return true;
          }
        } catch {
          continue;
        }
      }
    }

    const rowAria = (row.getAttribute("aria-label") || "").toLowerCase();
    const rowDataTooltip = (row.getAttribute("data-tooltip") || "").toLowerCase();
    const combined = `${rowAria} ${rowDataTooltip}`;
    return this.config.priorityLabelKeywords.some((kw) => combined.includes(kw));
  }

  public dispose(): void {
    this.initialized = false;
    this.seenRowKeys.clear();
    this.lastTitleUnreadCount = null;
  }
}
