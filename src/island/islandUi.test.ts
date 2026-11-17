import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it, expect } from "vitest";
import { Dot } from "./Dot";
import { Pill } from "./Pill";
import { QueuePanel } from "./QueuePanel";
import { IslandRoot } from "./IslandRoot";
import { standardMotion } from "./motion";
import { computePillGeometry } from "./measure";

describe("Island UI Fixes", () => {
  it("renders Dot with 6px visual dot inside an invisible 24x24 pointer-events:auto container", () => {
    const html = renderToStaticMarkup(
      React.createElement(Dot, { color: "#30D158", onClick: () => {} })
    );
    expect(html).toContain("width:24px");
    expect(html).toContain("height:24px");
    expect(html).toContain("pointer-events:auto");
    expect(html).toContain("background:transparent");
    expect(html).toContain("width:6px");
    expect(html).toContain("height:6px");
    expect(html).toContain("pointer-events:none");
    expect(html).not.toContain("title=");
  });

  it("removes hover tooltips from Pill and QueuePanel", () => {
    const pillHtml = renderToStaticMarkup(
      React.createElement(Pill, {
        id: "p1",
        source: "claude",
        kind: "needs_input",
        title: "Claude needs input",
        text: "Approve tool call",
      })
    );
    expect(pillHtml).not.toContain("title=");

    const queueHtml = renderToStaticMarkup(
      React.createElement(QueuePanel, {
        items: [
          {
            id: "q1",
            source: "gmail",
            kind: "done",
            title: "Gmail · New mail",
            text: "New unread email arrived",
            createdAt: "now",
          },
        ],
        onItemClick: () => {},
        onClear: () => {},
        onClose: () => {},
      })
    );
    expect(queueHtml).not.toContain("title=");
  });

  it("uses 450ms cubic-bezier(0.16, 1, 0.3, 1) damped easing for Island transitions", () => {
    expect(standardMotion.appear.layout.duration).toBe(0.45);
    expect(standardMotion.appear.layout.ease).toEqual([0.16, 1, 0.3, 1]);
    expect(standardMotion.disappear.layout.duration).toBe(0.45);
    expect(standardMotion.disappear.layout.ease).toEqual([0.16, 1, 0.3, 1]);
    expect(standardMotion.queueOpen.layout.duration).toBe(0.45);
    expect(standardMotion.queueOpen.layout.ease).toEqual([0.16, 1, 0.3, 1]);
    expect(standardMotion.queueClose.layout.duration).toBe(0.45);
    expect(standardMotion.queueClose.layout.ease).toEqual([0.16, 1, 0.3, 1]);
  });

  it("renders IslandRoot hidden, dot, and queue states cleanly without hover triggers or music previews", () => {
    const hiddenHtml = renderToStaticMarkup(
      React.createElement(IslandRoot, { initialMode: "hidden" })
    );
    expect(hiddenHtml).toContain("island-surface-transition");
    expect(hiddenHtml).not.toContain("Hover to reveal");
    expect(hiddenHtml).not.toContain("onMouseEnter");

    const dotHtml = renderToStaticMarkup(
      React.createElement(Dot, { color: "#30D158", onClick: () => {} })
    );
    expect(dotHtml).toContain('aria-label="Toggle Notification History"');
    expect(dotHtml).not.toContain("Dynamusic");

    const queueHtml = renderToStaticMarkup(
      React.createElement(QueuePanel, {
        items: [],
        onItemClick: () => {},
        onClear: () => {},
        onClose: () => {},
      })
    );
    expect(queueHtml).not.toContain("Previous track");
    expect(queueHtml).not.toContain("Next track");
    expect(queueHtml).not.toContain("Dynamusic");
  });

  it("allocates extra width for needsInput badge in computePillGeometry", () => {
    const normal = computePillGeometry({
      title: "Claude",
      text: "Task finished",
      needsInput: false,
    });
    const needsInput = computePillGeometry({
      title: "Claude",
      text: "Task finished",
      needsInput: true,
    });
    expect(needsInput.width).toBeGreaterThan(normal.width);
  });
});
