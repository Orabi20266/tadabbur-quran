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
