import { describe, expect, it } from 'vitest';
import {
  arabicNumber,
  getSurah,
  normalizeArabic,
  sameWordDifferentTashkeel,
  surahs,
  TOTAL_AYAHS,
  wordKey,
  wordsForRange,
  wordsOf,
} from './quran';
import { highlightLevel, remainingToClear, confidenceOf } from './store';
import type { WordStat } from './types';

const stat = (patch: Partial<WordStat> = {}): WordStat => ({
  recited: 0,
  correct: 0,
  wrong: 0,
  streak: 0,
  lastAt: 0,
  ...patch,
});

describe('quran data', () => {
  it('has 114 surahs and 6236 ayahs', () => {
    expect(surahs).toHaveLength(114);
    expect(TOTAL_AYAHS).toBe(6236);
  });

  it('reads a known ayah', () => {
    expect(wordsOf(1, 1)).toEqual([
      'بِسۡمِ',
      'ٱللَّهِ',
      'ٱلرَّحۡمَٰنِ',
      'ٱلرَّحِيمِ',
    ]);
    expect(getSurah(112).name).toBe('الإخلاص');
  });

  it('builds stable word keys and ranges', () => {
    expect(wordKey(2, 255, 3)).toBe('2:255:3');
    const range = wordsForRange(112, 1, 2);
    expect(range[0]).toMatchObject({ surah: 112, ayah: 1, index: 0 });
    expect(range.every((w) => w.key.startsWith('112:'))).toBe(true);
  });

  it('formats Arabic-Indic digits', () => {
    expect(arabicNumber(6236)).toBe('٦٢٣٦');
    expect(arabicNumber('12')).toBe('١٢');
  });
});

describe('normalizeArabic', () => {
  it('strips tashkeel and quranic marks', () => {
    expect(normalizeArabic('ٱلۡحَمۡدُ')).toBe('الحمد');
    expect(normalizeArabic('رَحۡمَٰن')).toBe('رحمن');
  });

  it('unifies alef, yaa, taa marbuta and tatweel', () => {
    expect(normalizeArabic('أإآٱ')).toBe('اااا');
    expect(normalizeArabic('مصطفى')).toBe('مصطفي');
    expect(normalizeArabic('رحمة')).toBe('رحمه');
    expect(normalizeArabic('رحمـــة')).toBe('رحمه');
  });

  it('detects tashkeel-only differences', () => {
    expect(sameWordDifferentTashkeel('عَلِمَ', 'عَلَّمَ')).toBe(true);
    expect(sameWordDifferentTashkeel('قل', 'قال')).toBe(false);
  });
});

describe('highlight levels', () => {
  it('starts clean with no history', () => {
    expect(highlightLevel(undefined)).toBe('none');
    expect(highlightLevel(stat())).toBe('none');
  });

  it('escalates with the wrong count', () => {
    expect(highlightLevel(stat({ wrong: 1 }))).toBe('green');
    expect(highlightLevel(stat({ wrong: 2 }))).toBe('yellow');
    expect(highlightLevel(stat({ wrong: 3 }))).toBe('orange');
    expect(highlightLevel(stat({ wrong: 9 }))).toBe('red');
  });

  it('clears after three correct recitations in a row', () => {
    expect(highlightLevel(stat({ wrong: 4, streak: 2 }))).toBe('red');
    expect(highlightLevel(stat({ wrong: 4, streak: 3 }))).toBe('none');
    expect(remainingToClear(stat({ wrong: 4, streak: 1 }))).toBe(2);
    expect(remainingToClear(stat({ wrong: 0 }))).toBe(0);
  });

  it('computes confidence from recitations', () => {
    expect(confidenceOf(undefined)).toBe(0);
    expect(confidenceOf(stat({ recited: 4, correct: 3 }))).toBe(75);
  });
});
