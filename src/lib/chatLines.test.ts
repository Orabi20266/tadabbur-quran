import { describe, expect, it } from 'vitest';
import {
  countLine,
  missingFor,
  openingFor,
  resultsWord,
  seedFor,
  weakFor,
  WELCOME,
} from './chatLines';

describe('chatLines', () => {
  it('greets with several different phrases and stays stable per turn', () => {
    const openers = new Set([0, 1, 2, 3, 4, 5, 6].map((seed) => openingFor(seed)));
    expect(openers.size).toBeGreaterThan(4);
    expect(openingFor(3)).toBe(openingFor(3));
    expect(openingFor(7)).toBe(openingFor(0));
    // Negative seeds (hash collisions with Math.abs removed) are safe.
    expect(openingFor(-2)).toBe(openingFor(2));
  });

  it('never claims a ruling in the greeting', () => {
    for (let seed = 0; seed < 14; seed += 1) {
      const line = `${openingFor(seed)} ${missingFor(seed)} ${weakFor(seed)} ${WELCOME}`;
      expect(line).not.toMatch(/حلال|حرام|يجوز|لا يجوز|فتوى شخصية\.$/);
      expect(line.length).toBeGreaterThan(10);
    }
  });

  it('derives the same seed for the same conversation id', () => {
    expect(seedFor('turn-1')).toBe(seedFor('turn-1'));
    expect(seedFor('turn-1')).not.toBe(seedFor('turn-2'));
    expect(seedFor('turn-1')).toBeGreaterThanOrEqual(0);
  });

  it('counts results with correct Arabic plurals', () => {
    expect(resultsWord(1)).toBe('نتيجة واحدة');
    expect(resultsWord(2)).toBe('نتيجتين');
    expect(resultsWord(3)).toBe('٣ نتائج');
    expect(resultsWord(10)).toBe('١٠ نتائج');
    expect(resultsWord(11)).toBe('١١ نتيجة');
    expect(resultsWord(15)).toBe('١٥ نتيجة');
    expect(resultsWord(100)).toBe('١٠٠ نتيجة');
  });

  it('echoes the query when it is short enough', () => {
    expect(countLine('حكم الغيبة', 15)).toBe(
      'وجدت ١٥ نتيجة عن «حكم الغيبة» في الدرر السنية، مرتّبة بحسب درجة الحديث.',
    );
    expect(countLine('حكم الغيبة', 1)).toBe(
      'وجدت نتيجة واحدة عن «حكم الغيبة» في الدرر السنية.',
    );
    expect(countLine('', 2)).toBe(
      'وجدت نتيجتين في الدرر السنية، مرتّبة بحسب درجة الحديث.',
    );
    expect(countLine('ا'.repeat(60), 3)).not.toContain('عن «');
  });
});
