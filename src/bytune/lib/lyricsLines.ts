import type { SyncedLyricLine, SyncedLyricWord } from "../types";

/**
 * Known speaker/artist label prefixes emitted at the start of synced lyric lines
 * (e.g. `Taylor Swift:`, `[Justin Bieber]:`, `(Duet):`, `v1:`).
 * Carefully avoids stripping ordinary lowercase sentences or clock timestamps (`12:30`).
 */
const BRACKET_SPEAKER_RE = /^\s*(?:\[[^\]\n]{1,42}\]|\([^)\n]{1,42}\))\s*[:：]\s+(?=\S)/;
const STAGE_SPEAKER_RE =
  /^\s*(?:v\d{1,3}|chorus|verse\s*\d*|bridge|intro|outro|pre-chorus|hook|refrain|all|both|duet|ensemble|choir|male|female|man|woman|singer\s*\d*|vocal\s*\d*|guest)\s*[:：]\s+(?=\S)/i;
const ARTIST_SPEAKER_RE =
  /^\s*[A-Z][\p{L}\p{N}.'’&+\-, ]{0,38}\s*[:：]\s+(?=\S)/u;

/** Strip leading singer/speaker/artist prefixes from a single lyric line. */
export function stripSingerPrefix(raw: string, trackArtist?: string): string {
  const text = raw.trim();
  if (!text) return "";

  if (BRACKET_SPEAKER_RE.test(text)) {
    const stripped = text.replace(BRACKET_SPEAKER_RE, "").trim();
    if (stripped) return stripped;
  }

  if (STAGE_SPEAKER_RE.test(text)) {
    const stripped = text.replace(STAGE_SPEAKER_RE, "").trim();
    if (stripped) return stripped;
  }

  const colonIdx = text.search(/[:：]\s+\S/);
  if (colonIdx > 0 && colonIdx <= 42) {
    const candidatePrefix = text.slice(0, colonIdx).trim();
    // Skip timestamps or numeric counters like "12:30 PM"
    if (!/^\d+$/.test(candidatePrefix)) {
      const rest = text.slice(colonIdx + 1).trim();
      const artistLow = trackArtist?.toLowerCase() ?? "";
      const prefixLow = candidatePrefix.toLowerCase();
      const matchesArtist =
        artistLow.length > 0 &&
        (artistLow.includes(prefixLow) ||
          prefixLow.split(/[,&+/]/).some((part) => {
            const p = part.trim();
            return p.length >= 2 && artistLow.includes(p);
          }));
      if (matchesArtist || ARTIST_SPEAKER_RE.test(text)) {
        if (rest) return rest;
      }
    }
  }

  return text;
}

function trimWordsPrefix(words: SyncedLyricWord[] | undefined, original: string, cleaned: string): SyncedLyricWord[] | undefined {
  if (!words || words.length === 0 || cleaned === original.trim()) return words;
  const removedLen = original.trim().length - cleaned.length;
  if (removedLen <= 0) return words;

  // Rebuild remaining word list by advancing past the removed prefix characters.
  let consumed = 0;
  const out: SyncedLyricWord[] = [];
  for (const w of words) {
    if (consumed >= removedLen) {
      out.push(w);
      continue;
    }
    const token = w.text.trim();
    if (consumed + token.length <= removedLen) {
      consumed += token.length + 1; // +1 accounts for space separator
      continue;
    }
    const sliceOffset = removedLen - consumed;
    const remainder = token.slice(sliceOffset).trim();
    consumed = removedLen;
    if (remainder) {
      out.push({ ...w, text: remainder });
    }
  }
  return out.length > 0 ? out : undefined;
}

/** Mobile helper: remove leading singer/artist prefixes from lines and aligned word tokens. */
export function cleanMobileLyricLines(
  lines: SyncedLyricLine[],
  isMobile: boolean,
  trackArtist?: string
): SyncedLyricLine[] {
  if (!isMobile || lines.length === 0) return lines;
  let changed = false;
  const out: SyncedLyricLine[] = [];
  for (const line of lines) {
    if (line.gap || !line.text) {
      out.push(line);
      continue;
    }
    const cleaned = stripSingerPrefix(line.text, trackArtist);
    if (cleaned !== line.text.trim()) {
      changed = true;
      const words = trimWordsPrefix(line.words, line.text, cleaned);
      out.push({
        ...line,
        text: cleaned,
        words,
      });
    } else {
      out.push(line);
    }
  }
  return changed ? out : lines;
}

/**
 * The synced lines worth showing. Providers attach backing-vocal / credit
 * lines wrapped in parentheses (or stamped 0:00) at the head of the song —
 * they render as phantom lyrics before the first real line, so they're
 * dropped there; later in the song a "(…)" line is a real lyric. A line that
 * is only a [label] ("[Chorus]") is a section heading and goes anywhere.
 * Instrumental gap markers always stay.
 */
export function visibleLyricLines(synced: SyncedLyricLine[]): SyncedLyricLine[] {
  const first = synced.findIndex((l) => !l.gap && !!l.text && !/^[[(]/.test(l.text.trim()) && l.time > 0);
  const head = first < 0 ? synced.length : first;
  return synced.filter((l, i) => l.gap || (!!l.text && i >= head && !/^\[[^\]]*\]$/.test(l.text.trim())));
}
