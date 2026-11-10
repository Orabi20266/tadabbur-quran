import type { DetectorWord, EventType } from './types';

export interface DemoDetectorConfig {
  words: DetectorWord[];
  /**
   * True only while real voice is detected. The detector NEVER advances on a
   * timer alone: silence and room noise must not move the cursor.
   */
  speaking: () => boolean;
  detectMistakes: boolean;
  detectTashkeel: boolean;
  errorRate: number;
  /** Base time for an average-length word; scaled per word by `wordLength`. */
  paceMs: number;
  /** Normalised letter count, used to give longer words more time. */
  wordLength?: (word: DetectorWord) => number;
  dontProgressUntilFixed: boolean;
  onEvent: (word: DetectorWord, type: EventType) => void;
  onBlocked: (blocked: boolean) => void;
  onDone: () => void;
  onCursor: (index: number) => void;
}

const TICK_MS = 120;
const AVERAGE_LENGTH = 5;

/**
 * Demo detector. It does NOT recognise speech. While the VAD reports voice, it
 * walks the expected words at a recitation pace and injects mistakes at the
 * configured rate, so the whole session UI can be exercised.
 *
 * Phase 2 replaces this with StreamingDetector: same callbacks, real ASR over
 * WebSocket. See replica/architecture.md section 4.
 */
export class DemoDetector {
  private cfg: DemoDetectorConfig;
  private timer: number | null = null;
  private cursor = 0;
  private elapsed = 0;
  private paused = false;
  private blocked = false;
  private done = false;

  constructor(cfg: DemoDetectorConfig) {
    this.cfg = cfg;
  }

  start() {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => this.tick(), TICK_MS);
    this.cfg.onCursor(0);
  }

  stop() {
    if (this.timer !== null) {
      window.clearInterval(this.timer);
      this.timer = null;
    }
  }

  pause() {
    this.paused = true;
  }

  resume() {
    this.paused = false;
  }

  /** The reader repeated the flagged word: clear the hold and continue. */
  retry() {
    this.blocked = false;
    this.elapsed = 0;
    this.cfg.onBlocked(false);
  }

  /**
   * Manual advance for when the microphone is unavailable. Advances exactly one
   * word; it never runs on its own.
   */
  step() {
    if (this.paused || this.blocked || this.done) return;
    this.elapsed = 0;
    this.advance();
  }

  getCursor() {
    return this.cursor;
  }

  private paceFor(word: DetectorWord): number {
    const length = this.cfg.wordLength?.(word) ?? AVERAGE_LENGTH;
    const scale = Math.min(1.8, Math.max(0.65, length / AVERAGE_LENGTH));
    return Math.round(this.cfg.paceMs * scale);
  }

  private tick() {
    if (this.paused || this.blocked || this.done) return;
    if (!this.cfg.speaking()) {
      // A real pause resets partial progress; a short gap is covered by the
      // VAD hold, so this only fires when the reader actually stopped.
      this.elapsed = 0;
      return;
    }

    this.elapsed += TICK_MS;
    const word = this.cfg.words[this.cursor];
    if (!word) {
      this.finish();
      return;
    }
    if (this.elapsed < this.paceFor(word)) return;

    this.elapsed = 0;
    this.advance();
  }

  private advance() {
    if (this.done) return;
    const word = this.cfg.words[this.cursor];
    if (!word) {
      this.finish();
      return;
    }

    let type: EventType = 'correct';
    if (this.cfg.detectMistakes && Math.random() < this.cfg.errorRate) {
      type =
        this.cfg.detectTashkeel && Math.random() < 0.3 ? 'tashkeel' : 'wrong';
    }

    this.cfg.onEvent(word, type);
    this.cursor += 1;
    this.cfg.onCursor(this.cursor);

    if (type !== 'correct' && this.cfg.dontProgressUntilFixed) {
      this.blocked = true;
      this.cfg.onBlocked(true);
    }

    if (this.cursor >= this.cfg.words.length) this.finish();
  }

  private finish() {
    if (this.done) return;
    this.done = true;
    this.stop();
    this.cfg.onDone();
  }
}
