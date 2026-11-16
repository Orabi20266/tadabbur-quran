import { describe, expect, it } from 'vitest';
import {
  muqattaahAt,
  readLetterNames,
  readLetterRun,
  readLetterSpelling,
  spokenHint,
  spokenPhrases,
} from './muqattaat';
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
    // Bare letters are only read as a spelling, at a letters word.
    expect(readLetterSpelling('ا')).toBe('ا');
    expect(readLetterSpelling('لم')).toBe('لم');
    expect(readLetterSpelling('الم')).toBe('الم');
  });

  it('reads the variants a browser recogniser produces', () => {
    // Tanween on a name, a dropped alef, and «ألف» heard as «آلاف».
    expect(readLetterNames('الفا')).toBe('ا');
    expect(readLetterNames('الاف')).toBe('ا');
    expect(readLetterNames('لاما')).toBe('ل');
    expect(readLetterNames('كف')).toBe('ك');
    expect(readLetterNames('مين')).toBe('م');
    expect(readLetterNames('نونا')).toBe('ن');
  });

  it('reads the names as the engine writes them, with diacritics', () => {
    expect(readLetterNames('أَلِف')).toBe('ا');
    expect(readLetterNames('لاَم')).toBe('ل');
    expect(readLetterNames('مِيم')).toBe('م');
    expect(readLetterNames('هَاء')).toBe('ه');
    expect(readLetterNames('يَاء')).toBe('ي');
    expect(readLetterNames('طَاء')).toBe('ط');
    expect(readLetterNames('حَاء')).toBe('ح');
    expect(readLetterNames('رَاء')).toBe('ر');
  });

  it('reads the merged names the engine may shorten', () => {
    expect(readLetterNames('يسين')).toBe('يس');
    expect(readLetterNames('ياسين')).toBe('يس');
    expect(readLetterNames('طها')).toBe('طه');
    expect(readLetterNames('طاها')).toBe('طه');
    expect(readLetterNames('حميم')).toBe('حم');
    expect(readLetterNames('حاميم')).toBe('حم');
    expect(readLetterSpelling('يسين')).toBe('يس');
    expect(readLetterSpelling('طها')).toBe('طه');
  });

  it('reads an imprecise name only as the letters still owed', () => {
    // «ميم» heard «مين», «صاد» heard «ساد», «عين» heard «اعين».
    expect(readLetterRun('مين', 'م')).toBe('م');
    expect(readLetterRun('ساد', 'ص')).toBe('ص');
    expect(readLetterRun('اعين', 'ع')).toBe('ع');
    expect(readLetterRun('الف', 'الم')).toBe('ا');
    // The same mishearing may not become a letter that is not next.
    expect(readLetterRun('مين', 'ل')).toBeNull();
    expect(readLetterRun('ساد', 'م')).toBeNull();
    // An ordinary word is still not a spelling.
    expect(readLetterRun('كفر', 'الم')).toBeNull();
    expect(readLetterRun('الحمد', 'الم')).toBeNull();
  });

  it('describes how the opening is said', () => {
    expect(spokenHint('الم')).toBe('ألف لام ميم');
    expect(spokenHint('كهيعص')).toBe('كاف ها يا عين صاد');
    expect(spokenHint('يس')).toBe('ياسين');
    expect(spokenHint('ص')).toBe('صاد');
  });

  it('offers the spoken names so the engine can be biased towards them', () => {
    expect(spokenPhrases('الم')).toEqual(['ألف', 'لام', 'ميم', 'الم']);
    expect(spokenPhrases('كهيعص')).toEqual([
      'كاف',
      'ها',
      'يا',
      'عين',
      'صاد',
      'كهيعص',
    ]);
    // A merged name is what is actually said, so it comes first.
    expect(spokenPhrases('يس')[0]).toBe('ياسين');
    expect(spokenPhrases('طه')[0]).toBe('طاها');
    expect(spokenPhrases('حم')[0]).toBe('حاميم');
    expect(spokenPhrases('ن')).toEqual(['نون', 'ن']);
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

  it('accepts names the engine heard imprecisely', () => {
    for (const spoken of [
      ['الف', 'لام', 'مين'],
      ['الفا', 'لاما', 'مين'],
      ['اليف', 'لام', 'ميم'],
    ]) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed(spoken);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('ignores a repeated letter name without counting it twice', () => {
    for (const spoken of [
      ['الف', 'الف', 'لام', 'ميم'],
      ['الف', 'لام', 'لام', 'ميم'],
      ['الف', 'لام', 'ميم', 'ميم'],
    ]) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed(spoken);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('accepts a restart of the opening from its first letter', () => {
    const h = harness(wordsForRange(2, 1, 1));
    h.tracker.feed(['لام', 'الف', 'لام', 'ميم']);
    expect(h.cursor()).toBe(1);
    // The out-of-order first name is judged by ordinary alignment, then the
    // restarted opening completes the word.
    expect(h.events.map((e) => e.type)).toContain('correct');
  });

  it('accepts the shortened merged names', () => {
    for (const [surah, spoken] of [
      [36, 'يسين'],
      [20, 'طها'],
      [40, 'حميم'],
    ] as [number, string][]) {
      const h = harness(wordsForRange(surah, 1, 1));
      h.tracker.feed([spoken]);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('accepts bare letters and names with a tanween', () => {
    for (const spoken of [
      ['ا', 'ل', 'م'],
      ['الفا', 'لاما', 'ميما'],
      ['الاف', 'لام', 'ميم'],
    ]) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed(spoken);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('accepts the whole opening as one near-homophone', () => {
    for (const spoken of ['الام', 'آلام']) {
      const h = harness(wordsForRange(2, 1, 1));
      h.tracker.feed([spoken]);
      expect(h.cursor()).toBe(1);
      expect(h.events.map((e) => e.type)).toEqual(['correct']);
    }
  });

  it('reads «ألف» even when the engine writes it as 1000', () => {    for (const first of ['1000', '١٠٠٠', '1,000']) {
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
