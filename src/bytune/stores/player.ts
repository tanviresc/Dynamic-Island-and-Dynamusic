/** Player state — pure data; playback side effects live in lib/audio.ts. */
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { coalescedStorage } from "../lib/persist";
import { hash32, seededShuffle } from "../lib/recs/seeded";
import type { Track } from "../types";
import { useSettings } from "./settings";
import { inRoom } from "./room";
import { getRemoteCommandDispatcher, registerRemoteCommandDispatcher } from "../lib/remoteDispatch";

export { registerRemoteCommandDispatcher };

export type RepeatMode = "off" | "all" | "one";
export type PlaybackStatus = "idle" | "loading" | "buffering" | "playing" | "error";

/** Played history cap so storage stays bounded during endless AutoPlay sessions. */
const HISTORY_KEEP = 100;

/** A bare YouTube video id — the only kind of track YouTube Music has a radio for. */
export function isRadioSeed(id: string | undefined): boolean {
  return !!id && /^[A-Za-z0-9_-]{11}$/.test(id);
}

/** How many upcoming entries at the tail are AutoPlay suggestions. */
export function autoplayTail(s: { queue: Track[]; index: number; autoplayCount: number }): number {
  return Math.max(0, Math.min(s.autoplayCount, s.queue.length - s.index - 1));
}

/** How many upcoming entries right after current belong to the user's Priority Queue. */
export function priorityTail(s: {
  queue: Track[];
  index: number;
  priorityCount?: number;
  autoplayCount: number;
  priorityQueue?: Track[];
}): number {
  if (Array.isArray(s.priorityQueue)) return s.priorityQueue.length;
  const maxAvail = Math.max(0, s.queue.length - s.index - 1 - autoplayTail(s));
  return Math.max(0, Math.min(s.priorityCount ?? 0, maxAvail));
}

/** The song on screen: the one a blend has crossed over to, else the one playing. */
export function shownTrack(s: {
  blendInto: Track | null;
  currentTrack?: Track | null;
  queue: Track[];
  index: number;
}): Track | null {
  return s.blendInto ?? s.currentTrack ?? s.queue[s.index] ?? null;
}

type DualPlayOrder = {
  priorityQueue?: Track[];
  contextQueue?: Track[];
  contextIndex?: number;
  currentFromPriority?: boolean;
  autoplayTracks?: Track[];
  queue: Track[];
  index: number;
  autoplayCount: number;
  priorityCount?: number;
  repeat: RepeatMode;
  shuffle: boolean;
};

/**
 * Resolve the single authoritative track that plays immediately after the current one:
 * Priority Queue always preempts Context Queue and AutoPlay.
 */
export function upNext(s: DualPlayOrder): Track | null {
  if (s.repeat === "one") return null;

  if (Array.isArray(s.priorityQueue) && Array.isArray(s.contextQueue)) {
    if (s.priorityQueue.length > 0) return s.priorityQueue[0];
    const cIdx = s.contextIndex ?? 0;
    const nextIdx = s.currentFromPriority ? cIdx : cIdx + 1;
    if (nextIdx >= 0 && nextIdx < s.contextQueue.length) {
      return s.contextQueue[nextIdx];
    }
    if (s.repeat === "all" && s.contextQueue.length >= 2) {
      const wrapped = s.shuffle ? nextPass(s.contextQueue) : s.contextQueue;
      return wrapped[0] ?? null;
    }
    if (s.autoplayTracks && s.autoplayTracks.length > 0) {
      return s.autoplayTracks[0];
    }
    return null;
  }

  // Fallback for plain snapshots holding only flat `queue`
  if (s.index + 1 < s.queue.length) return s.queue[s.index + 1];
  if (s.repeat === "all" && s.queue.length >= 2) {
    return (s.shuffle ? nextPass(s.queue) : s.queue)[0] ?? null;
  }
  return null;
}

function autoplayContinues(lastTrack: Track | undefined, repeat: RepeatMode): boolean {
  return useSettings.getState().autoplay && !inRoom() && repeat === "off" && isRadioSeed(lastTrack?.id) && !lastTrack?.episode;
}

const randomSeed = (): number => (Math.random() * 2 ** 32) >>> 0;

/** Order of tracks in your order, rotated to start at `index`. */
const orderFrom = (tracks: Track[], index: number): string[] =>
  [...tracks.slice(index), ...tracks.slice(0, index)].map((t) => t.id);

export function nextPass(queue: Track[]): Track[] {
  if (queue.length < 2) return queue;
  const out = seededShuffle(queue, hash32(queue.map((t) => t.id).join()));
  const last = queue[queue.length - 1]?.id;
  if (out[0].id !== last) return out;
  const k = out.findIndex((t) => t.id !== last);
  if (k < 0) return queue;
  [out[0], out[k]] = [out[k], out[0]];
  return out;
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

interface QueueFields {
  history: Track[];
  currentTrack: Track | null;
  currentFromPriority: boolean;
  priorityQueue: Track[];
  contextQueue: Track[];
  contextIndex: number;
  autoplayTracks: Track[];
  autoplayCount: number;
  priorityCount: number;
  queue: Track[];
  index: number;
}

function contextUpcomingSlice(s: Pick<QueueFields, "contextQueue" | "contextIndex" | "currentFromPriority">): Track[] {
  if (!s.contextQueue.length) return [];
  const start = s.currentFromPriority ? Math.max(0, s.contextIndex) : Math.max(0, s.contextIndex + 1);
  return s.contextQueue.slice(start);
}

/** Rebuild derived backwards-compatible flat `queue`, `index`, `priorityCount`, and `autoplayCount`. */
function syncDerived(partial: QueueFields): QueueFields {
  const history = partial.history.length > HISTORY_KEEP ? partial.history.slice(partial.history.length - HISTORY_KEEP) : partial.history;
  const upcomingContext = contextUpcomingSlice({
    contextQueue: partial.contextQueue,
    contextIndex: partial.contextIndex,
    currentFromPriority: partial.currentFromPriority,
  });
  const currentArr = partial.currentTrack ? [partial.currentTrack] : [];
  const queue = [...history, ...currentArr, ...partial.priorityQueue, ...upcomingContext, ...partial.autoplayTracks];
  const index = partial.currentTrack ? history.length : 0;
  return {
    ...partial,
    history,
    queue,
    index,
    priorityCount: partial.priorityQueue.length,
    autoplayCount: partial.autoplayTracks.length,
  };
}

function shuffleTail(tracks: Track[], fromIndex: number): Track[] {
  if (tracks.length <= fromIndex + 1) return tracks;
  const keep = tracks.slice(0, fromIndex + 1);
  const rest = seededShuffle(tracks.slice(fromIndex + 1), randomSeed());
  return [...keep, ...rest];
}

function restoreOrderFromCycle(tracks: Track[], startFrom: number, cycleOrder: string[]): Track[] {
  if (!cycleOrder.length || tracks.length <= startFrom + 1) return tracks;
  const currentId = tracks[startFrom]?.id;
  const curPos = currentId ? cycleOrder.indexOf(currentId) : 0;
  const n = cycleOrder.length;
  const rotated = curPos > 0 ? [...cycleOrder.slice(curPos), ...cycleOrder.slice(0, curPos)] : cycleOrder;
  const rankMap = new Map<string, number>();
  rotated.forEach((id, i) => {
    if (!rankMap.has(id)) rankMap.set(id, i);
  });
  const keep = tracks.slice(0, startFrom + 1);
  const rest = [...tracks.slice(startFrom + 1)].sort((a, b) => {
    const ra = rankMap.get(a.id) ?? n + 1;
    const rb = rankMap.get(b.id) ?? n + 1;
    return ra - rb;
  });
  return [...keep, ...rest];
}

function pushHistory(history: Track[], track: Track | null): Track[] {
  if (!track) return history;
  const next = [...history, track];
  return next.length > HISTORY_KEEP ? next.slice(next.length - HISTORY_KEEP) : next;
}

export interface PlayerState {
  // Authoritative dual-layer queue architecture
  history: Track[];
  currentTrack: Track | null;
  currentFromPriority: boolean;
  /** User-queued songs — ALWAYS play FIFO immediately after currentTrack before contextQueue resumes. */
  priorityQueue: Track[];
  /** Underlying active playlist / album / search context. */
  contextQueue: Track[];
  contextIndex: number;
  /** Trailing AutoPlay suggestions. */
  autoplayTracks: Track[];

  // Derived compatibility fields used across views, persistence, and audio engine
  queue: Track[];
  index: number;
  priorityCount: number;
  autoplayCount: number;

  playing: boolean;
  buffering: boolean;
  playbackStatus: PlaybackStatus;
  position: number;
  duration: number;
  /** 0..1 — how much of the current track the audio element has buffered */
  buffered: number;
  volume: number;
  muted: boolean;
  shuffle: boolean;
  repeat: RepeatMode;
  /** bumped whenever the engine should hard-seek to `position` */
  seekNonce: number;
  error: string | null;
  /** The queue ran out and AutoPlay is fetching what plays next (not persisted). */
  awaitingAutoplay: boolean;
  /** Bumped when a new listening context starts, so AutoPlay reseeds (not persisted). */
  contextId: number;
  /** Sidebar row the context queue started from. */
  playingFrom: string | null;
  /** Unshuffled context cycle while shuffle is active. */
  unshuffled: string[] | null;
  /** Target track during a crossfade blend (not persisted). */
  blendInto: Track | null;

  current(): Track | null;
  playQueue(tracks: Track[], startIndex?: number, from?: string): void;
  playTrack(track: Track): void;
  playNow(track: Track): void;
  jumpTo(i: number): void;
  /** Push user tracks into `priorityQueue` (tail if `playNext === false`, head if `playNext === true`). */
  addToQueue(tracks: Track | Track[], playNext?: boolean): number;
  reorderPriority(from: number, to: number): void;
  removePriority(index: number): void;
  clearPriority(): void;
  reorderContext(from: number, to: number): void;
  removeContext(index: number): void;
  clearContextUpcoming(): void;
  /** Unified upcoming move/remove helpers mapped cleanly across priorityQueue / contextQueue / autoplay. */
  moveUpcoming(from: number, to: number): void;
  removeAt(i: number): void;
  clearUpcoming(): void;
  appendAutoplay(tracks: Track[]): void;
  dropAutoplay(): void;
  stopAwaiting(): void;
  next(manual?: boolean): void;
  finishBlend(id: string, position: number): boolean;
  prev(): void;
  toggle(): void;
  setPlaying(playing: boolean): void;
  seek(sec: number): void;
  setVolume(v: number): void;
  toggleMute(): void;
  toggleShuffle(): void;
  cycleRepeat(): void;

  _setTime(position: number, duration?: number): void;
  _setBuffered(ratio: number): void;
  _setBuffering(buffering: boolean): void;
  _setPlaybackStatus(playbackStatus: PlaybackStatus): void;
  _setError(error: string | null): void;
}

function isPcRemoteClient(): boolean {
  if (typeof window === "undefined" || "__TAURI_INTERNALS__" in window) return false;
  try {
    return localStorage.getItem("dynamusic:mobile_mode") === "pc_remote";
  } catch {
    return false;
  }
}

function forwardPcRemote(command: string, payload?: unknown): boolean {
  if (!isPcRemoteClient()) return false;
  const dispatch = getRemoteCommandDispatcher();
  if (dispatch) dispatch(command, payload);
  return true;
}

export const usePlayer = create<PlayerState>()(
  persist(
    (set, get) => ({
      history: [],
      currentTrack: null,
      currentFromPriority: false,
      priorityQueue: [],
      contextQueue: [],
      contextIndex: 0,
      autoplayTracks: [],
      queue: [],
      index: 0,
      priorityCount: 0,
      autoplayCount: 0,
      playing: false,
      buffering: false,
      playbackStatus: "idle",
      position: 0,
      duration: 0,
      buffered: 0,
      volume: 0.8,
      muted: false,
      shuffle: false,
      repeat: "off",
      seekNonce: 0,
      error: null,
      awaitingAutoplay: false,
      contextId: 0,
      playingFrom: null,
      unshuffled: null,
      blendInto: null,

      current() {
        const s = get();
        return s.currentTrack ?? s.queue[s.index] ?? null;
      },

      playQueue(tracks, startIndex = 0, from) {
        if (forwardPcRemote("PLAY_NOW", { tracks, startIndex, from })) return;
        if (!tracks.length) return;
        const start = clamp(startIndex, 0, tracks.length - 1);
        const s = get();
        const chosen = tracks[start];
        const ctxQueue = s.shuffle
          ? [chosen, ...seededShuffle([...tracks.slice(0, start), ...tracks.slice(start + 1)], randomSeed())]
          : [...tracks];
        const ctxIndex = s.shuffle ? 0 : start;
        const history = pushHistory(s.history, s.currentTrack && s.currentTrack.id !== chosen.id ? s.currentTrack : null);
        const nextFields = syncDerived({
          history,
          currentTrack: chosen,
          currentFromPriority: false,
          priorityQueue: s.priorityQueue,
          contextQueue: ctxQueue,
          contextIndex: ctxIndex,
          autoplayTracks: [],
          queue: [],
          index: 0,
          priorityCount: s.priorityQueue.length,
          autoplayCount: 0,
        });
        set({
          ...nextFields,
          unshuffled: s.shuffle ? orderFrom(tracks, start) : null,
          playing: true,
          position: 0,
          error: null,
          awaitingAutoplay: false,
          contextId: s.contextId + 1,
          playingFrom: from ?? null,
        });
      },

      playTrack(track) {
        if (forwardPcRemote("PLAY_NOW", { track })) return;
        const s = get();
        // Check upcoming priorityQueue first
        const pIdx = s.priorityQueue.findIndex((t) => t.id === track.id);
        if (pIdx >= 0) {
          const history = pushHistory(s.history, s.currentTrack);
          const nextPriority = s.priorityQueue.filter((_, i) => i !== pIdx);
          const pausedAt = !s.currentFromPriority && s.contextQueue.length > 0 ? s.contextIndex + 1 : s.contextIndex;
          const nextFields = syncDerived({
            history,
            currentTrack: s.priorityQueue[pIdx],
            currentFromPriority: true,
            priorityQueue: nextPriority,
            contextQueue: s.contextQueue,
            contextIndex: clamp(pausedAt, 0, Math.max(0, s.contextQueue.length)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: nextPriority.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // Check current + upcoming contextQueue
        const cStart = s.currentFromPriority ? s.contextIndex : s.contextIndex;
        const cIdx = s.contextQueue.findIndex((t, i) => i >= cStart && t.id === track.id);
        if (cIdx >= 0) {
          const history = pushHistory(s.history, s.currentTrack && s.currentTrack.id !== track.id ? s.currentTrack : null);
          const nextFields = syncDerived({
            history,
            currentTrack: s.contextQueue[cIdx],
            currentFromPriority: false,
            priorityQueue: s.priorityQueue,
            contextQueue: s.contextQueue,
            contextIndex: cIdx,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // Check AutoPlay tail
        const aIdx = s.autoplayTracks.findIndex((t) => t.id === track.id);
        if (aIdx >= 0) {
          const history = pushHistory(s.history, s.currentTrack);
          const chosen = s.autoplayTracks[aIdx];
          const remainingAuto = s.autoplayTracks.slice(aIdx + 1);
          const nextCtx = [...s.contextQueue, chosen];
          const nextFields = syncDerived({
            history,
            currentTrack: chosen,
            currentFromPriority: false,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: nextCtx.length - 1,
            autoplayTracks: remainingAuto,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: remainingAuto.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // Standalone track ("Play Now"): start fresh single-track context while keeping any queued priority songs
        const history = pushHistory(s.history, s.currentTrack);
        const nextFields = syncDerived({
          history,
          currentTrack: track,
          currentFromPriority: false,
          priorityQueue: s.priorityQueue,
          contextQueue: [track],
          contextIndex: 0,
          autoplayTracks: [],
          queue: [],
          index: 0,
          priorityCount: s.priorityQueue.length,
          autoplayCount: 0,
        });
        set({
          ...nextFields,
          playing: true,
          position: 0,
          error: null,
          awaitingAutoplay: false,
          contextId: s.contextId + 1,
          playingFrom: null,
          unshuffled: null,
        });
      },

      playNow(track) {
        get().playTrack(track);
      },

      jumpTo(i) {
        if (forwardPcRemote("jump_to", i)) return;
        const s = get();
        if (i < 0 || i >= s.queue.length || i === s.index) return;

        // Jumping into history
        if (i < s.history.length) {
          const chosen = s.history[i];
          const newHistory = s.history.slice(0, i);
          const inCtx = s.contextQueue.findIndex((t) => t.id === chosen.id);
          const nextFields = syncDerived({
            history: newHistory,
            currentTrack: chosen,
            currentFromPriority: inCtx < 0,
            priorityQueue: s.priorityQueue,
            contextQueue: s.contextQueue,
            contextIndex: inCtx >= 0 ? inCtx : s.contextIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        const upcomingOffset = i - s.index - 1;
        // Jumping into priorityQueue
        if (upcomingOffset < s.priorityQueue.length) {
          const chosen = s.priorityQueue[upcomingOffset];
          const remainingPriority = s.priorityQueue.slice(upcomingOffset + 1);
          const history = pushHistory(s.history, s.currentTrack);
          const pausedAt = !s.currentFromPriority && s.contextQueue.length > 0 ? s.contextIndex + 1 : s.contextIndex;
          const nextFields = syncDerived({
            history,
            currentTrack: chosen,
            currentFromPriority: true,
            priorityQueue: remainingPriority,
            contextQueue: s.contextQueue,
            contextIndex: clamp(pausedAt, 0, Math.max(0, s.contextQueue.length)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: remainingPriority.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        const ctxUpcoming = contextUpcomingSlice(s);
        const ctxOffset = upcomingOffset - s.priorityQueue.length;
        // Jumping into contextQueue (leaves untouched priorityQueue above or consumes up to jump point? Skipping right to playlist song keeps priorityQueue intact or starts chosen track)
        if (ctxOffset < ctxUpcoming.length) {
          const startCtxIdx = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
          const absCtxIdx = startCtxIdx + ctxOffset;
          const chosen = s.contextQueue[absCtxIdx];
          if (!chosen) return;
          const history = pushHistory(s.history, s.currentTrack);
          const nextFields = syncDerived({
            history,
            currentTrack: chosen,
            currentFromPriority: false,
            priorityQueue: s.priorityQueue,
            contextQueue: s.contextQueue,
            contextIndex: absCtxIdx,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        const autoOffset = ctxOffset - ctxUpcoming.length;
        if (autoOffset >= 0 && autoOffset < s.autoplayTracks.length) {
          const chosen = s.autoplayTracks[autoOffset];
          const adopted = s.autoplayTracks.slice(0, autoOffset + 1);
          const remainingAuto = s.autoplayTracks.slice(autoOffset + 1);
          const nextCtx = [...s.contextQueue, ...adopted];
          const history = pushHistory(s.history, s.currentTrack);
          const nextFields = syncDerived({
            history,
            currentTrack: chosen,
            currentFromPriority: false,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: nextCtx.length - 1,
            autoplayTracks: remainingAuto,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: remainingAuto.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
        }
      },

      addToQueue(tracks, playNext = false) {
        const seenIn = new Set<string>();
        const list = (Array.isArray(tracks) ? tracks : [tracks]).filter((t) => t?.id && !seenIn.has(t.id) && seenIn.add(t.id));
        if (!list.length) return 0;
        if (forwardPcRemote(playNext ? "PLAY_NEXT" : "ADD_PRIORITY_QUEUE", { tracks: list, playNext })) {
          return list.length;
        }
        const s = get();
        // Nothing loaded yet: load the first added track ready to play, remainder into priorityQueue
        if (!s.currentTrack && !s.queue.length) {
          const first = list[0];
          const rest = list.slice(1);
          const nextFields = syncDerived({
            history: [],
            currentTrack: first,
            currentFromPriority: true,
            priorityQueue: rest,
            contextQueue: [],
            contextIndex: 0,
            autoplayTracks: [],
            queue: [],
            index: 0,
            priorityCount: rest.length,
            autoplayCount: 0,
          });
          set({
            ...nextFields,
            playing: false,
            position: 0,
            awaitingAutoplay: false,
          });
          return list.length;
        }

        const existingIds = new Set(s.priorityQueue.map((t) => t.id));
        const toAdd = playNext ? list : list.filter((t) => !existingIds.has(t.id));
        if (!toAdd.length) return 0;

        const addIds = new Set(toAdd.map((t) => t.id));
        // If any queued track was sitting in AutoPlay tail, adopt it out of AutoPlay
        const remainingAuto = s.autoplayTracks.filter((t) => !addIds.has(t.id));
        // For "Play Next", move duplicates to front; for "Add to Queue", append FIFO at end of priorityQueue
        const filteredPriority = s.priorityQueue.filter((t) => !addIds.has(t.id));
        const nextPriority = playNext ? [...toAdd, ...filteredPriority] : [...filteredPriority, ...toAdd];

        if (s.awaitingAutoplay) {
          const [first, ...rest] = nextPriority;
          const history = pushHistory(s.history, s.currentTrack);
          const pausedAt = !s.currentFromPriority && s.contextQueue.length > 0 ? s.contextIndex + 1 : s.contextIndex;
          const nextFields = syncDerived({
            history,
            currentTrack: first,
            currentFromPriority: true,
            priorityQueue: rest,
            contextQueue: s.contextQueue,
            contextIndex: clamp(pausedAt, 0, Math.max(0, s.contextQueue.length)),
            autoplayTracks: remainingAuto,
            queue: [],
            index: 0,
            priorityCount: rest.length,
            autoplayCount: remainingAuto.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return toAdd.length;
        }

        const nextFields = syncDerived({
          history: s.history,
          currentTrack: s.currentTrack,
          currentFromPriority: s.currentFromPriority,
          priorityQueue: nextPriority,
          contextQueue: s.contextQueue,
          contextIndex: s.contextIndex,
          autoplayTracks: remainingAuto,
          queue: [],
          index: 0,
          priorityCount: nextPriority.length,
          autoplayCount: remainingAuto.length,
        });
        set(nextFields);
        return toAdd.length;
      },

      reorderPriority(from, to) {
        if (forwardPcRemote("REORDER_PRIORITY", { from, to })) return;
        const s = get();
        if (from < 0 || from >= s.priorityQueue.length) return;
        const target = clamp(to, 0, s.priorityQueue.length - 1);
        if (from === target) return;
        const nextPriority = [...s.priorityQueue];
        const [moved] = nextPriority.splice(from, 1);
        nextPriority.splice(target, 0, moved);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: nextPriority,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: nextPriority.length,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      removePriority(idx) {
        if (forwardPcRemote("REMOVE_PRIORITY", idx)) return;
        const s = get();
        if (idx < 0 || idx >= s.priorityQueue.length) return;
        const nextPriority = s.priorityQueue.filter((_, i) => i !== idx);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: nextPriority,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: nextPriority.length,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      clearPriority() {
        if (forwardPcRemote("CLEAR_PRIORITY")) return;
        const s = get();
        if (!s.priorityQueue.length) return;
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: [],
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      reorderContext(fromUpcoming, toUpcoming) {
        if (forwardPcRemote("REORDER_CONTEXT", { from: fromUpcoming, to: toUpcoming })) return;
        const s = get();
        const startCtx = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
        const len = Math.max(0, s.contextQueue.length - startCtx);
        if (fromUpcoming < 0 || fromUpcoming >= len) return;
        const target = clamp(toUpcoming, 0, len - 1);
        if (target === fromUpcoming) return;
        const nextCtx = [...s.contextQueue];
        const [moved] = nextCtx.splice(startCtx + fromUpcoming, 1);
        nextCtx.splice(startCtx + target, 0, moved);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: s.contextIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      removeContext(upcomingIdx) {
        if (forwardPcRemote("REMOVE_CONTEXT", upcomingIdx)) return;
        const s = get();
        const startCtx = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
        const abs = startCtx + upcomingIdx;
        if (upcomingIdx < 0 || abs >= s.contextQueue.length) return;
        const nextCtx = s.contextQueue.filter((_, i) => i !== abs);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: Math.min(s.contextIndex, Math.max(0, nextCtx.length - 1)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      clearContextUpcoming() {
        if (forwardPcRemote("clear_upcoming")) return;
        const s = get();
        const cut = s.currentFromPriority ? s.contextIndex : Math.min(s.contextQueue.length, s.contextIndex + 1);
        const nextCtx = s.contextQueue.slice(0, cut);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: Math.min(s.contextIndex, Math.max(0, nextCtx.length - 1)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      moveUpcoming(from, to) {
        if (forwardPcRemote("move_upcoming", { from, to })) return;
        const s = get();
        if (from <= s.index || from >= s.queue.length) return;
        const uFrom = from - s.index - 1;
        const uTo = to - s.index - 1;
        const pLen = s.priorityQueue.length;
        const ctxUpcomingLen = contextUpcomingSlice(s).length;

        if (uFrom < pLen) {
          get().reorderPriority(uFrom, clamp(uTo, 0, pLen - 1));
          return;
        }
        const cFrom = uFrom - pLen;
        if (cFrom < ctxUpcomingLen) {
          get().reorderContext(cFrom, clamp(uTo - pLen, 0, ctxUpcomingLen - 1));
          return;
        }
        const aFrom = cFrom - ctxUpcomingLen;
        if (aFrom >= 0 && aFrom < s.autoplayTracks.length) {
          const aTo = clamp(uTo - pLen - ctxUpcomingLen, 0, s.autoplayTracks.length - 1);
          if (aFrom === aTo) return;
          const nextAuto = [...s.autoplayTracks];
          const [moved] = nextAuto.splice(aFrom, 1);
          nextAuto.splice(aTo, 0, moved);
          set(
            syncDerived({
              history: s.history,
              currentTrack: s.currentTrack,
              currentFromPriority: s.currentFromPriority,
              priorityQueue: s.priorityQueue,
              contextQueue: s.contextQueue,
              contextIndex: s.contextIndex,
              autoplayTracks: nextAuto,
              queue: [],
              index: 0,
              priorityCount: s.priorityQueue.length,
              autoplayCount: nextAuto.length,
            })
          );
        }
      },

      removeAt(i) {
        if (forwardPcRemote("remove_at", i)) return;
        const s = get();
        if (i < 0 || i >= s.queue.length) return;
        if (i === s.index) {
          // Removing currently playing track skips to next or stops cleanly
          if (s.awaitingAutoplay) {
            set({ awaitingAutoplay: false, playing: false });
          } else {
            get().next(true);
          }
          return;
        }
        if (i < s.history.length) {
          const nextHistory = s.history.filter((_, idx) => idx !== i);
          set(
            syncDerived({
              history: nextHistory,
              currentTrack: s.currentTrack,
              currentFromPriority: s.currentFromPriority,
              priorityQueue: s.priorityQueue,
              contextQueue: s.contextQueue,
              contextIndex: s.contextIndex,
              autoplayTracks: s.autoplayTracks,
              queue: [],
              index: 0,
              priorityCount: s.priorityQueue.length,
              autoplayCount: s.autoplayTracks.length,
            })
          );
          return;
        }
        const uIdx = i - s.index - 1;
        if (uIdx < s.priorityQueue.length) {
          get().removePriority(uIdx);
          return;
        }
        const cIdx = uIdx - s.priorityQueue.length;
        const ctxUpcomingLen = contextUpcomingSlice(s).length;
        if (cIdx < ctxUpcomingLen) {
          get().removeContext(cIdx);
          return;
        }
        const aIdx = cIdx - ctxUpcomingLen;
        if (aIdx >= 0 && aIdx < s.autoplayTracks.length) {
          const nextAuto = s.autoplayTracks.filter((_, k) => k !== aIdx);
          set(
            syncDerived({
              history: s.history,
              currentTrack: s.currentTrack,
              currentFromPriority: s.currentFromPriority,
              priorityQueue: s.priorityQueue,
              contextQueue: s.contextQueue,
              contextIndex: s.contextIndex,
              autoplayTracks: nextAuto,
              queue: [],
              index: 0,
              priorityCount: s.priorityQueue.length,
              autoplayCount: nextAuto.length,
            })
          );
        }
      },

      clearUpcoming() {
        if (forwardPcRemote("clear_upcoming")) return;
        const s = get();
        const cut = s.currentFromPriority ? s.contextIndex : Math.min(s.contextQueue.length, s.contextIndex + 1);
        const nextCtx = s.contextQueue.slice(0, cut);
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: [],
            contextQueue: nextCtx,
            contextIndex: Math.min(s.contextIndex, Math.max(0, nextCtx.length - 1)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: s.autoplayTracks.length,
          })
        );
      },

      appendAutoplay(incoming) {
        const s = get();
        const present = new Set([
          ...(s.currentTrack ? [s.currentTrack.id] : []),
          ...s.priorityQueue.map((t) => t.id),
          ...contextUpcomingSlice(s).map((t) => t.id),
          ...s.autoplayTracks.map((t) => t.id),
        ]);
        const tracks = incoming.filter((t) => !present.has(t.id) && present.add(t.id));
        if (!tracks.length) return;

        if (s.awaitingAutoplay) {
          const [first, ...rest] = tracks;
          const history = pushHistory(s.history, s.currentTrack);
          const nextCtx = [...s.contextQueue, first];
          const nextFields = syncDerived({
            history,
            currentTrack: first,
            currentFromPriority: false,
            priorityQueue: s.priorityQueue,
            contextQueue: nextCtx,
            contextIndex: nextCtx.length - 1,
            autoplayTracks: rest,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: rest.length,
          });
          set({
            ...nextFields,
            playing: true,
            position: 0,
            error: null,
            awaitingAutoplay: false,
          });
          return;
        }

        const nextAuto = [...s.autoplayTracks, ...tracks];
        set(
          syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: s.priorityQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            autoplayTracks: nextAuto,
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: nextAuto.length,
          })
        );
      },

      dropAutoplay() {
        const s = get();
        if (!s.autoplayTracks.length && !s.autoplayCount && !s.awaitingAutoplay) return;
        set({
          ...syncDerived({
            history: s.history,
            currentTrack: s.currentTrack,
            currentFromPriority: s.currentFromPriority,
            priorityQueue: s.priorityQueue,
            contextQueue: s.contextQueue,
            contextIndex: s.contextIndex,
            autoplayTracks: [],
            queue: [],
            index: 0,
            priorityCount: s.priorityQueue.length,
            autoplayCount: 0,
          }),
          awaitingAutoplay: false,
          ...(s.awaitingAutoplay ? { playing: false } : {}),
        });
      },

      stopAwaiting() {
        if (get().awaitingAutoplay) set({ awaitingAutoplay: false, playing: false });
      },

      next(manual = false) {
        if (forwardPcRemote("next", manual)) return;
        const s = get();
        if (!s.currentTrack && !s.queue.length) {
          set({ playing: false });
          return;
        }

        // 1. Strict Priority Queue: always play queued songs FIFO before resuming contextQueue!
        if (s.priorityQueue.length > 0) {
          const [nextPriorityTrack, ...remainingPriority] = s.priorityQueue;
          const history = pushHistory(s.history, s.currentTrack);
          // Pause context progression right at the next unread context track
          const pausedContextIndex =
            !s.currentFromPriority && s.contextQueue.length > 0 ? s.contextIndex + 1 : s.contextIndex;
          const nextFields = syncDerived({
            history,
            currentTrack: nextPriorityTrack,
            currentFromPriority: true,
            priorityQueue: remainingPriority,
            contextQueue: s.contextQueue,
            contextIndex: clamp(pausedContextIndex, 0, Math.max(0, s.contextQueue.length)),
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: remainingPriority.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // 2. Priority Queue is empty — advance through Context Queue
        const nextCtxIndex = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
        if (nextCtxIndex < s.contextQueue.length) {
          const nextTrack = s.contextQueue[nextCtxIndex];
          const history = pushHistory(s.history, s.currentTrack);
          const nextFields = syncDerived({
            history,
            currentTrack: nextTrack,
            currentFromPriority: false,
            priorityQueue: [],
            contextQueue: s.contextQueue,
            contextIndex: nextCtxIndex,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // 3. AutoPlay tail tracks already preloaded
        if (s.autoplayTracks.length > 0) {
          const [nextAuto, ...remainingAuto] = s.autoplayTracks;
          const history = pushHistory(s.history, s.currentTrack);
          const nextCtx = [...s.contextQueue, nextAuto];
          const nextFields = syncDerived({
            history,
            currentTrack: nextAuto,
            currentFromPriority: false,
            priorityQueue: [],
            contextQueue: nextCtx,
            contextIndex: nextCtx.length - 1,
            autoplayTracks: remainingAuto,
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: remainingAuto.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // 4. Repeat All wraps cleanly around Context Queue (without any popped one-shot priority tracks)
        if (s.repeat === "all" && s.contextQueue.length > 0) {
          const wrappedCtx = s.shuffle ? nextPass(s.contextQueue) : s.contextQueue;
          const history = pushHistory(s.history, s.currentTrack);
          const nextFields = syncDerived({
            history,
            currentTrack: wrappedCtx[0],
            currentFromPriority: false,
            priorityQueue: [],
            contextQueue: wrappedCtx,
            contextIndex: 0,
            autoplayTracks: [],
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: 0,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }

        // 5. End of queue: trigger AutoPlay seed or stop cleanly
        const seedTrack = s.contextQueue[s.contextQueue.length - 1] ?? s.currentTrack ?? undefined;
        if (autoplayContinues(seedTrack, s.repeat)) {
          set({ awaitingAutoplay: true });
          return;
        }

        if (!manual) {
          set({ playing: false, position: 0 });
          return;
        }

        // Manual next wrap if playlist still has context songs
        if (s.contextQueue.length > 0) {
          const wrappedCtx = s.shuffle ? nextPass(s.contextQueue) : s.contextQueue;
          const history = pushHistory(s.history, s.currentTrack);
          const nextFields = syncDerived({
            history,
            currentTrack: wrappedCtx[0],
            currentFromPriority: false,
            priorityQueue: [],
            contextQueue: wrappedCtx,
            contextIndex: 0,
            autoplayTracks: [],
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: 0,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
        } else {
          set({ playing: false, position: 0 });
        }
      },

      finishBlend(id, position) {
        const s = get();
        if (upNext(s)?.id !== id) return false;
        get().next(false);
        set({ position, blendInto: null });
        return true;
      },

      prev() {
        if (forwardPcRemote("prev")) return;
        const s = get();
        if (s.position > 3) {
          set({ position: 0, seekNonce: s.seekNonce + 1 });
          return;
        }
        if (s.history.length > 0) {
          const prevTrack = s.history[s.history.length - 1];
          const remainingHistory = s.history.slice(0, -1);
          // If current track was a priority track, put it back at the head of priorityQueue so nothing is lost
          const nextPriority = s.currentFromPriority && s.currentTrack
            ? [s.currentTrack, ...s.priorityQueue]
            : s.priorityQueue;
          let nextCtxIdx = s.contextIndex;
          let prevFromPriority = false;
          if (!s.currentFromPriority && s.contextIndex > 0 && s.contextQueue[s.contextIndex - 1]?.id === prevTrack.id) {
            nextCtxIdx = s.contextIndex - 1;
          } else {
            prevFromPriority = true;
          }
          const nextFields = syncDerived({
            history: remainingHistory,
            currentTrack: prevTrack,
            currentFromPriority: prevFromPriority,
            priorityQueue: nextPriority,
            contextQueue: s.contextQueue,
            contextIndex: nextCtxIdx,
            autoplayTracks: s.autoplayTracks,
            queue: [],
            index: 0,
            priorityCount: nextPriority.length,
            autoplayCount: s.autoplayTracks.length,
          });
          set({ ...nextFields, playing: true, position: 0, error: null, awaitingAutoplay: false });
          return;
        }
        set({ position: 0, seekNonce: s.seekNonce + 1 });
      },

      toggle() {
        if (forwardPcRemote("toggle")) return;
        const s = get();
        if (!s.currentTrack && !s.queue.length) return;
        const playing = !s.playing;
        set(playing ? { playing } : { playing, awaitingAutoplay: false });
      },

      setPlaying(playing) {
        if (forwardPcRemote(playing ? "play" : "pause")) return;
        const s = get();
        if (playing && !s.currentTrack && !s.queue.length) return;
        set(playing ? { playing } : { playing, awaitingAutoplay: false });
      },

      seek(sec) {
        if (forwardPcRemote("seek", sec)) return;
        const { duration } = get();
        set({
          position: clamp(sec, 0, duration > 0 ? duration : sec),
          seekNonce: get().seekNonce + 1,
        });
      },

      setVolume(v) {
        if (forwardPcRemote("set_volume", clamp(v, 0, 1))) return;
        set({ volume: clamp(v, 0, 1), muted: false });
      },

      toggleMute() {
        if (forwardPcRemote("toggle_mute")) return;
        set({ muted: !get().muted });
      },

      toggleShuffle() {
        if (forwardPcRemote("toggle_shuffle")) return;
        const s = get();
        if (!s.shuffle) {
          // Shuffle ONLY upcoming contextQueue songs; keep user priorityQueue order untouched!
          const startCtx = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
          const anchor = Math.max(0, startCtx - 1);
          const nextCtx = shuffleTail(s.contextQueue, anchor);
          set({
            ...syncDerived({
              history: s.history,
              currentTrack: s.currentTrack,
              currentFromPriority: s.currentFromPriority,
              priorityQueue: s.priorityQueue,
              contextQueue: nextCtx,
              contextIndex: s.contextIndex,
              autoplayTracks: s.autoplayTracks,
              queue: [],
              index: 0,
              priorityCount: s.priorityQueue.length,
              autoplayCount: s.autoplayTracks.length,
            }),
            shuffle: true,
            unshuffled: s.contextQueue.length ? orderFrom(s.contextQueue, clamp(s.contextIndex, 0, s.contextQueue.length - 1)) : null,
          });
        } else {
          const startCtx = s.currentFromPriority ? s.contextIndex : s.contextIndex + 1;
          const anchor = Math.max(0, startCtx - 1);
          const nextCtx = restoreOrderFromCycle(s.contextQueue, anchor, s.unshuffled ?? []);
          set({
            ...syncDerived({
              history: s.history,
              currentTrack: s.currentTrack,
              currentFromPriority: s.currentFromPriority,
              priorityQueue: s.priorityQueue,
              contextQueue: nextCtx,
              contextIndex: s.contextIndex,
              autoplayTracks: s.autoplayTracks,
              queue: [],
              index: 0,
              priorityCount: s.priorityQueue.length,
              autoplayCount: s.autoplayTracks.length,
            }),
            shuffle: false,
            unshuffled: null,
          });
        }
      },

      cycleRepeat() {
        if (forwardPcRemote("cycle_repeat")) return;
        const order: RepeatMode[] = ["off", "all", "one"];
        set({ repeat: order[(order.indexOf(get().repeat) + 1) % order.length] });
      },

      _setTime(position, duration) {
        const d = Number.isFinite(duration) && (duration ?? 0) > 0 ? (duration as number) : get().duration;
        set({ position, duration: d });
      },

      _setBuffered(buffered) {
        if (Math.abs(get().buffered - buffered) > 0.005) set({ buffered });
      },

      _setBuffering(buffering) {
        const cur = get();
        const nextStatus: PlaybackStatus = buffering
          ? cur.playbackStatus === "loading"
            ? "loading"
            : "buffering"
          : cur.playing
            ? "playing"
            : "idle";
        set({ buffering, playbackStatus: nextStatus });
      },

      _setPlaybackStatus(playbackStatus) {
        set({ playbackStatus });
      },

      _setError(error) {
        set(error ? { error, playbackStatus: "error" } : { error: null });
      },
    }),
    {
      name: "player",
      storage: coalescedStorage,
      partialize: (s) =>
        ({
          history: s.history,
          currentTrack: s.currentTrack,
          currentFromPriority: s.currentFromPriority,
          priorityQueue: s.priorityQueue,
          contextQueue: s.contextQueue,
          contextIndex: s.contextIndex,
          autoplayTracks: s.autoplayTracks,
          queue: s.queue,
          index: s.index,
          priorityCount: s.priorityCount,
          autoplayCount: s.autoplayCount,
          position: s.position,
          volume: s.volume,
          muted: s.muted,
          shuffle: s.shuffle,
          repeat: s.repeat,
          unshuffled: s.unshuffled,
          playingFrom: s.playingFrom,
        }) as unknown as PlayerState,
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<PlayerState>;
        const s = { ...current, ...p };
        // Migrate legacy flat persisted queue into dual-layer model seamlessly
        if (!Array.isArray(p.contextQueue) && Array.isArray(p.queue) && p.queue.length > 0) {
          const idx = clamp(p.index ?? 0, 0, p.queue.length - 1);
          const autoTail = Math.max(0, Math.min(p.autoplayCount ?? 0, p.queue.length - idx - 1));
          const history = p.queue.slice(0, idx).slice(-HISTORY_KEEP);
          const currentTrack = p.queue[idx] ?? null;
          const contextQueue = p.queue.slice(idx, p.queue.length - autoTail);
          const autoplayTracks = p.queue.slice(p.queue.length - autoTail);
          return {
            ...s,
            ...syncDerived({
              history,
              currentTrack,
              currentFromPriority: false,
              priorityQueue: [],
              contextQueue,
              contextIndex: 0,
              autoplayTracks,
              queue: [],
              index: 0,
              priorityCount: 0,
              autoplayCount: autoplayTracks.length,
            }),
          };
        }
        return {
          ...s,
          ...syncDerived({
            history: Array.isArray(s.history) ? s.history : [],
            currentTrack: s.currentTrack ?? null,
            currentFromPriority: Boolean(s.currentFromPriority),
            priorityQueue: Array.isArray(s.priorityQueue) ? s.priorityQueue : [],
            contextQueue: Array.isArray(s.contextQueue) ? s.contextQueue : [],
            contextIndex: s.contextIndex ?? 0,
            autoplayTracks: Array.isArray(s.autoplayTracks) ? s.autoplayTracks : [],
            queue: [],
            index: 0,
            priorityCount: 0,
            autoplayCount: 0,
          }),
        };
      },
    }
  )
);

// Clear playingFrom when playback enters AutoPlay suggestions
usePlayer.subscribe((s) => {
  if (s.playingFrom !== null && s.contextIndex >= s.contextQueue.length && s.currentTrack && !s.currentFromPriority) {
    usePlayer.setState({ playingFrom: null });
  }
});

/** The sidebar row to mark as playing: where the queue started, while it plays. */
export function playingFromRow(s: { playing: boolean; playingFrom: string | null }): string | null {
  return s.playing ? s.playingFrom : null;
}

/** How a song is doing right now — "playing", "paused" or null. */
export function useTrackPlayback(id: string): "playing" | "paused" | null {
  return usePlayer((s) => {
    const cur = s.currentTrack ?? s.queue[s.index];
    return cur?.id === id ? (s.playing ? "playing" : "paused") : null;
  });
}
