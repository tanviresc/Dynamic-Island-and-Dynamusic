/**
 * Isolated high-frequency playback clock.
 *
 * HTML5 `<audio>` emits `timeupdate` ~4 times/sec. Keeping sub-second progress
 * ticks outside Zustand prevents unrelated UI trees from re-rendering while
 * still giving seek bars and mini-players 60fps/4Hz smoothness via
 * `useSyncExternalStore`.
 */
export interface PlaybackClockSnapshot {
  position: number;
  duration: number;
  buffered: number;
  generation: number;
}

let snapshot: PlaybackClockSnapshot = {
  position: 0,
  duration: 0,
  buffered: 0,
  generation: 0,
};

const listeners = new Set<() => void>();

function notify(): void {
  for (const l of listeners) l();
}

export function setPlaybackClock(position: number, duration?: number, buffered?: number): void {
  const nextPos = Number.isFinite(position) ? Math.max(0, position) : snapshot.position;
  const nextDur =
    duration !== undefined && Number.isFinite(duration) ? Math.max(0, duration) : snapshot.duration;
  const nextBuf =
    buffered !== undefined && Number.isFinite(buffered) ? Math.max(0, buffered) : snapshot.buffered;
  if (
    Math.abs(nextPos - snapshot.position) < 0.01 &&
    Math.abs(nextDur - snapshot.duration) < 0.01 &&
    Math.abs(nextBuf - snapshot.buffered) < 0.01
  ) {
    return;
  }
  snapshot = {
    position: nextPos,
    duration: nextDur,
    buffered: nextBuf,
    generation: snapshot.generation + 1,
  };
  notify();
}

export function setPlaybackBuffered(buffered: number): void {
  const nextBuf = Number.isFinite(buffered) ? Math.max(0, buffered) : snapshot.buffered;
  if (Math.abs(nextBuf - snapshot.buffered) < 0.05) return;
  snapshot = { ...snapshot, buffered: nextBuf, generation: snapshot.generation + 1 };
  notify();
}

export function resetPlaybackClock(duration = 0): void {
  snapshot = {
    position: 0,
    duration: Number.isFinite(duration) ? Math.max(0, duration) : 0,
    buffered: 0,
    generation: snapshot.generation + 1,
  };
  notify();
}

export function getPlaybackClock(): PlaybackClockSnapshot {
  return snapshot;
}

export function subscribePlaybackClock(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

