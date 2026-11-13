import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { DetectorEngine } from "./engine";
import { SiteConfig } from "../sites/types";

describe("DetectorEngine", () => {
  let mockDom: Record<string, any>;
  let mockTime = 10000;
  const siteConfig: SiteConfig = {
    source: "claude",
    displayName: "Claude",
    hostnames: ["claude.ai"],
    status: "UNVERIFIED",
    selectors: {
      generating: ['button[aria-label="Stop"]'],
      needsInput: ['[data-testid="tool-approval"]'],
    },
    settlingDebounceMs: 1500,
    minGenerationDurationMs: 800,
    notes: "test config",
  };

  beforeEach(() => {
    vi.useFakeTimers();
    mockTime = 10000;
    mockDom = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function createMockElement(attrs: Record<string, string> = {}) {
    const attributes = { ...attrs };
    return {
      getAttribute: (name: string) => attributes[name] || null,
      setAttribute: (name: string, val: string) => {
        attributes[name] = val;
      },
    } as unknown as Element;
  }

  it("emits done after duration >= 800ms and 1500ms debounce", () => {
    const doneEvents: any[] = [];
    const engine = new DetectorEngine({
      config: siteConfig,
      callbacks: {
        onDone: (d) => doneEvents.push(d),
        onNeedsInput: () => {},
      },
      querySelector: (sel) => mockDom[sel] || null,
      now: () => mockTime,
    });

    // 1. Initial idle
    expect(engine.getState()).toBe("idle");
    engine.evaluate();
    expect(engine.getState()).toBe("idle");
    expect(doneEvents.length).toBe(0);

    // 2. Start generating
    mockDom['button[aria-label="Stop"]'] = createMockElement();
    engine.evaluate();
    expect(engine.getState()).toBe("generating");

    // Advance time by 2000ms (generation in progress)
    mockTime += 2000;
    engine.evaluate();
    expect(engine.getState()).toBe("generating");

    // 3. Stop generating -> enters settling
    mockDom['button[aria-label="Stop"]'] = null;
    engine.evaluate();
    expect(engine.getState()).toBe("settling");
    expect(doneEvents.length).toBe(0);

    // Fast-forward 1400ms (less than 1500ms debounce)
    vi.advanceTimersByTime(1400);
    expect(engine.getState()).toBe("settling");
    expect(doneEvents.length).toBe(0);

    // Fast-forward remaining 100ms
    vi.advanceTimersByTime(100);
    expect(engine.getState()).toBe("idle");
    expect(doneEvents.length).toBe(1);
    expect(doneEvents[0].durationMs).toBe(2000);
    expect(doneEvents[0].genCount).toBe(1);
  });

  it("cancels settling debounce if generation resumes", () => {
    const doneEvents: any[] = [];
    const engine = new DetectorEngine({
      config: siteConfig,
      callbacks: {
        onDone: (d) => doneEvents.push(d),
        onNeedsInput: () => {},
      },
      querySelector: (sel) => mockDom[sel] || null,
      now: () => mockTime,
    });

    // Start generating
    mockDom['button[aria-label="Stop"]'] = createMockElement();
    engine.evaluate();
    expect(engine.getState()).toBe("generating");

    mockTime += 1000;
    // Stop generating -> settling
    mockDom['button[aria-label="Stop"]'] = null;
    engine.evaluate();
    expect(engine.getState()).toBe("settling");

    // Advance 1000ms (debounce not yet reached)
    vi.advanceTimersByTime(1000);
    mockTime += 1000;

    // Resumes generating!
    mockDom['button[aria-label="Stop"]'] = createMockElement();
    engine.evaluate();
    expect(engine.getState()).toBe("generating");

    // Advance 2000ms: no done event should have fired
    vi.advanceTimersByTime(2000);
    expect(doneEvents.length).toBe(0);

    // Now stops generating for real
    mockTime += 2000;
    mockDom['button[aria-label="Stop"]'] = null;
    engine.evaluate();
    expect(engine.getState()).toBe("settling");

    vi.advanceTimersByTime(1500);
    expect(engine.getState()).toBe("idle");
    expect(doneEvents.length).toBe(1);
  });

  it("ignores generations shorter than 800ms", () => {
    const doneEvents: any[] = [];
    const engine = new DetectorEngine({
      config: siteConfig,
      callbacks: {
        onDone: (d) => doneEvents.push(d),
        onNeedsInput: () => {},
      },
      querySelector: (sel) => mockDom[sel] || null,
      now: () => mockTime,
    });

    // Start generating
    mockDom['button[aria-label="Stop"]'] = createMockElement();
    engine.evaluate();

    // Generation lasts only 400ms (< 800ms)
    mockTime += 400;
    mockDom['button[aria-label="Stop"]'] = null;
    engine.evaluate();
    expect(engine.getState()).toBe("settling");

    // Debounce passes
    vi.advanceTimersByTime(1500);
    expect(engine.getState()).toBe("idle");
    expect(doneEvents.length).toBe(0); // Ignored!
  });

  it("emits needs_input once per prompt instance", () => {
    const needsInputEvents: any[] = [];
    const engine = new DetectorEngine({
      config: siteConfig,
      callbacks: {
        onDone: () => {},
        onNeedsInput: (d) => needsInputEvents.push(d),
      },
      querySelector: (sel) => mockDom[sel] || null,
      now: () => mockTime,
    });

    const promptElement = createMockElement({
      "aria-label": "Tool execution approval requested",
    });
    mockDom['[data-testid="tool-approval"]'] = promptElement;

    // First evaluation: detected
    engine.evaluate();
    expect(needsInputEvents.length).toBe(1);
    expect(needsInputEvents[0].promptId).toBe("prompt-1");
    expect(needsInputEvents[0].promptText).toBe(
      "Tool execution approval requested"
    );

    // Subsequent evaluations with the SAME element: does NOT re-emit
    engine.evaluate();
    engine.evaluate();
    expect(needsInputEvents.length).toBe(1);

    // New prompt element appears: emits for new instance
    const newPromptElement = createMockElement();
    mockDom['[data-testid="tool-approval"]'] = newPromptElement;
    engine.evaluate();
    expect(needsInputEvents.length).toBe(2);
    expect(needsInputEvents[1].promptId).toBe("prompt-2");
  });
});
