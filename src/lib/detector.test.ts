import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DemoDetector } from './detector';
import type { DemoDetectorConfig } from './detector';
import { wordsForRange } from './quran';
import type { EventType } from './types';

const words = wordsForRange(112, 1, 4);

interface Harness {
  det: DemoDetector;
  events: { key: string; type: EventType }[];
  cursor: () => number;
  blocked: () => boolean;
  done: () => boolean;
  setSpeaking: (value: boolean) => void;
}

function makeDetector(patch: Partial<DemoDetectorConfig> = {}): Harness {
  const events: { key: string; type: EventType }[] = [];
  let cursor = 0;
  let blocked = false;
  let done = false;
  let speaking = false;

  const det = new DemoDetector({
    words,
    speaking: () => speaking,
    detectMistakes: false,
    detectTashkeel: false,
    errorRate: 0,
    paceMs: 600,
    wordLength: () => 5,
    dontProgressUntilFixed: false,
    onEvent: (word, type) => events.push({ key: word.key, type }),
    onBlocked: (value) => {
      blocked = value;
    },
    onDone: () => {
      done = true;
    },
    onCursor: (value) => {
      cursor = value;
    },
    ...patch,
  });

  return {
    det,
    events,
    cursor: () => cursor,
    blocked: () => blocked,
    done: () => done,
    setSpeaking: (value) => {
      speaking = value;
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  (globalThis as any).window = globalThis;
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DemoDetector', () => {
  it('does not advance without speech, even after a long wait', () => {
    const h = makeDetector();
    h.det.start();
    vi.advanceTimersByTime(10_000);
    expect(h.events).toHaveLength(0);
    expect(h.cursor()).toBe(0);
    h.det.stop();
  });

  it('advances while speech is detected and stops when it ends', () => {
    const h = makeDetector();
    h.det.start();
    h.setSpeaking(true);
    vi.advanceTimersByTime(1_200);
    expect(h.events).toHaveLength(2);

    h.setSpeaking(false);
    vi.advanceTimersByTime(5_000);
    expect(h.events).toHaveLength(2);
    h.det.stop();
  });

  it('advances exactly one word per manual step', () => {
    const h = makeDetector();
    h.det.step();
    expect(h.events).toHaveLength(1);
    expect(h.cursor()).toBe(1);
    h.det.step();
    expect(h.events).toHaveLength(2);
    expect(h.cursor()).toBe(2);
  });

  it('gives longer words a longer pace', () => {
    const h = makeDetector({ wordLength: () => 10 });
    h.det.start();
    h.setSpeaking(true);
    vi.advanceTimersByTime(600);
    expect(h.events).toHaveLength(0);
    vi.advanceTimersByTime(600);
    expect(h.events).toHaveLength(1);
    h.det.stop();
  });

  it('holds on a flagged word until it is retried', () => {
    const h = makeDetector({
      detectMistakes: true,
      errorRate: 1,
      dontProgressUntilFixed: true,
    });
    h.det.start();
    h.setSpeaking(true);
    vi.advanceTimersByTime(600);
    expect(h.events).toHaveLength(1);
    expect(h.blocked()).toBe(true);

    h.det.step();
    vi.advanceTimersByTime(3_000);
    expect(h.events).toHaveLength(1);

    h.det.retry();
    h.det.step();
    expect(h.events).toHaveLength(2);
    h.det.stop();
  });

  it('finishes after the last word', () => {
    const h = makeDetector({ words: words.slice(0, 2) });
    h.det.step();
    h.det.step();
    expect(h.done()).toBe(true);
    expect(h.cursor()).toBe(2);
  });
});
