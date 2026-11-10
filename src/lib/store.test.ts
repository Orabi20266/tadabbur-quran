import { beforeEach, describe, expect, it } from 'vitest';
import { getState, recordEvent, resetAll } from './store';

const base = {
  sessionId: 'session-a',
  surah: 112,
  ayah: 1,
  wordIndex: 0,
  wordKey: '112:1:0',
  correctText: 'قل',
};

beforeEach(() => {
  resetAll();
});

describe('mistake resolution', () => {
  it('soft-removes an active mistake once the word is recited correctly', () => {
    recordEvent({ ...base, type: 'wrong', recitedText: 'كل' });
    expect(getState().mistakes.filter((m) => !m.removed)).toHaveLength(1);

    recordEvent({ ...base, type: 'correct' });
    expect(getState().mistakes).toHaveLength(1);
    expect(getState().mistakes[0].removed).toBe(true);
  });

  it('leaves mistakes from another session or another word active', () => {
    recordEvent({ ...base, type: 'wrong' });

    recordEvent({ ...base, sessionId: 'session-b', type: 'correct' });
    recordEvent({ ...base, wordKey: '112:1:1', type: 'correct' });

    expect(getState().mistakes[0].removed).toBe(false);
  });

  it('keeps recording new mistakes after a correction', () => {
    recordEvent({ ...base, type: 'wrong' });
    recordEvent({ ...base, type: 'correct' });
    recordEvent({ ...base, type: 'wrong', recitedText: 'كل' });

    const active = getState().mistakes.filter((m) => !m.removed);
    expect(active).toHaveLength(1);
    expect(active[0].recitedText).toBe('كل');
  });
});
