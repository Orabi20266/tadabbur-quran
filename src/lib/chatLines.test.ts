import { describe, expect, it } from 'vitest';
import {
  countLine,
  DISCLAIMER,
  DORAR_DISCLAIMER,
  dorarCountLine,
  missingFor,
  NO_ANSWER,
  NO_AUTHENTIC,
  openingFor,
  PARTIAL,
  resultsWord,
  seedFor,
  WELCOME,
} from './chatLines';

describe('chatLines', () => {
  it('greets with several different phrases and stays stable per turn', () => {
    const openers = new Set([0, 1, 2, 3, 4, 5, 6].map((seed) => openingFor(seed)));
    expect(openers.size).toBeGreaterThan(4);
    expect(openingFor(3)).toBe(openingFor(3));
    expect(openingFor(7)).toBe(openingFor(0));
    expect(openingFor(-2)).toBe(openingFor(2));
  });

  it('never claims a ruling in the greeting', () => {
    for (let seed = 0; seed < 14; seed += 1) {
      const line = `${openingFor(seed)} ${missingFor(seed)} ${WELCOME} ${NO_AUTHENTIC} ${PARTIAL} ${NO_ANSWER}`;
      expect(line).not.toMatch(/حلال|حرام|يجوز|لا يجوز/);
      expect(line.length).toBeGreaterThan(10);
    }
  });

  it('admits when there is no answer instead of inventing one', () => {
    expect(NO_ANSWER).toBe('لا أدري بامكانك مراجعة من تثق في علمه في هذه المسألة.');
    expect(NO_ANSWER).toMatch(/^لا أدري/);
    expect(NO_ANSWER).not.toMatch(/الموسوعة|الدرر|فتوى|حكم/);
  });

  it('keeps the greeting short and free of encyclopedia lists', () => {
    for (let seed = 0; seed < 7; seed += 1) {
      expect(openingFor(seed)).not.toMatch(/الموسوعة الحديثية|الفقهية|العقدية/);
      expect(openingFor(seed).length).toBeLessThan(70);
    }
    expect(DISCLAIMER).not.toMatch(/الموسوعة الحديثية|الفقهية/);
    expect(DISCLAIMER.length).toBeLessThan(70);
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

  it('writes one plain count line per answer', () => {
    expect(countLine('حكم الغيبة', 3)).toBe(
      'وجدت ٣ نتائج عن «حكم الغيبة» في موقع الإسلام سؤال وجواب.',
    );
    expect(countLine('حكم الغيبة', 1)).toBe(
      'وجدت نتيجة واحدة عن «حكم الغيبة» في موقع الإسلام سؤال وجواب.',
    );
    expect(countLine('', 2)).toBe('وجدت نتيجتين في موقع الإسلام سؤال وجواب.');
    expect(countLine('ا'.repeat(60), 3)).toBe(
      'وجدت ٣ نتائج في موقع الإسلام سؤال وجواب.',
    );
  });

  it('keeps saved Dorar answers labelled as saved, not as a new search', () => {
    expect(dorarCountLine('حكم الغيبة', 2)).toBe(
      'وجدت نتيجتين عن «حكم الغيبة» في الدرر السنية.',
    );
    expect(DORAR_DISCLAIMER).toMatch(/الدرر السنية/);
    expect(DORAR_DISCLAIMER).not.toMatch(/الإسلام سؤال وجواب|IslamQA/);
  });
});
