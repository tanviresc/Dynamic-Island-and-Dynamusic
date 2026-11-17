import { describe, expect, it, vi } from "vitest";
import { MobileInterruptionController, isMobileWebRuntime } from "./mobileBackgroundAudio";

describe("MobileInterruptionController & mobile runtime gating", () => {
  it("tracks transient native focus loss and auto-resumes on focus gain unless manually paused", () => {
    const ctl = new MobileInterruptionController();
    const uiPause = vi.fn();
    const uiResume = vi.fn();

    ctl.onNativeFocusLost("track_1", uiPause);
    expect(uiPause).toHaveBeenCalledTimes(1);
    expect(ctl.getState()).toEqual({
      pausedByInterruption: true,
      origin: "native",
      interruptedTrackId: "track_1",
    });
    expect(ctl.consumeSuppressNextNativePause()).toBe(true);
    expect(ctl.consumeSuppressNextNativePause()).toBe(false);

    const resumed = ctl.onNativeFocusGained("track_1", uiResume);
    expect(resumed).toBe(true);
    expect(uiResume).toHaveBeenCalledTimes(1);
    expect(ctl.getState().pausedByInterruption).toBe(false);

    // User manual pause cancels auto-resume for any active interruption.
    ctl.onNativeFocusLost("track_2", uiPause);
    ctl.clear(true);
    expect(ctl.onNativeFocusGained("track_2", uiResume)).toBe(false);
    expect(uiResume).toHaveBeenCalledTimes(1);
  });

  it("handles mobile web OS interruptions without resuming on a different track", () => {
    const ctl = new MobileInterruptionController();
    const uiPause = vi.fn();
    const resumeAudio = vi.fn();

    ctl.onWebFocusLost("track_a", uiPause);
    expect(uiPause).toHaveBeenCalledTimes(1);
    expect(ctl.tryResumeWebInterruption("track_b", resumeAudio)).toBe(false);
    expect(ctl.tryResumeWebInterruption("track_a", resumeAudio)).toBe(true);
    expect(resumeAudio).toHaveBeenCalledTimes(1);
  });

  it("does not misidentify desktop/Node runtimes as mobile web", () => {
    expect(isMobileWebRuntime()).toBe(false);
  });
});
