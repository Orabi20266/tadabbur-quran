import { describe, expect, it } from 'vitest';
import {
  alignToken,
  levenshtein,
  matchAt,
  similarity,
  tokenizeTranscript,
  wordScore,
} from './align';

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
});

describe('word matching', () => {
  it('computes edit distance and similarity', () => {
    expect(levenshtein('قل', 'قل')).toBe(0);
    expect(levenshtein('الرحمن', 'الرحمان')).toBe(1);
    expect(similarity('الرحمن', 'الرحمان')).toBeGreaterThan(0.8);
  });

  it('requires short particles to match exactly', () => {
    expect(wordScore('قل', 'قل')).toBe(1);
    expect(wordScore('كل', 'قل')).toBe(0);
  });

  it('accepts a close long word but not a different one', () => {
    expect(wordScore('الرحمان', 'الرحمن')).toBeGreaterThan(0.8);
    expect(wordScore('الرحيم', 'الرحمن')).toBe(0);
  });

  it('matches merged words as one token', () => {
    expect(matchAt('قلهو', ['قل', 'هو', 'الله'])).toEqual({ span: 2, score: 1 });
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
