import raw from '../data/quran.json';
import type { DetectorWord } from './types';

export interface SurahData {
  id: number;
  name: string;
  transliteration: string;
  type: 'meccan' | 'medinan';
  total_verses: number;
  verses: { id: number; text: string }[];
}

export const surahs = raw as SurahData[];
export const TOTAL_AYAHS = surahs.reduce((n, s) => n + s.verses.length, 0);

export function getSurah(id: number): SurahData {
  return surahs[Math.min(113, Math.max(0, id - 1))];
}

export function ayahText(surah: number, ayah: number): string {
  return getSurah(surah).verses[ayah - 1]?.text ?? '';
}

const DIACRITICS =
  /[\u0610-\u061a\u064b-\u065f\u0670\u06d6-\u06ed\u08d3-\u08ff\u0640]/g;

/** Normalise for word identity: strip tashkeel/quranic marks, unify letters. */
export function normalizeArabic(text: string): string {
  return text
    .replace(DIACRITICS, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ـ/g, '')
    .replace(/\s+/g, '');
}

/** True when the two words differ only in their tashkeel. */
export function sameWordDifferentTashkeel(a: string, b: string): boolean {
  return normalizeArabic(a) === normalizeArabic(b) && a !== b;
}

const HARAKAT = /[\u064b-\u065f\u0670\u06e1]/;
const ARABIC_LETTER = /[\u0621-\u064a\u0671]/;
const MARK = /[\u064b-\u065f\u0670\u06e1]/;

/** True when the text carries at least one short-vowel mark. */
export function hasTashkeel(text: string): boolean {
  return HARAKAT.test(text);
}

function unifyLetter(ch: string): string {
  return ch
    .replace(/[\u0623\u0625\u0622\u0671]/g, '\u0627')
    .replace(/\u0649/g, '\u064a')
    .replace(/\u0624/g, '\u0648')
    .replace(/\u0626/g, '\u064a')
    .replace(/\u0629/g, '\u0647');
}

/**
 * Canonical per-letter harakat signature, e.g. «قُلْ» → `قُ|لْ`.
 *
 * Marks are sorted inside each letter so shadda-before-fatha and
 * fatha-before-shadda compare equal. Non-Arabic noise is ignored.
 */
export function tashkeelOf(text: string): string {
  const out: string[] = [];
  let marks: string[] = [];
  const flush = () => {
    if (!out.length) return;
    const rank = (m: string) => (m === '\u0651' ? 0 : 1);
    const sorted = [...new Set(marks)].sort((a, b) => rank(a) - rank(b));
    out[out.length - 1] += sorted.join('');
    marks = [];
  };
  for (const ch of text) {
    if (ARABIC_LETTER.test(ch)) {
      flush();
      out.push(unifyLetter(ch));
    } else if (MARK.test(ch)) {
      // Quranic sukun (U+06E1) and the standard one are the same vowel state.
      marks.push(ch === '\u06e1' ? '\u0652' : ch);
    }
  }
  flush();
  return out.join('|');
}

/**
 * Compare the harakat actually heard with the expected word. Both sides must
 * carry diacritics; undiacritized recogniser output is simply not judged.
 */
export function tashkeelDiffers(heard: string, expected: string): boolean {
  if (!hasTashkeel(heard) || !hasTashkeel(expected)) return false;
  return tashkeelOf(heard) !== tashkeelOf(expected);
}

export function wordsOf(surah: number, ayah: number): string[] {
  return ayahText(surah, ayah).split(/\s+/).filter(Boolean);
}

export function wordKey(surah: number, ayah: number, index: number): string {
  return `${surah}:${ayah}:${index}`;
}

export function wordsForRange(
  surah: number,
  fromAyah: number,
  toAyah: number,
): DetectorWord[] {
  const out: DetectorWord[] = [];
  for (let a = fromAyah; a <= toAyah; a++) {
    const words = wordsOf(surah, a);
    words.forEach((_, i) =>
      out.push({ key: wordKey(surah, a, i), surah, ayah: a, index: i }),
    );
  }
  return out;
}

const AR_DIGITS = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
export function arabicNumber(n: number | string): string {
  return String(n).replace(/\d/g, (d) => AR_DIGITS[Number(d)]);
}

export function surahLabel(surah: number): string {
  const s = getSurah(surah);
  return `${s.name} · ${s.total_verses} آية`;
}
