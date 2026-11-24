import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askDorar } from './dorar';
import type { DorarAnswer } from './dorar';
import {
  clearOfflineAnswers,
  downloadOfflinePack,
  getCachedAnswer,
  offlineCount,
  saveCachedAnswer,
} from './dorarOffline';

vi.mock('./dorar', async () => {
  const actual = await vi.importActual<typeof import('./dorar')>('./dorar');
  return { ...actual, askDorar: vi.fn() };
});

function answer(query: string): DorarAnswer {
  return {
    query,
    sources: [],
    total: 0,
    moreUrl: 'https://dorar.net/hadith/search',
    hadiths: [],
    partial: false,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  const values = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    removeItem: (key: string) => void values.delete(key),
    clear: () => values.clear(),
  });
});

describe('offline Dorar answers', () => {
  it('saves under the canonical query so reworded questions find it', () => {
    saveCachedAnswer('ما حكم الغيبة؟', answer('الغيبة'));

    expect(offlineCount()).toBe(1);
    expect(getCachedAnswer('حكم الغيبة')?.query).toBe('الغيبة');
  });

  it('replaces an older answer for the same question', () => {
    saveCachedAnswer('بر الوالدين', answer('بر الوالدين'));
    saveCachedAnswer('بر الوالدين', answer('بر الوالدين'));
    expect(offlineCount()).toBe(1);
  });

  it('clears the saved answers', () => {
    saveCachedAnswer('بر الوالدين', answer('بر الوالدين'));
    clearOfflineAnswers();
    expect(offlineCount()).toBe(0);
  });
});

describe('downloadOfflinePack', () => {
  it('skips saved items and reports failures without stopping', async () => {
    saveCachedAnswer('الأربعين النووية', answer('الأربعين النووية'));
    vi.mocked(askDorar).mockImplementation(async (query) => {
      if (query === 'نية الأعمال') return answer('نية الأعمال');
      throw new Error('offline');
    });
    const progress: number[] = [];

    const result = await downloadOfflinePack((done) => progress.push(done));

    expect(result.total).toBe(8);
    expect(result.skipped).toBe(1);
    expect(result.ok).toBe(1);
    expect(result.failed).toHaveLength(6);
    expect(progress).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });
});
