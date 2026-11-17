import { SiteConfig } from "../sites/types";

export type DetectorState = "idle" | "generating" | "settling";

export interface DetectorCallbacks {
  onDone: (detail: { durationMs: number; genCount: number }) => void;
  onNeedsInput: (detail: { promptId: string; promptText?: string }) => void;
}

export interface DetectorOptions {
  config: SiteConfig;
  callbacks: DetectorCallbacks;
  /** Injectable query selector for testability */
  querySelector?: (selector: string) => Element | null;
  /** Injectable multi-element selector for button text matching */
  querySelectorAll?: (selector: string) => Iterable<Element>;
  /** Injectable time source in ms for testability */
  now?: () => number;
  /** Injectable document visibility check for background tab handling */
  isDocumentHidden?: () => boolean;
}

export class DetectorEngine {
  private config: SiteConfig;
  private callbacks: DetectorCallbacks;
  private querySelector: (selector: string) => Element | null;
  private querySelectorAll: (selector: string) => Iterable<Element>;
  private now: () => number;
  private isDocumentHidden: () => boolean;

  private state: DetectorState = "idle";
  private networkGenerating = false;
  private streamTriggered = false;
  private ignoreStaleDomUntilSettled = false;
  private generationStartTime = 0;
  private settlingStartTime = 0;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private genCounter = 0;

  // Track prompt instances already notified to avoid repeat needs_input events
  private seenPromptIds = new Set<string>();
  private promptCounter = 0;

  constructor(options: DetectorOptions) {
    this.config = options.config;
    this.callbacks = options.callbacks;
    this.querySelector =
      options.querySelector ||
      ((sel: string) =>
        typeof document !== "undefined" ? document.querySelector(sel) : null);
    this.querySelectorAll =
      options.querySelectorAll ||
      ((sel: string) =>
        typeof document !== "undefined" ? document.querySelectorAll(sel) : []);
    this.now = options.now || (() => Date.now());
    this.isDocumentHidden =
      options.isDocumentHidden ||
      (() => (typeof document !== "undefined" ? document.hidden : false));
  }

  public getState(): DetectorState {
    return this.state;
  }

  public getGenerationCount(): number {
    return this.genCounter;
  }

  public setNetworkGenerating(active: boolean): void {
    if (this.networkGenerating === active) return;
    this.networkGenerating = active;
    if (active) {
      this.streamTriggered = true;
      this.ignoreStaleDomUntilSettled = false;
    } else if (this.streamTriggered) {
      this.streamTriggered = false;
      // When the network stream finishes while the tab is hidden/backgrounded,
      // browsers throttle React/DOM paints so the DOM Stop button can remain mounted
      // until the user returns to the tab. Do not let stale hidden DOM block completion!
      if (this.isDocumentHidden()) {
        this.ignoreStaleDomUntilSettled = true;
      }
    }
    this.evaluate();
  }

  /**
   * Evaluates the DOM and updates the state machine.
   * Can be invoked on MutationObserver callbacks or polling ticks.
   */
  public evaluate(): void {
    const domGenerating = this.checkIsGenerating();
    if (this.ignoreStaleDomUntilSettled && !domGenerating) {
      this.ignoreStaleDomUntilSettled = false;
    }
    const effectiveDomGenerating = this.ignoreStaleDomUntilSettled ? false : domGenerating;
    const isGenerating = this.networkGenerating || effectiveDomGenerating;
    const currentTime = this.now();

    // 1. Check needs_input prompts
    this.checkNeedsInput();

    // 2. Generation state machine transitions
    switch (this.state) {
      case "idle": {
        if (isGenerating) {
          this.state = "generating";
          this.generationStartTime = currentTime;
          this.genCounter += 1;
        }
        break;
      }

      case "generating": {
        if (!isGenerating) {
          // Begun settling
          this.state = "settling";
          this.settlingStartTime = currentTime;
          this.scheduleSettlingDebounce();
        }
        break;
      }

      case "settling": {
        if (isGenerating) {
          // Resumed generation: cancel debounce and return to generating
          this.cancelSettlingDebounce();
          this.state = "generating";
        }
        break;
      }
    }
  }

  private checkIsGenerating(): boolean {
    for (const selector of this.config.selectors.generating) {
      try {
        if (this.querySelector(selector) !== null) {
          return true;
        }
      } catch {
        continue;
      }
    }
    return false;
  }

  private checkNeedsInput(): void {
    const notifyPromptElement = (el: Element, fallbackLabel?: string) => {
      let promptId = el.getAttribute("data-island-prompt-id");
      if (!promptId) {
        this.promptCounter += 1;
        promptId = `prompt-${this.promptCounter}`;
        try {
          el.setAttribute("data-island-prompt-id", promptId);
        } catch {
          // In case element is not mock-settable
        }
      }

      if (!this.seenPromptIds.has(promptId)) {
        this.seenPromptIds.add(promptId);
        const promptText = el.getAttribute("aria-label") || fallbackLabel || undefined;
        this.callbacks.onNeedsInput({
          promptId,
          promptText,
        });
      }
    };

    for (const selector of this.config.selectors.needsInput) {
      try {
        const el = this.querySelector(selector);
        if (el) {
          notifyPromptElement(el);
          return;
        }
      } catch {
        continue;
      }
    }

    const matchers = this.config.selectors.needsInputTextMatchers;
    if (matchers && matchers.length > 0) {
      try {
        const candidates = this.querySelectorAll(
          '[role="dialog"] button, [role="alertdialog"] button, main button, form button'
        );
        for (const el of candidates) {
          const text = (el.textContent || "").trim().toLowerCase();
          if (!text || text.length > 48) continue;
          if (matchers.some((m) => text === m || text.startsWith(`${m} `))) {
            notifyPromptElement(el, "Action approval needed");
            return;
          }
        }
      } catch {
        /* ignore DOM scan failure */
      }
    }
  }

  private scheduleSettlingDebounce(): void {
    this.cancelSettlingDebounce();
    const delay =
      this.ignoreStaleDomUntilSettled && this.isDocumentHidden()
        ? Math.min(this.config.settlingDebounceMs, 250)
        : this.config.settlingDebounceMs;
    this.debounceTimer = setTimeout(() => {
      this.onDebounceCompleted();
    }, delay);
  }

  private cancelSettlingDebounce(): void {
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
  }

  private onDebounceCompleted(): void {
    if (this.state !== "settling") {
      return;
    }

    const duration = this.settlingStartTime - this.generationStartTime;
    this.state = "idle";
    this.debounceTimer = null;

    // Minimum generation duration check (>= 800 ms per §1.10.1)
    if (duration >= this.config.minGenerationDurationMs) {
      this.callbacks.onDone({
        durationMs: duration,
        genCount: this.genCounter,
      });
    }
  }

  public dispose(): void {
    this.cancelSettlingDebounce();
    this.state = "idle";
    this.seenPromptIds.clear();
  }
}
