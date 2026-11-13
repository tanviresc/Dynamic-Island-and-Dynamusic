/**
 * Structure-only DOM inspector for discovering site selectors.
 * Strictly adheres to security & privacy rules (§1.10.1, §5.6):
 * - Reports ONLY: tag, role, aria-label, data-testid, and button labels <= 24 chars on <button> elements only.
 * - NEVER reads or logs message contents, input fields, or chat text.
 * - Prints report directly to DevTools console of that tab only.
 */

export interface ProbeElementSummary {
  tag: string;
  role?: string;
  ariaLabel?: string;
  dataTestId?: string;
  buttonLabel?: string; // <= 24 chars, <button> only
  className?: string;
  id?: string;
}

export class ProbeEngine {
  private isRunning = false;
  private observer: MutationObserver | null = null;
  private lastReportTime = 0;
  private throttleMs = 2000;

  public start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(
      "%c[Island Probe Mode] Enabled on " + window.location.hostname,
      "color: #00ffcc; font-weight: bold;"
    );

    // Initial snapshot
    this.dumpCandidateControls("initial");

    // Watch mutations with throttling
    this.observer = new MutationObserver(() => {
      const now = Date.now();
      if (now - this.lastReportTime >= this.throttleMs) {
        this.lastReportTime = now;
        this.dumpCandidateControls("dom-change");
      }
    });

    this.observer.observe(document.body || document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-label", "role", "data-testid", "class", "disabled"],
    });
  }

  public stop(): void {
    if (!this.isRunning) return;
    this.isRunning = false;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
    console.log("[Island Probe Mode] Disabled");
  }

  public dumpCandidateControls(trigger: string): void {
    const candidates = this.findCandidateControls();
    console.groupCollapsed(
      `[Island Probe] Candidate Controls (${trigger}) - ${new Date().toLocaleTimeString()}`
    );
    console.table(candidates);
    console.groupEnd();
  }

  private findCandidateControls(): ProbeElementSummary[] {
    const results: ProbeElementSummary[] = [];

    // Query interactive controls: buttons, dialogs, alerts, progress bars
    const query =
      'button, [role="button"], [role="alertdialog"], [role="dialog"], [role="progressbar"], [data-testid], [data-test-id]';
    const elements = document.querySelectorAll(query);

    elements.forEach((el) => {
      const tag = el.tagName.toLowerCase();
      const role = el.getAttribute("role") || undefined;
      const ariaLabel = el.getAttribute("aria-label") || undefined;
      const dataTestId =
        el.getAttribute("data-testid") ||
        el.getAttribute("data-test-id") ||
        undefined;
      const id = el.id || undefined;
      const className =
        typeof el.className === "string" && el.className.length > 0
          ? el.className.slice(0, 50)
          : undefined;

      let buttonLabel: string | undefined = undefined;
      if (tag === "button" || role === "button") {
        const text = el.textContent?.trim() || "";
        // Strict privacy rule: <= 24 chars on buttons only, never long text
        if (text.length > 0 && text.length <= 24 && !text.includes("\n")) {
          buttonLabel = text;
        }
      }

      // Filter interesting candidates (buttons with labels, testids, or dialogs)
      if (ariaLabel || dataTestId || buttonLabel || role === "alertdialog" || role === "progressbar") {
        results.push({
          tag,
          role,
          ariaLabel,
          dataTestId,
          buttonLabel,
          className,
          id,
        });
      }
    });

    return results.slice(0, 50); // clamp output
  }
}
