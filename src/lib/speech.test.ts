import { describe, expect, it } from 'vitest';
import { mergeSplitParticles } from './useSpeech';

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
