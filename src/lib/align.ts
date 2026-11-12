import { normalizeArabic } from './quran';

/**
 * Forced alignment between the words a speech recogniser heard and the words we
 * expect from the mushaf. Everything here is pure so the matching rules can be
 * tested without a microphone or a browser.
 */

/** Normalise one recognised token; it never contains spaces. */
export function normalizeToken(raw: string): string {
  return normalizeArabic(raw).replace(/[^\u0621-\u064A]/g, '');
}

/**
 * Turn a recogniser transcript into comparable Arabic tokens.
 * Splitting happens before normalisation because `normalizeArabic` removes
 * whitespace (it is normally called on a single word).
 */
export function tokenizeTranscript(text: string): string[] {
  return text
    .split(/\s+/)
    .map(normalizeToken)
    .filter((token) => token.length > 0);
}

/**
 * Split a transcript without discarding diacritics, so an engine that reports
 * harakat can be checked for vowel mistakes. Alignment normalises later.
 */
export function splitTranscript(text: string): string[] {
  return text
    .split(/\s+/)
    .map((token) =>
      token.replace(/[^\u0621-\u064A\u064B-\u065F\u0670\u06D6-\u06ED]/g, ''),
    )
    .filter((token) => token.length > 0);
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + 1,
        row[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - levenshtein(a, b) / longest;
}

/**
 * Score one heard token against one expected word. Short particles must match
 * exactly: one letter of noise in a two-letter word changes its meaning.
 */
export function wordScore(heard: string, expected: string): number {
  if (!heard || !expected) return 0;
  if (heard === expected) return 1;
  if (heard.length < 3 || expected.length < 3) return 0;
  const score = similarity(heard, expected);
  return score >= 0.72 ? score : 0;
}

export interface WordMatch {
  /** How many expected words this token covers (recognisers sometimes merge). */
  span: number;
  score: number;
}

/** Match a token against the expected words starting at `expected[0]`. */
export function matchAt(token: string, expected: string[]): WordMatch | null {
  if (!token || expected.length === 0) return null;

  const single = wordScore(token, expected[0]);
  let best: WordMatch | null = single > 0 ? { span: 1, score: single } : null;

  for (let span = 2; span <= 3 && span <= expected.length; span++) {
    const joined = expected.slice(0, span).join('');
    if (token === joined) return { span, score: 1 };
    // Only trust a fuzzy merged match when the token is clearly longer than a
    // single word, otherwise we would skip words on ordinary noisy matches.
    if (token.length >= 5) {
      const score = similarity(token, joined);
      if (score >= 0.85 && (!best || score > best.score)) {
        best = { span, score };
      }
    }
  }

  return best;
}

export type AlignmentKind = 'match' | 'repeat' | 'rewind' | 'none';

export interface Alignment {
  kind: AlignmentKind;
  /** Words to skip before the match (0 = the word we are waiting for). */
  offset: number;
  /** Expected words covered by this token. */
  span: number;
  score: number;
}

export interface AlignOptions {
  /** How far ahead to look for a skipped word. */
  lookAhead?: number;
  /** How far back to look for a stutter/repetition that should be ignored. */
  lookBack?: number;
  /** How far back to look for a deliberate restart after a pause. */
  maxRewind?: number;
}

/**
 * Decide what one heard token means relative to the current cursor.
 *
 * Exact matches win over fuzzy ones, then the earliest position wins. A token
 * that only repeats a recently recited word is ignored, so a stutter does not
 * get recorded as a mistake. A token that matches a word further back is a
 * candidate for a deliberate restart (rewind); the tracker confirms it with the
 * following token before moving the cursor.
 */
export function alignToken(
  token: string,
  expected: string[],
  cursor: number,
  opts: AlignOptions = {},
): Alignment {
  const lookAhead = opts.lookAhead ?? 4;
  const lookBack = opts.lookBack ?? 2;
  const maxRewind = opts.maxRewind ?? 30;
  const none: Alignment = { kind: 'none', offset: 0, span: 0, score: 0 };

  if (!token || cursor >= expected.length) return none;

  let best: Alignment | null = null;
  let bestRank = Number.POSITIVE_INFINITY;

  for (let offset = 0; offset <= lookAhead; offset++) {
    const at = cursor + offset;
    if (at >= expected.length) break;
    const match = matchAt(token, expected.slice(at));
    if (!match) continue;
    // Never jump a word on a fuzzy guess: only an exact later word may skip.
    if (offset > 0 && match.score < 0.99) continue;
    const rank = (match.score >= 1 ? 0 : 100) + offset;
    if (rank < bestRank) {
      bestRank = rank;
      best = { kind: 'match', offset, span: match.span, score: match.score };
    }
  }

  if (best) return best;

  // An immediate stutter is not a restart: ignore it quietly.
  const repeatFloor = Math.max(0, cursor - lookBack);
  for (let back = cursor - 1; back >= repeatFloor; back--) {
    if (wordScore(token, expected[back]) >= 0.99) {
      return { kind: 'repeat', offset: back - cursor, span: 1, score: 1 };
    }
  }

  // Further back: the reader may have stopped and started again from an
  // earlier word. Return the nearest exact-ish match; the tracker waits for a
  // second consecutive token before committing to the rewind.
  const rewindFloor = Math.max(0, cursor - maxRewind);
  for (let back = repeatFloor - 1; back >= rewindFloor; back--) {
    const match = matchAt(token, expected.slice(back));
    if (!match || match.score < 0.9) continue;
    return { kind: 'rewind', offset: back - cursor, span: match.span, score: match.score };
  }

  return none;
}
