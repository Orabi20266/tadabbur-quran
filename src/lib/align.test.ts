import { describe, expect, it } from 'vitest';
import {
  alignToken,
  levenshtein,
  matchAt,
  similarity,
  splitTranscript,
  tokenizeTranscript,
  wordScore,
} from './align';
import { tashkeelDiffers } from './quran';

describe('transcript tokenization', () => {
  it('strips tashkeel, punctuation and latin noise', () => {
    expect(tokenizeTranscript('قُلۡ هُوَ ٱللَّهُ أَحَدٌ.')).toEqual([
      'قل',
      'هو',
      'الله',
      'احد',
    ]);
  });

  it('keeps words separate instead of concatenating them', () => {
    expect(tokenizeTranscript('بسم الله الرحمن الرحيم')).toHaveLength(4);
  });

  it('reads the spoken «ألف» the engine writes as 1000', () => {
    expect(tokenizeTranscript('1000 لام ميم')).toEqual(['الف', 'لام', 'ميم']);
    expect(tokenizeTranscript('١٠٠٠ لام ميم')).toEqual(['الف', 'لام', 'ميم']);
    expect(tokenizeTranscript('1,000 لام')).toEqual(['الف', 'لام']);
    // The transcript splitter must not throw the digits away first.
    expect(splitTranscript('1000 لام ميم')).toEqual(['1000', 'لام', 'ميم']);
  });
});

describe('word matching', () => {
  it('computes edit distance and similarity', () => {
    expect(levenshtein('قل', 'قل')).toBe(0);
    expect(levenshtein('الرحمن', 'الرحمان')).toBe(1);
    expect(similarity('الرحمن', 'الرحمان')).toBeGreaterThan(0.8);
  });

  it('requires short particles to be the same word', () => {
    expect(wordScore('قل', 'قل')).toBe(1);
    expect(wordScore('من', 'عن')).toBe(0);
    expect(wordScore('قال', 'قل')).toBeGreaterThan(0.8);
  });

  it('accepts ikhfa and iqlab tanween as a nasal or meem', () => {
    // «كأساً» with ikhfa sounds like «كاسن», with iqlab like «كاسم».
    expect(wordScore('كاسن', 'كاسا')).toBeGreaterThan(0.8);
    expect(wordScore('كاسم', 'كاسا')).toBeGreaterThan(0.8);
    // A two-letter word may not turn into another common word.
    expect(wordScore('من', 'ما')).toBe(0);
  });

  it('accepts a dropped lam of the definite article', () => {
    // «ٱلشَّمۡسُ» with a sun letter is heard «اشمس».
    expect(wordScore('اشمس', 'الشمس')).toBeGreaterThan(0.78);
    expect(wordScore('ارحمن', 'الرحمن')).toBeGreaterThan(0.78);
  });

  it('accepts a dropped or added attached particle', () => {
    // The recogniser freely drops the joined و/ف/ب/ل/ك: «وكأساً» becomes «كأس».
    expect(wordScore('كاس', 'وكاسا')).toBeGreaterThan(0.8);
    expect(wordScore('وبما', 'بما')).toBe(0); // too short to tell from another word
    expect(wordScore('واليوم', 'اليوم')).toBeGreaterThan(0.8);
    // But the word after the particle must still be the expected word.
    expect(wordScore('كفر', 'وكاسا')).toBe(0);
  });

  it('accepts an assimilated final noon (idgham and iqlab)', () => {
    // «مِن رَّبِّكَ» sounds like «مر ربك», «مِن بَعۡدِ» like «مم بعد».
    expect(wordScore('مر', 'من')).toBeGreaterThan(0.8);
    expect(wordScore('مم', 'من')).toBeGreaterThan(0.8);
    expect(wordScore('مل', 'من')).toBeGreaterThan(0.8);
    // A different word that merely ends in a noon target is still rejected.
    expect(wordScore('مر', 'عن')).toBe(0);
    expect(wordScore('مع', 'من')).toBe(0);
  });

  it('ignores a missing tanween (alef without the mark)', () => {
    // Ikhfa and ordinary ASR output drop the final alef of «كأساً».
    expect(wordScore('كاس', 'كاسا')).toBeGreaterThan(0.8);
    expect(wordScore('دهاق', 'دهاقا')).toBeGreaterThan(0.8);
    // The tanween never appears in normalised text, so this must not be a
    // harakat mistake either.
    expect(tashkeelDiffers('كَأْس', 'وَكَأۡسٗا')).toBe(false);
  });

  it('tolerates a recogniser confusion or an added long vowel', () => {
    // Chrome's ar-SA engine regularly writes ق as ك and inserts a long alif.
    expect(wordScore('كل', 'قل')).toBeGreaterThan(0.8);
    expect(wordScore('قال', 'قل')).toBeGreaterThan(0.8);
    expect(wordScore('السراط', 'الصراط')).toBeGreaterThan(0.9);
    expect(wordScore('الظالين', 'الضالين')).toBeGreaterThan(0.9);
  });

  it('accepts a close long word but not a different one', () => {
    expect(wordScore('الرحمان', 'الرحمن')).toBeGreaterThan(0.8);
    expect(wordScore('الرحيم', 'الرحمن')).toBe(0);
  });

  it('matches merged words as one token', () => {
    expect(matchAt('قلهو', ['قل', 'هو', 'الله'])).toEqual({ span: 2, score: 1 });
  });

  it('matches a merged pair whose noon was assimilated', () => {
    // «مِن رَّبِّكَ» spoken continuously is heard «مرربك».
    expect(matchAt('مرربك', ['من', 'ربك', 'شيء'])).toEqual({ span: 2, score: 1 });
    expect(matchAt('ممبعد', ['من', 'بعد'])).toEqual({ span: 2, score: 1 });
    // Forward skipping is stricter and must not use the assimilated form.
    expect(matchAt('مرربك', ['من', 'ربك'], true)).toBeNull();
  });
});

describe('alignment', () => {
  const expected = ['قل', 'هو', 'الله', 'احد'];

  it('advances on the expected word', () => {
    expect(alignToken('قل', expected, 0)).toMatchObject({
      kind: 'match',
      offset: 0,
      span: 1,
    });
  });

  it('detects a skipped word', () => {
    expect(alignToken('الله', expected, 0)).toMatchObject({
      kind: 'match',
      offset: 2,
      span: 1,
    });
  });

  it('prefers an exact later word over a fuzzy current one', () => {
    const words = ['الرحمن', 'الرحيم'];
    expect(alignToken('الرحيم', words, 0)).toMatchObject({
      kind: 'match',
      offset: 1,
      score: 1,
    });
  });

  it('ignores a stutter of a previous word', () => {
    expect(alignToken('قل', expected, 1)).toEqual({
      kind: 'repeat',
      offset: -1,
      span: 1,
      score: 1,
    });
  });

  it('returns none for unrelated speech', () => {
    expect(alignToken('سيارة', expected, 0).kind).toBe('none');
  });

  it('does not skip a word for a fuzzy later match', () => {
    expect(alignToken('الرحمان', ['قل', 'هو', 'الرحمن'], 0)).toEqual({
      kind: 'none',
      offset: 0,
      span: 0,
      score: 0,
    });
  });

  it('marks a word further back as a possible restart', () => {
    const words = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
    expect(alignToken('د', words, 7)).toMatchObject({
      kind: 'rewind',
      offset: -4,
      span: 1,
      score: 1,
    });
  });

  it('still ignores an immediate stutter', () => {
    const words = ['أ', 'ب', 'ج', 'د', 'هـ', 'و', 'ز', 'ح'];
    expect(alignToken('هـ', words, 6)).toMatchObject({
      kind: 'repeat',
      offset: -2,
    });
  });

  it('prefers a forward match over a repeated earlier word', () => {
    expect(alignToken('قل', ['قل', 'هو', 'الله', 'قل'], 0)).toMatchObject({
      kind: 'match',
      offset: 0,
    });
  });

  it('does not rewind on a fuzzy earlier match', () => {
    const words = ['قل', 'هو', 'الرحمن', 'أحد', 'و', 'ز'];
    expect(alignToken('الرحمان', words, 5).kind).toBe('none');
  });
});
