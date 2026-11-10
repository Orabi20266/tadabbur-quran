import { alignToken } from './align';
import type { DetectorWord, EventType } from './types';

export interface TrackerMeta {
  recitedText?: string;
  confidence?: number;
}

export interface TranscriptTrackerConfig {
  words: DetectorWord[];
  /** Normalised text of every word, same order and length as `words`. */
  normalized: string[];
  detectMistakes: boolean;
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

  private handleToken(raw: string): void {
    const token = raw.trim();
    if (!token) return;
    if (this.cursor >= this.cfg.normalized.length) {
      this.finish();
      return;
    }

    const alignment = alignToken(token, this.cfg.normalized, this.cursor);
    if (alignment.kind === 'none') {
      this.handleWrong(token);
      return;
    }
    if (alignment.kind === 'repeat') return;

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
        const skipped = this.cfg.words[this.cursor + i];
        if (!skipped) break;
        this.emit(skipped, this.cfg.detectMistakes ? 'wrong' : 'correct');
      }
    }

    const start = this.cursor + alignment.offset;
    for (let i = 0; i < alignment.span; i++) {
      const word = this.cfg.words[start + i];
      if (!word) break;
      this.emit(word, 'correct', { recitedText: token, confidence: alignment.score });
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

  private handleWrong(token: string): void {
    if (!this.cfg.detectMistakes) return;
    if (this.flagged === this.cursor) return;
    this.flagged = this.cursor;
    this.emit(this.cfg.words[this.cursor], 'wrong', { recitedText: token });
    if (this.cfg.dontProgressUntilFixed) this.setBlocked(true);
  }

  private advanceCorrect(count: number): void {
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
