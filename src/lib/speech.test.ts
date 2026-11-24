import { describe, expect, it } from 'vitest';
import { mergeSplitParticles, biasPlan, nextTokens } from './useSpeech';

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

describe('shared transcript cursor (web + native)', () => {
  it('holds the last interim word until the engine settles', () => {
    const first = nextTokens('قل هو الله', true, 0);
    expect(first?.end).toBe(2);
    expect(first?.tokens).toEqual(['قل', 'هو']);

    const settled = nextTokens('قل هو الله', false, 2);
    expect(settled?.end).toBe(3);
    expect(settled?.tokens).toEqual(['الله']);
  });

  it('holds a trailing particle so it can join the next word', () => {
    expect(nextTokens('قل و', true, 0)).toEqual({ end: 1, tokens: ['قل'] });
    expect(nextTokens('قل و الله', false, 1)?.tokens).toEqual(['والله']);
  });

  it('moves the cursor back when the engine revises a transcript down', () => {
    expect(nextTokens('قل هو', false, 3)).toEqual({ end: 2, tokens: [] });
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
