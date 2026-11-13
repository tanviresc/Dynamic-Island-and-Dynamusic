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
  /** Injectable time source in ms for testability */
  now?: () => number;
}

export class DetectorEngine {
  private config: SiteConfig;
  private callbacks: DetectorCallbacks;
  private querySelector: (selector: string) => Element | null;
  private now: () => number;

  private state: DetectorState = "idle";
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
    this.now = options.now || (() => Date.now());
  }

  public getState(): DetectorState {
    return this.state;
  }

  public getGenerationCount(): number {
    return this.genCounter;
  }

  /**
   * Evaluates the DOM and updates the state machine.
   * Can be invoked on MutationObserver callbacks or polling ticks.
   */
  public evaluate(): void {
    const isGenerating = this.checkIsGenerating();
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
      if (this.querySelector(selector) !== null) {
        return true;
      }
    }
    return false;
  }

  private checkNeedsInput(): void {
    for (const selector of this.config.selectors.needsInput) {
      const el = this.querySelector(selector);
      if (el) {
        // Find or create prompt ID
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
          const promptText = el.getAttribute("aria-label") || undefined;
          this.callbacks.onNeedsInput({
            promptId,
            promptText,
          });
        }
        return;
      }
    }
  }

  private scheduleSettlingDebounce(): void {
    this.cancelSettlingDebounce();
    this.debounceTimer = setTimeout(() => {
      this.onDebounceCompleted();
    }, this.config.settlingDebounceMs);
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
