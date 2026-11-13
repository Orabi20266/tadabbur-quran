import { describe, expect, it } from 'vitest';
import { muqattaahAt, readLetterNames } from './muqattaat';
import { normalizeArabic, wordsForRange, wordsOf } from './quran';
import { TranscriptTracker } from './tracker';
import type { DetectorWord, EventType } from './types';

function harness(words: DetectorWord[]) {
  const texts = words.map((w) => wordsOf(w.surah, w.ayah)[w.index] ?? '');
  const events: { key: string; type: EventType; heard?: string }[] = [];
  let cursor = 0;
  const tracker = new TranscriptTracker({
    words,
    normalized: texts.map((t) => normalizeArabic(t)),
    diacritized: texts,
    detectMistakes: true,
    detectTashkeel: true,
    dontProgressUntilFixed: false,
    onEvent: (w, t, meta) =>
      events.push({ key: w.key, type: t, heard: meta?.recitedText }),
    onBlocked: () => {},
    onDone: () => {},
    onCursor: (i) => {
      cursor = i;
    },
  });
  return { tracker, events, cursor: () => cursor };
}

describe('disconnected letters', () => {
  it('knows where the letters are written', () => {
    expect(muqattaahAt(2, 1, 0)).toBe('الم');
    expect(muqattaahAt(7, 1, 0)).toBe('المص');
    expect(muqattaahAt(19, 1, 0)).toBe('كهيعص');
    expect(muqattaahAt(36, 1, 0)).toBe('يس');
    expect(muqattaahAt(42, 2, 0)).toBe('عسق');
    expect(muqattaahAt(2, 2, 0)).toBeNull();
    expect(muqattaahAt(2, 1, 1)).toBeNull();
  });

  it('reads the spoken letter names', () => {
    expect(readLetterNames('الف')).toBe('ا');
    expect(readLetterNames('لام')).toBe('ل');
    expect(readLetterNames('ميم')).toBe('م');
    expect(readLetterNames('ياسين')).toBe('يس');
    expect(readLetterNames('طاها')).toBe('طه');
    expect(readLetterNames('حاميم')).toBe('حم');
    expect(readLetterNames('قاف')).toBe('ق');
    expect(readLetterNames('نون')).toBe('ن');
    expect(readLetterNames('صاد')).toBe('ص');
    expect(readLetterNames('كافهاياعينصاد')).toBe('كهيعص');
    expect(readLetterNames('الفلامميمصاد')).toBe('المص');
    expect(readLetterNames('عينسينقاف')).toBe('عسق');
    // Ordinary words and the written form itself are not names.
    expect(readLetterNames('كفر')).toBeNull();
    expect(readLetterNames('الم')).toBeNull();
  });

  it('advances one word for three spoken names', () => {
    const h = harness(wordsForRange(2, 1, 2));
    h.tracker.feed(['الف', 'لام', 'ميم']);
    expect(h.cursor()).toBe(1);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('correct');
    expect(h.events[0].heard).toBe('الف لام ميم');

    h.tracker.feed(['ذالك']);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('accepts the written form and the merged name', () => {
    for (const spoken of ['الم', 'الفلامميم']) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed([spoken]);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('reads «ألف» even when the engine writes it as 1000', () => {
    for (const first of ['1000', '١٠٠٠', '1,000']) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed([first, 'لام', 'ميم']);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('accepts each surah opening the way it is recited', () => {
    const cases: [number, string[]][] = [
      [7, ['الف', 'لام', 'ميم', 'صاد']],
      [19, ['كاف', 'ها', 'يا', 'عين', 'صاد']],
      [20, ['طا', 'ها']],
      [26, ['طا', 'سين', 'ميم']],
      [27, ['طا', 'سين']],
      [36, ['ياسين']],
      [38, ['صاد']],
      [40, ['حا', 'ميم']],
      [42, ['حاميم']],
      [50, ['قاف']],
      [68, ['نون']],
    ];
    for (const [surah, spoken] of cases) {
      const h = harness(wordsForRange(surah, 1, 1));
      h.tracker.feed(spoken);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('accepts the second letter group of Ash-Shura', () => {
    const h = harness(wordsForRange(42, 2, 2));
    h.tracker.feed(['عين', 'سين', 'قاف']);
    expect(h.cursor()).toBe(1);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('does not accept the names out of order', () => {
    const h = harness(wordsForRange(2, 1, 1));
    h.tracker.feed(['لام', 'الف', 'ميم']);
    expect(h.cursor()).toBe(0);
    expect(h.events.map((e) => e.type)).toEqual(['wrong']);
  });

  it('still flags a different word at a letters position', () => {
    const h = harness(wordsForRange(2, 1, 1));
    h.tracker.feed(['كفر', 'كفر']);
    expect(h.events.map((e) => e.type)).toEqual(['wrong']);
    expect(h.cursor()).toBe(0);
  });

  it('clears a half-spoken group when the reader moves on', () => {
    const h = harness(wordsForRange(2, 1, 2));
    h.tracker.feed(['الف']);
    expect(h.cursor()).toBe(0);
    expect(h.events).toHaveLength(0);
    // The reader skipped «لام ميم» and continued with the next ayah: the group
    // is not completed, so it is flagged rather than silently accepted.
    h.tracker.feed(['ذالك']);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
  });
});
