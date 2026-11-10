import { describe, expect, it } from 'vitest';
import { normalizeArabic, wordsForRange, wordsOf } from './quran';
import { TranscriptTracker } from './tracker';
import type { TrackerMeta } from './tracker';
import type { DetectorWord, EventType } from './types';

interface Event {
  key: string;
  type: EventType;
  meta?: TrackerMeta;
}

function makeTracker(
  patch: {
    words?: DetectorWord[];
    dontProgressUntilFixed?: boolean;
    detectMistakes?: boolean;
  } = {},
) {
  const words = patch.words ?? wordsForRange(112, 1, 4);
  const normalized = words.map((w) =>
    normalizeArabic(wordsOf(w.surah, w.ayah)[w.index] ?? ''),
  );
  const events: Event[] = [];
  let cursor = 0;
  let blocked = false;
  let done = false;

  const tracker = new TranscriptTracker({
    words,
    normalized,
    detectMistakes: patch.detectMistakes ?? true,
    dontProgressUntilFixed: patch.dontProgressUntilFixed ?? false,
    onEvent: (word, type, meta) => events.push({ key: word.key, type, meta }),
    onBlocked: (value) => {
      blocked = value;
    },
    onDone: () => {
      done = true;
    },
    onCursor: (value) => {
      cursor = value;
    },
  });

  return {
    tracker,
    events,
    cursor: () => cursor,
    blocked: () => blocked,
    done: () => done,
  };
}

const allWords = wordsForRange(112, 1, 4);
const spoken = allWords.map((w) =>
  normalizeArabic(wordsOf(w.surah, w.ayah)[w.index] ?? ''),
);

describe('TranscriptTracker', () => {
  it('does not move without tokens', () => {
    const h = makeTracker();
    expect(h.cursor()).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  it('advances through correctly recited words', () => {
    const h = makeTracker();
    h.tracker.feed(spoken);
    expect(h.cursor()).toBe(allWords.length);
    expect(h.events).toHaveLength(allWords.length);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
    expect(h.done()).toBe(true);
  });

  it('records a wrong token once and waits for the correct word', () => {
    const h = makeTracker();
    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('wrong');
    expect(h.events[0].meta?.recitedText).toBe('سيارة');
    expect(h.cursor()).toBe(0);

    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(1);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
    expect(h.cursor()).toBe(1);
  });

  it('ignores a stuttered previous word', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    h.tracker.feed([spoken[0]]);
    expect(h.events).toHaveLength(1);
    expect(h.cursor()).toBe(1);
  });

  it('marks skipped words and advances when hold is off', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[2]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'wrong', 'correct']);
    expect(h.cursor()).toBe(3);
  });

  it('holds on the first skipped word when hold is on', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed([spoken[2]]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('wrong');
    expect(h.cursor()).toBe(0);
    expect(h.blocked()).toBe(true);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
    expect(h.cursor()).toBe(1);
    expect(h.blocked()).toBe(false);
  });

  it('records skipped words as correct when mistake detection is off', () => {
    const h = makeTracker({ detectMistakes: false });
    h.tracker.feed([spoken[2]]);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct', 'correct']);
    expect(h.cursor()).toBe(3);
  });

  it('does not record errors when mistake detection is off', () => {
    const h = makeTracker({ detectMistakes: false });
    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(0);
    expect(h.cursor()).toBe(0);
  });

  it('advances exactly one word per manual step', () => {
    const h = makeTracker();
    h.tracker.step();
    expect(h.cursor()).toBe(1);
    expect(h.events).toHaveLength(1);
    h.tracker.step();
    expect(h.cursor()).toBe(2);
    expect(h.events).toHaveLength(2);
  });

  it('manual retry releases a hold and moves past the word', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed(['سيارة']);
    expect(h.blocked()).toBe(true);
    h.tracker.retry();
    expect(h.blocked()).toBe(false);
    expect(h.cursor()).toBe(1);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
  });

  it('accepts a merged two-word token', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0] + spoken[1]]);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('does not rewind for a single earlier word', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6]]);
    expect(h.cursor()).toBe(10);
    expect(h.events).toHaveLength(10);
  });

  it('rewinds when two consecutive earlier words are recited', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6], spoken[7]]);
    expect(h.cursor()).toBe(8);
    expect(h.events.slice(-2).map((e) => [e.key, e.type])).toEqual([
      [allWords[6].key, 'correct'],
      [allWords[7].key, 'correct'],
    ]);
  });

  it('rewinds when the restart begins one word before the cursor', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[9], spoken[10]]);
    expect(h.cursor()).toBe(11);
    expect(h.events.slice(-2).map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('keeps the forward cursor when the reader continues after a stray word', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6]]);
    h.tracker.feed([spoken[10]]);
    expect(h.cursor()).toBe(11);
    expect(h.events).toHaveLength(11);
  });

  it('clears a hold when the reader restarts earlier', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[11]]);
    expect(h.blocked()).toBe(true);
    expect(h.cursor()).toBe(10);

    h.tracker.feed([spoken[6], spoken[7]]);
    expect(h.blocked()).toBe(false);
    expect(h.cursor()).toBe(8);

    h.tracker.feed(spoken.slice(8, 11));
    expect(h.cursor()).toBe(11);
  });

  it('rewinds with a merged token for the earlier words', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6] + spoken[7], spoken[8]]);
    expect(h.cursor()).toBe(9);
    expect(h.events.slice(-3).map((e) => e.key)).toEqual([
      allWords[6].key,
      allWords[7].key,
      allWords[8].key,
    ]);
  });
});
