import type { SyncedLyricLine, SyncedLyricWord } from "../types";

export interface WordSpan {
  start: number;
  end: number;
}

export const ACTIVE_LINE_LEAD_SEC = 0.38;
export const LYRICS_LINE_CHUNK_SIZE = 20;

/**
 * Compute the index of the active lyric line for a given playback position and user offset.
 * Uses a 0.38s anticipation lead so scroll glide and highlight align right on vocal onset.
 */
export function computeActiveLyricIndex(
  lines: Array<{ time: number }> | null,
  position: number,
  offset: number
): number {
  if (!lines || lines.length === 0) return -1;
  const lyricPos = position - offset + ACTIVE_LINE_LEAD_SEC;
  let lo = 0;
  let hi = lines.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lines[mid].time <= lyricPos) {
      idx = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  if (idx === -1 && position >= 0) return 0;
  return idx;
}

/**
 * Natural vocal sweep easing: crisp attack at word/syllable onset followed by
 * smooth hold across sustained vowels so highlights move with the melody rather
 * than ticking mechanically.
 */
export function easeMelodyProgress(raw: number): number {
  if (raw <= 0) return 0;
  if (raw >= 1) return 1;
  // Blend ease-out attack with smooth cubic tail
  const eased = 1 - Math.pow(1 - raw, 1.35);
  return Math.min(1, Math.max(0, eased));
}

/**
 * Repair per-word timings within `[t0, t1]` while preserving valid provider timestamps
 * instead of discarding an entire line if a single backing-vocal or zero-length word sits off-range.
 */
export function resolveWordSpans(
  words: SyncedLyricWord[],
  t0: number,
  t1: number
): WordSpan[] {
  const n = words.length;
  if (n === 0) return [];
  const total = Math.max(0.25, t1 - t0);

  let cursor = t0;
  return words.map((w, i) => {
    const fallbackStart = t0 + (total * i) / n;
    const fallbackEnd = t0 + (total * (i + 1)) / n;
    const inBounds =
      Number.isFinite(w.start) &&
      Number.isFinite(w.end) &&
      w.end > w.start &&
      w.start >= t0 - 0.35 &&
      w.end <= t1 + 0.65;

    let start = inBounds ? Math.max(cursor, w.start) : Math.max(cursor, fallbackStart);
    let end = inBounds ? Math.min(t1, Math.max(start + 0.04, w.end)) : Math.max(start + 0.04, fallbackEnd);

    if (start >= t1) {
      start = Math.max(t0, t1 - 0.04 * (n - i));
      end = Math.min(t1, start + 0.04);
    }
    cursor = Math.min(t1, end);
    return { start, end: Math.max(start + 0.03, end) };
  });
}

const CJK_CHAR_RE = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

function tokenizeLineText(text: string): { tokens: string[]; spaced: boolean } {
  const trimmed = text.trim();
  if (!trimmed) return { tokens: [], spaced: true };
  if (/\s/.test(trimmed)) {
    return { tokens: trimmed.split(/\s+/).filter(Boolean), spaced: true };
  }
  // CJK or unspaced lines: split per character so each syllable/glyph sweeps in time.
  const chars = [...trimmed];
  if (chars.some((ch) => CJK_CHAR_RE.test(ch)) && chars.length > 1) {
    return { tokens: chars, spaced: false };
  }
  return { tokens: [trimmed], spaced: true };
}

function tokenWeight(tok: string): number {
  const letters = tok.replace(/[\p{P}\p{S}]+/gu, "");
  // Syllable / vowel-nucleus heuristic mirrors melodic note duration better than raw char count.
  const vowelClusters = letters.match(/[aeiouyáéíóúàèìòùâêîôûäëïöüãõ]+/gi)?.length ?? 0;
  const sustainedTail = /[aeiouyhmng]{2,}$/i.test(letters) ? 0.55 : 0;
  const base = Math.max(1, letters.length * 0.65 + vowelClusters * 0.9 + sustainedTail);
  // Words followed by a comma, semicolon, or terminal punctuation hold longer on phrasing ends.
  const pauseBonus = /[,;，、]$/.test(tok) ? 0.75 : /[.!?。！？…]$/.test(tok) ? 1.15 : 0;
  return base + pauseBonus;
}

/**
 * Derive melody-matched word spans across `[line.time, t1]` for line-synced lyrics
 * using syllable density, sustained-vowel weighting, and natural phrase tails.
 */
export function buildLineWordModel(
  line: SyncedLyricLine,
  nextTime?: number
): { words: SyncedLyricWord[]; spans: WordSpan[]; spaced: boolean } {
  if (line.words && line.words.length > 0) {
    let t1 = line.end && line.end > line.time ? line.end : (nextTime ?? line.time + 4);
    if (nextTime !== undefined && nextTime > line.time) {
      t1 = Math.min(nextTime, Math.max(t1, line.time + 0.8));
    }
    const lastEnd = line.words[line.words.length - 1].end;
    if (lastEnd > line.time) t1 = Math.max(t1, Math.min(nextTime ?? lastEnd + 0.5, lastEnd));
    if (t1 <= line.time) t1 = line.time + 3;
    const spans = resolveWordSpans(line.words, line.time, t1);
    return { words: line.words, spans, spaced: true };
  }

  const { tokens, spaced } = tokenizeLineText(line.text);
  if (tokens.length === 0) return { words: [], spans: [], spaced };

  const estimatedDur = Math.min(5.6, Math.max(1.05, tokens.length * 0.34 + line.text.length * 0.04));
  let t1 = line.end && line.end > line.time ? line.end : (nextTime ?? line.time + estimatedDur);
  if (nextTime !== undefined && nextTime > line.time) {
    const gap = nextTime - line.time;
    // Track natural vocal phrasing: trim long silent tails (>4.5s) before big gaps, while
    // keeping standard 1–4.5s phrase windows flowing smoothly right to the next line.
    t1 = gap > 4.5
      ? Math.min(nextTime - 0.32, line.time + Math.max(estimatedDur, gap * 0.66))
      : nextTime;
  }
  const duration = Math.max(0.4, t1 - line.time);
  const weights = tokens.map(tokenWeight);
  const totalWeight = weights.reduce((sum, w) => sum + w, 0) || tokens.length;

  let acc = line.time;
  const words: SyncedLyricWord[] = [];
  const spans: WordSpan[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const share = (weights[i] / totalWeight) * duration;
    const start = acc;
    const end = i === tokens.length - 1 ? line.time + duration : start + share;
    acc = end;
    words.push({ start, end, text: tokens[i] });
    spans.push({ start, end });
  }
  return { words, spans, spaced };
}
