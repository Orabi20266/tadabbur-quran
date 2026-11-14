import { describe, expect, it } from 'vitest';
import { mergeSplitParticles, biasPlan } from './useSpeech';

describe('recogniser transcript cleanup', () => {
  it('joins a particle the engine split off the next word', () => {
    expect(mergeSplitParticles(['و', 'الله', 'قل', 'هو'])).toEqual([
      'والله',
      'قل',
      'هو',
    ]);
    expect(mergeSplitParticles(['ف', 'سبح', 'ب', 'حمد'])).toEqual([
      'فسبح',
      'بحمد',
    ]);
  });

  it('leaves ordinary tokens alone', () => {
    expect(mergeSplitParticles(['قل', 'هو', 'الله'])).toEqual([
      'قل',
      'هو',
      'الله',
    ]);
    expect(mergeSplitParticles([])).toEqual([]);
  });
});

describe('recogniser biasing', () => {
  it('boosts the next words hardest and drops duplicates', () => {
    const plan = biasPlan(['قل', 'هو', 'قل', 'الله', 'أحد', 'الصمد', 'لم', 'يلد']);
    expect(plan.map((p) => p.text)).toEqual([
      'قل',
      'هو',
      'الله',
      'أحد',
      'الصمد',
      'لم',
      'يلد',
    ]);
    expect(plan[0].boost).toBe(8);
    expect(plan[1].boost).toBe(8);
    expect(plan[2].boost).toBe(5);
    expect(plan[6].boost).toBe(2);
    // Chrome rejects a boost outside 0–10 when the phrase is built.
    expect(plan.every((p) => p.boost >= 0 && p.boost <= 10)).toBe(true);
  });

  it('stays empty when there is nothing to bias', () => {
    expect(biasPlan([])).toEqual([]);
    expect(biasPlan(['   '])).toEqual([]);
  });

  it('caps a very long list so the engine is not flooded', () => {
    const words = Array.from({ length: 120 }, (_, i) => `كلمة${i}`);
    expect(biasPlan(words)).toHaveLength(60);
  });
});
