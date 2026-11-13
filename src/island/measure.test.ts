import { describe, it, expect } from "vitest";
import {
  computePillGeometry,
  PILL_MIN_WIDTH,
  PILL_MAX_WIDTH,
  PILL_ONE_LINE_HEIGHT,
} from "./measure";

describe("computePillGeometry", () => {
  it("enforces minimum width on short content", () => {
    const geo = computePillGeometry({
      title: "Hi",
      text: "Done",
    });
    expect(geo.width).toBe(PILL_MIN_WIDTH);
    expect(geo.height).toBe(PILL_ONE_LINE_HEIGHT);
    expect(geo.borderRadius).toBe(Math.round(PILL_ONE_LINE_HEIGHT / 2));
    expect(geo.isTwoLines).toBe(false);
  });

  it("sizes single-line content within bounds", () => {
    const geo = computePillGeometry({
      title: "Claude",
      text: "Task completed successfully",
    });
    expect(geo.width).toBeGreaterThanOrEqual(PILL_MIN_WIDTH);
    expect(geo.width).toBeLessThanOrEqual(PILL_MAX_WIDTH);
    expect(geo.height).toBe(PILL_ONE_LINE_HEIGHT);
    expect(geo.isTwoLines).toBe(false);
  });

  it("keeps long content on one line at max width", () => {
    const geo = computePillGeometry({
      title: "Antigravity IDE Agent",
      text: "This is an extremely long notification text that will definitely exceed the maximum pill width",
    });
    expect(geo.width).toBe(PILL_MAX_WIDTH);
    expect(geo.height).toBe(PILL_ONE_LINE_HEIGHT);
    expect(geo.borderRadius).toBe(Math.round(PILL_ONE_LINE_HEIGHT / 2));
    expect(geo.isTwoLines).toBe(false);
  });

  it("handles category tags accurately", () => {
    const geo = computePillGeometry({
      title: "Security Alert",
      text: "New sign-in",
      category: "Security",
    });
    expect(geo.width).toBeGreaterThanOrEqual(PILL_MIN_WIDTH);
    expect(geo.height).toBe(PILL_ONE_LINE_HEIGHT);
    expect(geo.isTwoLines).toBe(false);
  });
});
