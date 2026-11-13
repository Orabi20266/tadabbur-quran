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
 * Letters the recogniser cannot reliably tell apart. The browser engine is
 * trained on modern standard Arabic, not on Quranic recitation, so it regu-
 * larly writes ق as ك, ص as س, ض as ظ and ط as ت. Two letters in one group are
 * a small alignment penalty, not proof that the reader said a different word.
 */
const PHONETIC_GROUP: Record<string, string> = {
  '\u0642': 'k', // ق
  '\u0643': 'k', // ك
  '\u0635': 's', // ص
  '\u0633': 's', // س
  '\u062b': 's', // ث
  '\u0636': 'd', // ض
  '\u0638': 'd', // ظ
  '\u0630': 'd', // ذ
  '\u0632': 'd', // ز
  '\u0637': 't', // ط
  '\u062a': 't', // ت
};

const LONG_VOWEL = new Set(['\u0627', '\u0648', '\u064a']);

/** Cost of writing `a` where `b` was expected. */
function replaceCost(a: string, b: string): number {
  if (a === b) return 0;
  const ga = PHONETIC_GROUP[a];
  const gb = PHONETIC_GROUP[b];
  if (ga && ga === gb) return 0.25;
  return 1;
}

function vowelCost(ch: string): number {
  return LONG_VOWEL.has(ch) ? 0.5 : 1;
}

/**
 * Edit distance in which a long-vowel letter (ا/و/ي) can be added or dropped
 * for half price, and a known recogniser confusion costs a quarter. The
 * Uthmani text and the recogniser disagree about long vowels constantly
 * («الرحمن» / «الرحمان»), so those differences must not break the cursor.
 */
export function weightedLevenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return [...b].reduce((sum, ch) => sum + vowelCost(ch), 0);
  if (!b.length) return [...a].reduce((sum, ch) => sum + vowelCost(ch), 0);

  let prev = [0];
  for (let j = 1; j <= b.length; j++) prev[j] = prev[j - 1] + vowelCost(b[j - 1]);

  for (let i = 1; i <= a.length; i++) {
    const row = [prev[0] + vowelCost(a[i - 1])];
    for (let j = 1; j <= b.length; j++) {
      row[j] = Math.min(
        prev[j] + vowelCost(a[i - 1]),
        row[j - 1] + vowelCost(b[j - 1]),
        prev[j - 1] + replaceCost(a[i - 1], b[j - 1]),
      );
    }
    prev = row;
  }
  return prev[b.length];
}

/** Similarity using the recognition-aware edit distance, 0..1. */
export function phoneticSimilarity(a: string, b: string): number {
  if (a === b) return 1;
  const longest = Math.max(a.length, b.length);
  if (!longest) return 1;
  return 1 - weightedLevenshtein(a, b) / longest;
}

/**
 * Attached particles the recogniser treats as separate or drops altogether.
 * «وَكَأۡسٗا» is heard as «وكأس» or plain «كأس», and «وَلَمۡ» as «لم». The mushaf
 * writes them joined, so a leading و/ف/ب/ل/ك is alignment noise, not a mistake.
 */
const JOINING_PARTICLE = new Set(['\u0648', '\u0641', '\u0628', '\u0644', '\u0643']);

/**
 * Score one heard token against one expected word. Short particles need a
 * closer match than long words, but a single recogniser confusion (or a long
 * vowel the engine added) is still accepted: refusing those made ordinary
 * recitation look wrong.
 */
export function wordScore(heard: string, expected: string): number {
  if (!heard || !expected) return 0;
  if (heard === expected) return 1;

  const direct = scorePair(heard, expected);
  if (direct > 0) return direct;

  const assimilated = assimilationScore(heard, expected);
  if (assimilated > 0) return assimilated;

  // A dropped or extra attached particle: «كأس» for «وكأسا». Only for
  // words long enough that the particle is not the whole meaning: dropping the
  // و of «ولم» or «وما» makes another real word, so those stay strict.
  if (heard[0] !== expected[0]) {
    let best = 0;
    if (JOINING_PARTICLE.has(expected[0]) && expected.length >= 5) {
      best = Math.max(best, scorePair(heard, expected.slice(1)));
    }
    if (JOINING_PARTICLE.has(heard[0]) && heard.length >= 5) {
      best = Math.max(best, scorePair(heard.slice(1), expected));
    }
    return best;
  }
  return 0;
}

/**
 * Noon sakinah and tanween are not pronounced as a plain noon: idgham and
 * iqlab turn the final ن into the following letter («مِن رَّبِّكَ» → «مر ربك»)
 * or into م. The reader is right; the recogniser just wrote the assimilated
 * sound. Only the final letter may differ, and only to an idgham target, so a
 * genuinely different word is still rejected.
 */
const IDGHAM_TARGETS = new Set(['\u0645', '\u0631', '\u0644', '\u0648', '\u064a', '\u0646']);

function assimilationScore(heard: string, expected: string): number {
  if (heard.length !== expected.length || expected.length < 2) return 0;
  if (expected[expected.length - 1] !== '\u0646') return 0;
  if (heard[heard.length - 1] === '\u0646') return 0;
  if (!IDGHAM_TARGETS.has(heard[heard.length - 1])) return 0;
  return heard.slice(0, -1) === expected.slice(0, -1) ? 0.9 : 0;
}

/**
 * Compare two token skeletons. The first letter must agree (up to a known
 * confusion) so a stutter or a different word cannot slip through on length
 * alone.
 */
function scorePair(heard: string, expected: string): number {
  if (heard === expected) return 1;
  const longest = Math.max(heard.length, expected.length);
  if (longest <= 1) return 0;
  const first = heard[0];
  const want = expected[0];
  if (
    first !== want &&
    !(PHONETIC_GROUP[first] && PHONETIC_GROUP[first] === PHONETIC_GROUP[want])
  ) {
    return 0;
  }
  const score = phoneticSimilarity(heard, expected);
  if (longest === 2) return score >= 0.8 ? score : 0;
  return score >= 0.78 ? score : 0;
}

export interface WordMatch {
  /** How many expected words this token covers (recognisers sometimes merge). */
  span: number;
  score: number;
}

/** Match a token against the expected words starting at `expected[0]`. */
export function matchAt(
  token: string,
  expected: string[],
  strict = false,
): WordMatch | null {
  if (!token || expected.length === 0) return null;

  const single = strict
    ? token === expected[0]
      ? 1
      : 0
    : wordScore(token, expected[0]);
  let best: WordMatch | null = single > 0 ? { span: 1, score: single } : null;

  for (let span = 2; span <= 3 && span <= expected.length; span++) {
    const joined = expected.slice(0, span).join('');
    if (token === joined) return { span, score: 1 };
    // Only trust a fuzzy merged match when the token is clearly longer than a
    // single word, otherwise we would skip words on ordinary noisy matches.
    if (!strict && token.length >= 5) {
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
    // Skipping ahead must never be based on a fuzzy guess: only a later word
    // written exactly like the heard token may move the cursor over a gap.
    const match = matchAt(token, expected.slice(at), offset > 0);
    if (!match) continue;
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
    if (!match || match.score < 0.95) continue;
    return { kind: 'rewind', offset: back - cursor, span: match.span, score: match.score };
  }

  return none;
}
