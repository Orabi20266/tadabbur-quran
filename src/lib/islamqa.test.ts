import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askIslamqa,
  excerpt,
  htmlToText,
  islamqaQuery,
  IslamqaError,
  rankAnswers,
} from './islamqa';
import type { IslamqaAnswer } from './islamqa';

afterEach(() => {
  vi.unstubAllGlobals();
});

function answer(id: number, title: string): IslamqaAnswer {
  return { id, title, question: '', body: '', url: `https://islamqa.info/ar/answers/${id}` };
}

describe('islamqa source text', () => {
  it('normalises an Arabic question for search', () => {
    expect(islamqaQuery('مَا حُكْمُ الغِيبَةِ؟')).toBe('ما حكم الغيبه');
    expect(islamqaQuery('  الصلاة   ') ).toBe('الصلاه');
  });

  it('turns site HTML into plain Arabic text', () => {
    const text = htmlToText(
      '<p>الجواب&nbsp;الأول</p><p>الجواب <em>الثاني</em> &amp; الثالث</p>',
    );
    expect(text).toBe('الجواب الأول\nالجواب الثاني & الثالث');
  });

  it('cuts an excerpt at a word boundary', () => {
    const text = 'كلمة '.repeat(80).trim();
    const short = excerpt(text, 30);
    expect(short.length).toBeLessThanOrEqual(31);
    expect(short.endsWith('…')).toBe(true);
    expect(short).not.toMatch(/كلما$/);
  });

  it('ranks answers whose title matches the question first', () => {
    const answers = [
      answer(1, 'فضل الصلاة'),
      answer(2, 'حكم الغيبة'),
      answer(3, 'بر الوالدين'),
    ];
    expect(rankAnswers(answers, 'ما حكم الغيبة؟').map((a) => a.id)).toEqual([
      2, 1, 3,
    ]);
  });
});

describe('askIslamqa', () => {
  it('reads only IslamQA results and forces their source links', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(
        JSON.stringify({
          ok: true,
          query: 'حكم الغيبة',
          total: 120,
          fetchedAt: 123,
          results: [
            {
              id: 115105,
              title: '<p>ضابط الغيبة المحرمة</p>',
              question: '<p>ما حكم سؤال الأم؟</p>',
              body: '<p>الغيبة محرمة.</p>',
              url: 'https://example.com/not-the-source',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await askIslamqa('ما حكم الغيبة؟');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.answers).toHaveLength(1);
    expect(result.answers[0].title).toBe('ضابط الغيبة المحرمة');
    expect(result.answers[0].body).toBe('الغيبة محرمة.');
    expect(result.answers[0].url).toBe(
      'https://islamqa.info/ar/answers/115105',
    );
    expect(result.total).toBe(120);
  });

  it('treats zero results as an answer rather than an error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(JSON.stringify({ ok: true, results: [], total: 0 }), {
          status: 200,
        }),
      ),
    );
    const result = await askIslamqa('سؤال غير موجود');
    expect(result.answers).toEqual([]);
  });

  it('reports a bad worker response clearly', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('{}', { status: 200 })),
    );
    await expect(askIslamqa('حكم السفر')).rejects.toMatchObject({
      code: 'bad-response',
    } satisfies Partial<IslamqaError>);
  });
});
