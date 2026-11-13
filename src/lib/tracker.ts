import { alignToken, matchAt, normalizeToken } from './align';
import { tashkeelDiffers } from './quran';
import type { DetectorWord, EventType } from './types';

export interface TrackerMeta {
  recitedText?: string;
  confidence?: number;
}

export interface TranscriptTrackerConfig {
  words: DetectorWord[];
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

  constructor(cfg: TranscriptTrackerConfig) {
    this.cfg = cfg;
  }

  getCursor() {
    return this.cursor;
  }

  isBlocked() {
    return this.blocked;
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
    this.setBlocked(false);
    this.advanceCorrect(1);
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

    const alignment = alignToken(token, this.cfg.normalized, this.cursor);
    if (alignment.kind === 'none') {
      // A stray token inside a possible restart should not become a false
      // mistake, but do not suppress mistakes forever either.
      if (this.pendingRewind) {
        this.pendingRewind.misses += 1;
        if (this.pendingRewind.misses < 2) return;
        this.pendingRewind = null;
      }
      this.handleWrong(heard);
      return;
    }
    if (alignment.kind === 'repeat' || alignment.kind === 'rewind') {
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
    // unfinished restart candidate is no longer relevant.
    this.pendingRewind = null;

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
      for (let i = 0; i < alignment.offset; i++) {
        const at = this.cursor + i;
        const skipped = this.cfg.words[at];
        if (!skipped) break;
        // The word already flagged stays red, but it must not be counted twice
        // when the reader simply continues past it.
        if (this.flagged === at) continue;
        this.emit(skipped, this.cfg.detectMistakes ? 'wrong' : 'correct');
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

  private handleWrong(token: string): void {
    if (!this.cfg.detectMistakes) return;
    if (this.flagged === this.cursor) return;
    this.flagged = this.cursor;
    this.emit(this.cfg.words[this.cursor], 'wrong', { recitedText: token });
    if (this.cfg.dontProgressUntilFixed) this.setBlocked(true);
  }

  private advanceCorrect(count: number): void {
    this.pendingRewind = null;
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
    if (word) this.cfg.onEvent(word, type, meta);
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
