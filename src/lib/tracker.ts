import {
  alignToken,
  matchAt,
  normalizeToken,
  phoneticSimilarity,
  wordScore,
} from './align';
import {
  muqattaahAt,
  readLetterRun,
  readLetterSpelling,
  spokenPhrases,
} from './muqattaat';
import { tashkeelDiffers } from './quran';
import type { DetectorWord, EventType } from './types';

export interface TrackerMeta {
  recitedText?: string;
  confidence?: number;
}

/**
 * What a reader says before the first word of a session: the isti'adha, the
 * basmalah, or both. They are not part of the page being tracked, so hearing
 * them must not be recorded as a mistake at the first word.
 */
const PREAMBLES: string[][] = [
  ['بسم', 'الله', 'الرحمن', 'الرحيم'],
  ['اعوذ', 'بالله'],
  ['اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم'],
  ['اعوذ', 'بالله', 'السميع', 'العليم', 'من', 'الشيطان', 'الرجيم'],
  ['اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم', 'بسم', 'الله', 'الرحمن', 'الرحيم'],
  [
    'اعوذ',
    'بالله',
    'السميع',
    'العليم',
    'من',
    'الشيطان',
    'الرجيم',
    'بسم',
    'الله',
    'الرحمن',
    'الرحيم',
  ],
];

/**
 * Sounds a recogniser reports when it hears a breath or a hesitation. They are
 * not Quranic words, but ignoring them must never swallow a word that is
 * actually being tracked (checked against the expected word before ignoring).
 */
const FILLERS = new Set([
  'اه',
  'ااه',
  'اااه',
  'امم',
  'هم',
  'همم',
  'مم',
  'ايه',
  'اها',
  'يعني',
  'طيب',
  'اوكيه',
  'اوكي',
]);

/** Compare preamble words without long vowels, so «باسم»/«الرحمان» still count. */
function looseSame(heard: string, expected: string): boolean {
  const skeleton = (word: string) => word.replace(/[اوىيء]/g, '');
  return heard === expected || skeleton(heard) === skeleton(expected);
}

export interface TranscriptTrackerConfig {  words: DetectorWord[];
  /** Normalised text of every word, same order and length as `words`. */
  normalized: string[];
  /** Fully diacritized text of every word, same order as `normalized`. */
  diacritized: string[];
  detectMistakes: boolean;
  /**
   * Compare harakat whenever the recogniser supplies diacritized tokens.
   * Undiacritized tokens are never guessed at.
   */
  detectTashkeel: boolean;
  dontProgressUntilFixed: boolean;
  /**
   * Quran-only conventions. Hadith recitation has no isti'adha/basmalah and no
   * disconnected letters; leave these on for the Quran and turn them off for
   * other passages. Both default to true so existing callers are unchanged.
   */
  detectPreamble?: boolean;
  detectMuqattaat?: boolean;
  onEvent: (word: DetectorWord, type: EventType, meta?: TrackerMeta) => void;
  onBlocked: (blocked: boolean) => void;
  onDone: () => void;
  onCursor: (index: number) => void;
}

/**
 * Advances through the expected words using recognised speech tokens.
 *
 * The cursor never moves on time or on silence. A token that matches the next
 * expected word advances it; a token that matches a later word is treated as a
 * skipped word; anything else is a wrong attempt at the current word (recorded
 * once) and does not advance. Repeated/stuttered words are ignored.
 */
export class TranscriptTracker {
  private cfg: TranscriptTrackerConfig;
  private cursor = 0;
  private blocked = false;
  private done = false;
  /** Cursor index that already received a wrong event for the current attempt. */
  private flagged = -1;
  /** Words already flagged as a harakat mistake in this session. */
  private tashkeelMarked = new Set<string>();
  /**
   * First word of a possible restart from an earlier position. We wait for the
   * next token to continue the same sequence before moving the cursor back.
   */
  private pendingRewind: {
    target: number;
    span: number;
    token: string;
    score: number;
    /** Tokens that neither continued the restart nor matched anything. */
    misses: number;
  } | null = null;
  /**
   * An unrecognised token we have not yet turned into a mistake. One odd token
   * is usually recogniser noise; only a second one in a row proves the reader is
   * off the expected word.
   */
  private pendingUnknown: { token: string; count: number } | null = null;
  /**
   * A token that is only the first half of the expected word, waiting for the
   * recogniser to deliver the rest («الرح» then «من» for «الرحمن»). Holding it
   * prevents the tail from being read as the next word and the whole word from
   * being counted as skipped.
   */
  private pendingPartial: { token: string; heard: string } | null = null;
  /**
   * Spoken names of a disconnected-letters word, collected across tokens:
   * «ألف» + «لام» + «ميم» is one mushaf word. Reset as soon as the reader moves
   * on or the names do not follow the expected order.
   */
  private letterRun: { key: string; heard: string; letters: string } | null = null;
  /**
   * Leading tokens of the isti'adha/basmalah while the reader is still before
   * the first tracked word. Kept only for prefix matching; it never advances
   * the cursor and never emits an event.
   */
  private preamble: string[] = [];

  constructor(cfg: TranscriptTrackerConfig) {
    this.cfg = cfg;
  }

  getCursor() {
    return this.cursor;
  }

  /**
   * The words the reader is about to recite, as plain text the recogniser can
   * be biased towards. Only words at or after the cursor are included, so the
   * engine can never be nudged towards a word the reader has not reached yet.
   * A disconnected-letters word expands to the letter names that are actually
   * spoken.
   */
  biasPhrases(words = 10): string[] {
    const out: string[] = [];
    const end = Math.min(this.cfg.words.length, this.cursor + words);
    for (let i = this.cursor; i < end; i++) {
      const word = this.cfg.words[i];
      const letters =
        this.cfg.detectMuqattaat === false
          ? null
          : muqattaahAt(word.surah, word.ayah, word.index);
      if (letters) {
        out.push(...spokenPhrases(letters));
        continue;
      }
      const text = this.cfg.normalized[i];
      if (text) out.push(text);
    }
    return out;
  }

  isBlocked() {
    return this.blocked;
  }

  /** True once every word on this page has been recited. */
  isDone() {
    return this.done;
  }

  /** New recognised tokens, in order. Only the hook feeds this. */
  feed(tokens: string[]): void {
    if (this.done) return;
    for (const token of tokens) {
      if (this.done) return;
      this.handleToken(token);
    }
  }

  /** Manual advance when speech recognition is unavailable. One word exactly. */
  step(): void {
    if (this.done || this.blocked) return;
    this.advanceCorrect(1);
  }

  /** Reader confirmed the flagged word; release the hold and move past it. */
  retry(): void {
    if (this.done || !this.blocked) return;
    this.pendingUnknown = null;
    this.pendingPartial = null;
    this.setBlocked(false);
    this.advanceCorrect(1);
  }

  /**
   * Move the tracking cursor to a word the reader chose, without claiming any
   * word was recited. Used when recognition loses its place and the reader taps
   * «تابع من هذه الكلمة»; it records no mistakes and reveals nothing.
   */
  seekTo(key: string): boolean {
    const index = this.cfg.words.findIndex((word) => word.key === key);
    if (index < 0) return false;
    this.cursor = index;
    this.flagged = -1;
    this.pendingRewind = null;
    this.pendingUnknown = null;
    this.pendingPartial = null;
    this.letterRun = null;
    this.preamble = [];
    this.setBlocked(false);
    this.cfg.onCursor(this.cursor);
    if (this.cursor >= this.cfg.normalized.length) this.finish();
    return true;
  }

  /**
   * Record a harakat mistake on the word that was just recited. Used when the
   * recogniser cannot report vowels (the browser engine) and the reader taps
   * the harakat button after reciting a word with the wrong vowel.
   *
   * The cursor does not move: the reader already recited that word, and the
   * next word is still the one they should continue with.
   */
  markTashkeel(): DetectorWord | null {
    if (this.cursor <= 0) return null;
    return this.markTashkeelAt(this.cfg.words[this.cursor - 1].key);
  }

  /**
   * Record a harakat mistake on any word already recited in this session.
   * Returns the flagged word, or null when the word was not recited yet or is
   * already flagged. The cursor never changes.
   */
  markTashkeelAt(key: string): DetectorWord | null {
    const index = this.cfg.words.findIndex((word) => word.key === key);
    if (index < 0 || index >= this.cursor) return null;
    if (this.tashkeelMarked.has(key)) return null;
    this.tashkeelMarked.add(key);
    const word = this.cfg.words[index];
    this.emit(word, 'tashkeel');
    return word;
  }

  /**
   * Consume one token while the cursor sits on a disconnected-letters word.
   * Returns true when the token belonged to that word (fully or partially), so
   * the ordinary alignment must not also process it.
   */
  private handleLetters(heard: string, token: string): boolean {
    if (this.cfg.detectMuqattaat === false) return false;
    const word = this.cfg.words[this.cursor];
    if (!word) return false;
    const mq = muqattaahAt(word.surah, word.ayah, word.index);
    if (!mq) {
      this.letterRun = null;
      return false;
    }

    if (token === mq) {
      this.letterRun = null;
      this.completeLetters(heard);
      return true;
    }

    // A recogniser may write the whole opening as one near-homophone,
    // «آلام»/«ألام» for «الم». The word is still the opening, so accept it
    // while the cursor is on it; the graph only moves one word.
    if (mq.length >= 2 && phoneticSimilarity(token, mq) >= 0.8) {
      this.letterRun = null;
      this.completeLetters(heard);
      return true;
    }

    const run =
      this.letterRun?.key === word.key
        ? this.letterRun
        : { key: word.key, heard: '', letters: '' };

    // A repeated name — a stutter or the engine hearing the same letter twice —
    // is ignored while the run is intact: the reader has not said anything
    // wrong, so the letter is not counted twice and no mistake is recorded.
    const spelling = readLetterSpelling(token);
    if (spelling && run.letters.endsWith(spelling)) {
      return true;
    }

    // Only the letters still owed are offered to the matcher, so a fuzzy name
    // can never be read as a letter that is not next in the opening.
    const letters = readLetterRun(token, mq.slice(run.letters.length));
    if (!letters) {
      // The reader may have gone back and restarted the opening from its first
      // letter («ألف» again): begin a fresh run instead of blaming the token.
      if (spelling && mq.startsWith(spelling)) {
        this.pendingRewind = null;
        if (spelling === mq) {
          this.letterRun = null;
          this.completeLetters(heard);
        } else {
          this.letterRun = { key: word.key, heard, letters: spelling };
        }
        return true;
      }
      // An ordinary word or a name out of order: the reader is not spelling
      // the opening correctly, so ordinary alignment judges the token.
      // A half-spoken opening followed by the *next* word is a real omission,
      // not a recogniser merge (the reader audibly stopped mid-word), so record
      // it before alignment continues.
      const partialRun =
        this.letterRun?.key === word.key ? this.letterRun : null;
      const abandoned = Boolean(partialRun?.letters);
      this.letterRun = null;
      if (abandoned) {
        const next = matchAt(token, this.cfg.normalized.slice(this.cursor + 1));
        if (next && next.score >= 0.85) {
          this.handleWrong(partialRun?.heard ?? heard);
        }
      }
      return false;
    }

    const next = run.letters + letters;

    this.pendingRewind = null;
    const spoken = run.heard ? `${run.heard} ${heard}` : heard;
    if (next === mq) {
      this.letterRun = null;
      this.completeLetters(spoken);
    } else {
      this.letterRun = { key: word.key, heard: spoken, letters: next };
    }
    return true;
  }

  /** One mushaf word recited as several letter names: advance exactly one word. */
  private completeLetters(spoken: string): void {
    const word = this.cfg.words[this.cursor];
    if (!word) return;
    this.pendingUnknown = null;
    this.pendingPartial = null;
    this.emit(word, 'correct', { recitedText: spoken, confidence: 1 });
    this.cursor += 1;
    this.flagged = -1;
    if (this.blocked) this.setBlocked(false);
    this.cfg.onCursor(this.cursor);
    if (this.cursor >= this.cfg.normalized.length) this.finish();
  }

  /**
   * Swallow the isti'adha/basmalah said before the session's first word.
   * Returns true when the token belonged to that opening, so neither alignment
   * nor mistake detection sees it. A token that matches the expected first word
   * is never swallowed: Al-Fatihah *is* the basmalah, and some ayahs open with
   * «الله» or «من».
   */
  private handlePreamble(token: string): boolean {
    if (this.cfg.detectPreamble === false) return false;
    const expected = this.cfg.normalized[this.cursor] ?? '';
    // Never swallow the word being tracked. The second word of the basmalah is
    // «الله», which is also the first word of ayahs such as 2:255, and it must
    // still count as part of the opening there.
    if (this.preamble.length === 0 && expected && wordScore(token, expected) > 0) {
      return false;
    }

    const next = [...this.preamble, token];
    const matching = PREAMBLES.filter(
      (sequence) =>
        sequence.length >= next.length &&
        next.every((heard, i) => looseSame(heard, sequence[i])),
    );
    if (matching.length === 0) {
      this.preamble = [];
      return false;
    }

    // A completed opening stays in the buffer while it can still grow
    // («أعوذ بالله» → «من الشيطان الرجيم»); otherwise it is finished.
    this.pendingUnknown = null;
    if (matching.some((sequence) => sequence.length > next.length)) {
      this.preamble = next;
    } else {
      this.preamble = [];
    }
    return true;
  }

  private handleToken(raw: string): void {
    const heard = raw.trim();
    if (!heard) return;
    // Recognisers may return diacritized text; alignment works on letters and
    // the original token is kept for the harakat check.
    const token = normalizeToken(heard);
    if (!token) return;
    if (this.cursor >= this.cfg.normalized.length) {
      this.finish();
      return;
    }
    // A breath or hesitation is not a recitation mistake. A tracked word that
    // happens to look like one of these is never ignored.
    if (
      FILLERS.has(token) &&
      wordScore(token, this.cfg.normalized[this.cursor] ?? '') === 0
    ) {
      return;
    }

    // The isti'adha and basmalah are said before the first word of a session
    // but are not part of the page; swallow them instead of blaming the reader.
    if (!this.pendingRewind && this.handlePreamble(token)) return;

    // The disconnected letters are written as one word but recited as several
    // letter names. Check them before ordinary alignment so the extra tokens do
    // not look like mistakes.
    if (!this.pendingRewind && this.handleLetters(heard, token)) return;

    // A candidate restart is confirmed only when the reader continues with the
    // word that follows the earlier one. A token from the last two words may be
    // classified as a stutter, so this check has to come before alignment.
    if (this.pendingRewind) {
      const pair = this.findRestartPair(this.pendingRewind.token, token);
      if (pair) {
        const firstToken = this.pendingRewind.token;
        this.pendingRewind = null;
        this.applyRewind(pair, firstToken, token);
        return;
      }
    }

    // A held first half plus this token may be one word the engine split.
    if (this.pendingPartial) {
      const partial = this.pendingPartial;
      this.pendingPartial = null;
      const expected = this.cfg.normalized[this.cursor] ?? '';
      if (wordScore(partial.token + token, expected) >= 0.9) {
        this.pendingUnknown = null;
        this.emit(this.cfg.words[this.cursor], 'correct', {
          recitedText: `${partial.heard} ${heard}`,
          confidence: 1,
        });
        this.cursor += 1;
        this.flagged = -1;
        if (this.blocked) this.setBlocked(false);
        this.cfg.onCursor(this.cursor);
        if (this.cursor >= this.cfg.normalized.length) this.finish();
        return;
      }
      // Not the same word after all: the fragment was only half a word and is
      // dropped silently. Counting it as a miss here would blame the reader
      // twice for one recogniser artefact; the new token is judged on its own.
    }

    const alignment = alignToken(token, this.cfg.normalized, this.cursor);
    if (alignment.kind === 'none') {
      // A stray token inside a possible restart should not become a false
      // mistake, but do not suppress mistakes forever either.
      if (this.pendingRewind) {
        this.pendingRewind.misses += 1;
        if (this.pendingRewind.misses < 2) return;
        this.pendingRewind = null;
        this.pendingUnknown = null;
        this.handleWrong(heard);
        return;
      }
      if (this.holdPartial(heard, token)) return;
      this.noteUnknown(heard);
      return;
    }
    if (alignment.kind === 'repeat' || alignment.kind === 'rewind') {
      this.pendingUnknown = null;
      this.pendingPartial = null;
      this.pendingRewind = {
        target: this.cursor + alignment.offset,
        span: alignment.span,
        token,
        score: alignment.score,
        misses: 0,
      };
      return;
    }

    // A forward word means the reader is continuing from the cursor, so any
    // unfinished restart candidate and any stray token are no longer relevant.
    this.pendingRewind = null;
    this.pendingUnknown = null;
    this.pendingPartial = null;

    // While held on a word, only that word (or words merged with it) releases
    // the hold. Do not let a later word jump over the one being corrected.
    if (this.blocked && alignment.offset > 0) return;

    // The reader jumped over words. With "do not progress until fixed", hold on
    // the first missing word instead of silently accepting the jump.
    if (
      alignment.offset > 0 &&
      this.cfg.detectMistakes &&
      this.cfg.dontProgressUntilFixed
    ) {
      if (this.flagged !== this.cursor) {
        this.flagged = this.cursor;
        this.emit(this.cfg.words[this.cursor], 'wrong');
      }
      this.setBlocked(true);
      return;
    }

    if (alignment.offset > 0) {
      // One missing word between two correct ones is almost always the
      // recogniser dropping or merging a token, not the reader omitting a word.
      // Do not accuse them for it: reveal the word and continue. A wider jump
      // is real evidence of a skipped passage and is still recorded.
      const merged = alignment.offset === 1;
      for (let i = 0; i < alignment.offset; i++) {
        const at = this.cursor + i;
        const skipped = this.cfg.words[at];
        if (!skipped) break;
        // The word already flagged stays red, but it must not be counted twice
        // when the reader simply continues past it.
        if (this.flagged === at) continue;
        this.emit(skipped, this.cfg.detectMistakes && !merged ? 'wrong' : 'correct');
      }
    }

    const start = this.cursor + alignment.offset;
    for (let i = 0; i < alignment.span; i++) {
      const word = this.cfg.words[start + i];
      if (!word) break;
      const harakatWrong =
        this.cfg.detectTashkeel &&
        start === this.cursor &&
        alignment.span === 1 &&
        i === 0 &&
        tashkeelDiffers(heard, this.cfg.diacritized[start] ?? '');
      if (harakatWrong) this.tashkeelMarked.add(word.key);
      else this.tashkeelMarked.delete(word.key);
      this.emit(word, harakatWrong ? 'tashkeel' : 'correct', {
        recitedText: heard,
        confidence: alignment.score,
      });
    }

    this.cursor = Math.min(
      this.cfg.normalized.length,
      start + alignment.span,
    );
    this.flagged = -1;
    if (this.blocked) this.setBlocked(false);
    this.cfg.onCursor(this.cursor);

    if (this.cursor >= this.cfg.normalized.length) this.finish();
  }

  /**
   * Find where two consecutive heard tokens occur earlier in the passage. The
   * reader may have stopped and restarted from an earlier word; anchoring on a
   * single token is unsafe because common words repeat, but two consecutive
   * tokens are strong evidence. Forward continuation is handled separately.
   */
  private findRestartPair(
    first: string,
    second: string,
  ): { start: number; firstSpan: number; secondSpan: number } | null {
    const words = this.cfg.normalized;
    for (let start = this.cursor - 1; start >= 0; start--) {
      const head = matchAt(first, words.slice(start));
      if (!head || head.score < 0.9) continue;
      const mid = start + head.span;
      // The second token belongs to the restart only if it is at or before the
      // word we were waiting for; anything later is simply forward recitation.
      if (mid > this.cursor) continue;
      const tail = matchAt(second, words.slice(mid));
      if (!tail || tail.score < 0.99) continue;
      return { start, firstSpan: head.span, secondSpan: tail.span };
    }
    return null;
  }

  /**
   * Commit a confirmed restart: move back to the replayed word, mark the
   * replayed words correct (which clears their wrong status and any active
   * session mistake), then continue after the second token.
   */
  private applyRewind(
    pair: { start: number; firstSpan: number; secondSpan: number },
    firstToken: string,
    secondToken: string,
  ): void {
    const { start, firstSpan, secondSpan } = pair;
    const mid = start + firstSpan;

    this.cursor = start;
    this.flagged = -1;
    this.pendingUnknown = null;
    this.pendingPartial = null;
    this.letterRun = null;
    this.setBlocked(false);

    for (let i = 0; i < firstSpan; i++) {
      this.emit(this.cfg.words[start + i], 'correct', {
        recitedText: firstToken,
        confidence: 1,
      });
    }
    for (let i = 0; i < secondSpan; i++) {
      this.emit(this.cfg.words[mid + i], 'correct', {
        recitedText: secondToken,
        confidence: 1,
      });
    }

    this.cursor = Math.min(this.cfg.normalized.length, mid + secondSpan);
    this.cfg.onCursor(this.cursor);
    if (this.cursor >= this.cfg.normalized.length) this.finish();
  }

  /**
   * Hold a token that looks like the first half of the word being tracked.
   * The engine sometimes emits «الرح» and then «من» for «الرحمن»; judging the
   * fragment on its own would skip the word and lose the reader's place. It is
   * held until the next token arrives, which either completes it or shows it
   * was noise.
   */
  private holdPartial(heard: string, token: string): boolean {
    const expected = this.cfg.normalized[this.cursor] ?? '';
    if (!expected || token.length < 2 || token.length >= expected.length) {
      return false;
    }
    const prefix = expected.slice(0, token.length);
    if (wordScore(token, prefix) < 0.9) return false;
    this.pendingPartial = { token, heard };
    // Held mode stops at the word but records nothing yet.
    if (this.cfg.dontProgressUntilFixed) this.setBlocked(true);
    return true;
  }

  /**
   * A token matched nothing. Never accuse the reader on the first one: browser
   * recognisers insert filler words and drop half words constantly. The second
   * consecutive miss is evidence enough, and a real wrong word is still caught
   * when the following correct word skips over it.
   */
  private noteUnknown(token: string): void {
    const count = (this.pendingUnknown?.count ?? 0) + 1;
    this.pendingUnknown = { token, count };
    // Hold the first odd token without accusing: it may be half a word, a
    // breath, or a recogniser artefact. Hold mode still stops at the word, but
    // it records nothing until a second consecutive miss confirms it.
    if (count < 2) {
      if (this.cfg.dontProgressUntilFixed) this.setBlocked(true);
      return;
    }
    this.pendingUnknown = null;
    this.handleWrong(token);
  }

  private handleWrong(token: string): void {
    if (!this.cfg.detectMistakes) return;
    if (this.flagged === this.cursor) return;
    this.flagged = this.cursor;
    this.emit(this.cfg.words[this.cursor], 'wrong', { recitedText: token });
    if (this.cfg.dontProgressUntilFixed) this.setBlocked(true);
  }

  private advanceCorrect(count: number): void {
    this.pendingRewind = null;
    this.pendingUnknown = null;
    this.pendingPartial = null;
    this.letterRun = null;
    this.preamble = [];
    for (let i = 0; i < count; i++) {
      const word = this.cfg.words[this.cursor];
      if (!word) break;
      this.emit(word, 'correct', { confidence: 1 });
      this.cursor += 1;
    }
    this.flagged = -1;
    this.cfg.onCursor(this.cursor);
    if (this.cursor >= this.cfg.normalized.length) this.finish();
  }

  private emit(
    word: DetectorWord | undefined,
    type: EventType,
    meta?: TrackerMeta,
  ): void {
    if (!word) return;
    // A word that is now correct (or wrong for another reason) no longer has an
    // active manual harakat mark, so it can be flagged again later.
    if (type === 'correct' || type === 'wrong') this.tashkeelMarked.delete(word.key);
    this.cfg.onEvent(word, type, meta);
  }

  private setBlocked(value: boolean): void {
    if (this.blocked === value) return;
    this.blocked = value;
    this.cfg.onBlocked(value);
  }

  private finish(): void {
    if (this.done) return;
    this.done = true;
    this.cfg.onDone();
  }
}
