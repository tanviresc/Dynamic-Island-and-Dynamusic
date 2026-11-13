import { describe, it, expect } from "vitest";
import {
  calculateBackoffMs,
  pruneOfflineBuffer,
  BufferedEvent,
  MAX_OFFLINE_BUFFER_SIZE,
  MAX_BUFFER_AGE_MS,
} from "./ws-client";
import { ContractEvent } from "../types";

describe("ws-client utilities", () => {
  describe("calculateBackoffMs", () => {
    it("increases backoff exponentially up to 30000ms", () => {
      // With 0 jitter (randomJitter = 0.5)
      const b0 = calculateBackoffMs(0, 1000, 30000, 0.5);
      const b1 = calculateBackoffMs(1, 1000, 30000, 0.5);
      const b2 = calculateBackoffMs(2, 1000, 30000, 0.5);
      const b3 = calculateBackoffMs(3, 1000, 30000, 0.5);
      const b10 = calculateBackoffMs(10, 1000, 30000, 0.5);

      expect(b0).toBe(1000);
      expect(b1).toBe(2000);
      expect(b2).toBe(4000);
      expect(b3).toBe(8000);
      expect(b10).toBe(30000); // clamped to maxMs
    });

    it("applies bounded jitter", () => {
      // Min jitter (randomJitter = 0) -> exp - 20%
      const minJitter = calculateBackoffMs(2, 1000, 30000, 0);
      // Max jitter (randomJitter = 1) -> exp + 20%
      const maxJitter = calculateBackoffMs(2, 1000, 30000, 1);

      expect(minJitter).toBe(3200); // 4000 - 800
      expect(maxJitter).toBe(4800); // 4000 + 800
    });
  });

  describe("pruneOfflineBuffer", () => {
    function makeEvent(id: string): ContractEvent {
      return {
        id,
        source: "claude",
        surface: "web",
        kind: "done",
        title: "Test",
        text: "Test",
        target: { type: "browserTab", tabId: 1, windowId: 1 },
        createdAt: new Date().toISOString(),
        dedupeKey: `test:${id}`,
      };
    }

    it("drops events older than maxAgeMs (2 minutes)", () => {
      const now = 200000;
      const buffer: BufferedEvent[] = [
        { event: makeEvent("1"), queuedAt: now - 150000 }, // 150s old (> 120s) -> should drop
        { event: makeEvent("2"), queuedAt: now - 60000 },  // 60s old (valid)
        { event: makeEvent("3"), queuedAt: now - 10000 },  // 10s old (valid)
      ];

      const pruned = pruneOfflineBuffer(buffer, now, MAX_BUFFER_AGE_MS, MAX_OFFLINE_BUFFER_SIZE);
      expect(pruned.length).toBe(2);
      expect(pruned[0]?.event.id).toBe("2");
      expect(pruned[1]?.event.id).toBe("3");
    });

    it("caps buffer size to MAX_OFFLINE_BUFFER_SIZE (50 items)", () => {
      const now = 100000;
      const buffer: BufferedEvent[] = [];
      for (let i = 0; i < 60; i++) {
        buffer.push({
          event: makeEvent(`ev-${i}`),
          queuedAt: now - 1000,
        });
      }

      const pruned = pruneOfflineBuffer(buffer, now, MAX_BUFFER_AGE_MS, 50);
      expect(pruned.length).toBe(50);
      // Keeps the most recent 50
      expect(pruned[0]?.event.id).toBe("ev-10");
      expect(pruned[49]?.event.id).toBe("ev-59");
    });
  });
});
