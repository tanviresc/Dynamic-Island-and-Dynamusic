import { describe, it, expect } from "vitest";
import { GmailMonitor, GmailDetectionEvent, parseTitleUnreadCount } from "./gmail-monitor";

function createMockRow(
  attrs: Record<string, string>,
  hasPriorityMarker = false
): Element {
  return {
    getAttribute: (name: string) => attrs[name] ?? null,
    querySelector: (sel: string) => {
      if (hasPriorityMarker && sel.includes("Important")) {
        return {} as Element;
      }
      return null;
    },
  } as unknown as Element;
}

describe("GmailMonitor", () => {
  it("parses Gmail unread counts from document.title", () => {
    expect(parseTitleUnreadCount("Inbox (4) - user@gmail.com - Gmail")).toBe(4);
    expect(parseTitleUnreadCount("Inbox (1,234) - Gmail")).toBe(1234);
    expect(parseTitleUnreadCount("Inbox - Gmail")).toBeNull();
  });

  it("ignores baseline unread threads on initial load and emits finished for new unread mail", () => {
    const events: GmailDetectionEvent[] = [];
    let rows: Element[] = [
      createMockRow({ "data-legacy-thread-id": "thread-existing-1" }),
    ];
    let title = "Inbox (1) - Gmail";

    const monitor = new GmailMonitor({
      querySelectorAll: () => rows,
      getDocumentTitle: () => title,
      onEvent: (ev) => events.push(ev),
    });

    // Baseline scan -> 0 events
    monitor.evaluate();
    expect(events.length).toBe(0);

    // Same state -> 0 events
    monitor.evaluate();
    expect(events.length).toBe(0);

    // New standard unread thread arrives
    rows = [
      createMockRow({ "data-legacy-thread-id": "thread-new-2" }),
      createMockRow({ "data-legacy-thread-id": "thread-existing-1" }),
    ];
    title = "Inbox (2) - Gmail";
    monitor.evaluate();

    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("finished");
    expect(events[0]?.title).toBe("Gmail · New mail");

    // Subsequent evaluate with same rows does not duplicate
    monitor.evaluate();
    expect(events.length).toBe(1);
  });

  it("emits needs_input for incoming priority threads", () => {
    const events: GmailDetectionEvent[] = [];
    let rows: Element[] = [];

    const monitor = new GmailMonitor({
      querySelectorAll: () => rows,
      getDocumentTitle: () => "Inbox - Gmail",
      onEvent: (ev) => events.push(ev),
    });

    monitor.evaluate();
    expect(events.length).toBe(0);

    rows = [
      createMockRow({ "data-legacy-thread-id": "thread-priority-9" }, true),
    ];
    monitor.evaluate();

    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("needs_input");
    expect(events[0]?.category).toBe("Priority");
  });

  it("falls back to title unread count delta when rows are not matched", () => {
    const events: GmailDetectionEvent[] = [];
    let title = "Inbox (2) - Gmail";

    const monitor = new GmailMonitor({
      querySelectorAll: () => [],
      getDocumentTitle: () => title,
      onEvent: (ev) => events.push(ev),
    });

    monitor.evaluate();
    expect(events.length).toBe(0);

    title = "Inbox (5) - Gmail";
    monitor.evaluate();

    expect(events.length).toBe(1);
    expect(events[0]?.kind).toBe("finished");
    expect(events[0]?.text).toBe("3 new unread emails");
  });
});
