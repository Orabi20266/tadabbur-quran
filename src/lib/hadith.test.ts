import { describe, expect, it } from 'vitest';
import { hadiths } from '../data/hadith';
import type { Hadith } from '../data/hadith';
import { normalizeToken } from './align';
import {
  detectorWords,
  MODE_LABEL,
  passageText,
  passageWords,
  progressKey,
  RECITE_MODES,
} from './hadith';
import { TranscriptTracker } from './tracker';
import type { TrackerMeta } from './tracker';
import type { DetectorWord, EventType } from './types';

interface Event {
  key: string;
  type: EventType;
  meta?: TrackerMeta;
}

function track(
  hadith: Hadith,
  mode: 'isnad' | 'matn' | 'both',
  tokens: string[],
  detectTashkeel: boolean,
) {
  const words = passageWords(hadith, mode);
  const events: Event[] = [];
  let cursor = 0;
  let done = false;
  const tracker = new TranscriptTracker({
    words: detectorWords(words, hadith),
    normalized: words.map((word) => normalizeToken(word.text)),
    diacritized: words.map((word) => word.text),
    detectMistakes: true,
    detectTashkeel,
    dontProgressUntilFixed: false,
    detectPreamble: false,
    detectMuqattaat: false,
    onEvent: (word: DetectorWord, type: EventType, meta?: TrackerMeta) => {
      events.push({ key: word.key, type, meta });
    },
    onBlocked: () => {},
    onDone: () => {
      done = true;
    },
    onCursor: (index) => {
      cursor = index;
    },
  });
  tracker.feed(tokens);
  return { cursor, done, events, words };
}

describe('Nawawi hadith dataset', () => {
  it('contains all 42 pages with a title, isnad, matn and source link', () => {
    expect(hadiths).toHaveLength(42);
    expect(new Set(hadiths.map((h) => h.id)).size).toBe(42);
    for (const hadith of hadiths) {
      expect(hadith.number).toBeGreaterThan(0);
      expect(hadith.title.length).toBeGreaterThan(0);
      expect(hadith.isnad.length).toBeGreaterThan(10);
      expect(hadith.matn.length).toBeGreaterThan(10);
      expect(hadith.url).toMatch(/^https:\/\/alnawawiforty\.com\/hadith-\d+\.html$/);
      expect(hadith.isnad + hadith.matn).not.toMatch(/<[a-z]/i);
    }
  });

  it('has no words glued together after a comma', () => {
    for (const hadith of hadiths) {
      for (const field of ['isnad', 'matn'] as const) {
        expect(hadith[field]).not.toMatch(/[،؛][^\s]/);
      }
    }
  });
});

describe('hadith recitation helpers', () => {
  const hadith = hadiths[0];

  it('selects the right passage for each mode', () => {
    expect(passageText(hadith, 'isnad')).toBe(hadith.isnad);
    expect(passageText(hadith, 'matn')).toBe(hadith.matn);
    expect(passageText(hadith, 'both')).toBe(`${hadith.isnad} ${hadith.matn}`);
    expect(Object.values(MODE_LABEL)).toEqual([
      'تسميع السند',
      'تسميع المتن',
      'تسميع كلاهما',
    ]);
    expect(RECITE_MODES).toEqual(['isnad', 'matn', 'both']);
  });

  it('keeps stable, distinct progress keys per mode', () => {
    const keys = RECITE_MODES.map((mode) => progressKey(hadith, mode));
    expect(keys).toEqual([
      'nawawi-1:isnad',
      'nawawi-1:matn',
      'nawawi-1:both',
    ]);
    expect(new Set(keys).size).toBe(3);
  });

  it('tokenizes on whitespace and keeps Arabic punctuation in the display word', () => {
    const words = passageWords(hadith, 'matn');
    expect(words.length).toBeGreaterThan(20);
    expect(words[0].text).toBe('إِنَّمَا');
    expect(words[0].key).toBe('nawawi-1:matn:0');
    expect(words[2].text).toBe('بِالنِّيَّاتِ،');
    // The recogniser never sees the punctuation: normalisation drops it.
    expect(normalizeToken(words[2].text)).toBe('بالنيات');
    expect(new Set(words.map((word) => word.key)).size).toBe(words.length);
  });

  it('builds tracker words in the same order with hadith keys', () => {
    const words = passageWords(hadith, 'both');
    const detectors = detectorWords(words, hadith);
    expect(detectors).toHaveLength(words.length);
    expect(detectors[0]).toEqual({ key: words[0].key, surah: 0, ayah: 1, index: 0 });
    expect(detectors.at(-1)?.index).toBe(words.length - 1);
  });
});

describe('hadith tracker leniency', () => {
  const hadith = hadiths[0];

  it('accepts undiacritised speech without harakat mistakes', () => {
    const words = passageWords(hadith, 'matn');
    const tokens = words.map((word) => normalizeToken(word.text));
    const result = track(hadith, 'matn', tokens, true);
    expect(result.cursor).toBe(words.length);
    expect(result.done).toBe(true);
    expect(result.events.filter((event) => event.type === 'tashkeel')).toHaveLength(0);
  });

  it('does not flag differing harakat when detectTashkeel is off', () => {
    const words = passageWords(hadith, 'matn');
    // Fully vowelised but with the wrong vowels on the first word.
    const heard = ['إَنَّمَا', ...words.slice(1).map((word) => normalizeToken(word.text))];
    const strict = track(hadith, 'matn', heard, true);
    expect(strict.events[0]?.type).toBe('tashkeel');

    const lenient = track(hadith, 'matn', heard, false);
    expect(lenient.events[0]?.type).toBe('correct');
    expect(lenient.events.filter((event) => event.type === 'tashkeel')).toHaveLength(0);
    expect(lenient.cursor).toBe(words.length);
    expect(lenient.done).toBe(true);
  });
});
