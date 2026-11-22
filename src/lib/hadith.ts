import type { Hadith } from '../data/hadith';
import type { DetectorWord } from './types';

export type ReciteMode = 'isnad' | 'matn' | 'both';

export interface PassageWord {
  key: string;
  text: string;
}

export const MODE_LABEL: Record<ReciteMode, string> = {
  isnad: 'تسميع السند',
  matn: 'تسميع المتن',
  both: 'تسميع كلاهما',
};

export const MODE_HINT: Record<ReciteMode, string> = {
  isnad: 'ما قبل قول النبي ﷺ من قول الراوي',
  matn: 'قول النبي ﷺ كما ورد في المتن',
  both: 'السند ثم المتن، كلمة بكلمة',
};

export const RECITE_MODES: ReciteMode[] = ['isnad', 'matn', 'both'];

/** Stable key for a hadith's saved progress in each recitation mode. */
export function progressKey(hadith: Hadith, mode: ReciteMode): string {
  return `${hadith.id}:${mode}`;
}

/** The passage a reader is asked to recite for a chosen mode. */
export function passageText(hadith: Hadith, mode: ReciteMode): string {
  if (mode === 'isnad') return hadith.isnad;
  if (mode === 'matn') return hadith.matn;
  return `${hadith.isnad} ${hadith.matn}`;
}

/**
 * The hadith text is the source of truth. Punctuation is stripped only from the
 * edges of each token so the recogniser never has to match «،» or «؟», while the
 * displayed word keeps the site's spelling and harakat.
 */
export function passageWords(hadith: Hadith, mode: ReciteMode): PassageWord[] {
  return passageText(hadith, mode)
    .split(/\s+/)
    .map((token) => token.replace(/^[^\u0600-\u06ff]+|[^\u0600-\u06ff]+$/g, ''))
    .filter((token) => token.length > 0)
    .map((text, index) => ({ key: `${hadith.id}:${mode}:${index}`, text }));
}

/** Map display words onto the shape TranscriptTracker expects. */
export function detectorWords(words: PassageWord[], hadith: Hadith): DetectorWord[] {
  return words.map((word, index) => ({
    key: word.key,
    surah: 0,
    ayah: hadith.number,
    index,
  }));
}
