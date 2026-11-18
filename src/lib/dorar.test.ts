import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  askDorar,
  cleanItems,
  collectResults,
  matchesQuery,
  normalizeArabic,
  queryWords,
  relevanceScore,
  decodeEntities,
  dorarQuery,
  dorarSearchUrl,
  dorarSourceUrl,
  DorarError,
  gradeRank,
  htmlToText,
  parseDorarHtml,
  parseHadithInfo,
  sourceMeta,
} from './dorar';

const SAMPLE = `
<head><link rel="canonical" href="https://dorar.net/dorar_api.json"></head>
<div class="hadith" style="text-align:justify;">1 -   إنَّ <span class="search-keys">الرِّبا</span> نيِّفٌ وسبعون بابًا .</div>

<div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> عبدالله بن عباس</span>
    <span class="info-subtitle">المحدث:</span> المنذري
    <span class="info-subtitle">المصدر:</span>  الترغيب والترهيب
    <span class="info-subtitle">الصفحة أو الرقم:</span>  4/7
    <span class="info-subtitle">خلاصة حكم المحدث:</span>  <span >[لا يتطرق إليه احتمال التحسين]</span>
</div>
--------------
<br/>
<div class="hadith" style="text-align:justify;">2 -   قال رسولُ اللهِ صلَّى اللهُ عليه وسلَّم : <span class="search-keys">مَن</span> غشَّنا فليس منَّا .</div>

<div class="hadith-info">
    <span class="info-subtitle">الراوي:</span> أبو هريرة</span>
    <span class="info-subtitle">المحدث:</span> مسلم
    <span class="info-subtitle">المصدر:</span>  صحيح مسلم
    <span class="info-subtitle">الصفحة أو الرقم:</span>  101
    <span class="info-subtitle">خلاصة حكم المحدث:</span>  <span >صحيح</span>
</div>
--------------
<br/>
<br/><br/>
<a href="https://dorar.net/hadith/search?q=%D8%A7%D9%84%D8%B1%D8%A8%D8%A7&amp;page=2">المزيد</a>
`;

describe('dorarQuery', () => {
  it('turns a question into search keywords', () => {
    expect(dorarQuery('ما حكم الغيبة؟')).toBe('الغيبة');
    expect(dorarQuery('ما هو فضل الصلاة على النبي')).toBe(
      'فضل الصلاة على النبي',
    );
    expect(dorarQuery('هل يجوز الربا')).toBe('يجوز الربا');
    expect(dorarQuery('أريد أن أعرف حكم الغيبة')).toBe('الغيبة');
  });

  it('drops a generic «حكم» only when a real topic remains', () => {
    expect(dorarQuery('حكم الربا')).toBe('الربا');
    expect(dorarQuery('أحكام الصيام')).toBe('الصيام');
    expect(dorarQuery('حكم صلاة الضحى')).toBe('صلاة الضحى');
    // كلمة واحدة فقط: تُترك كما هي.
    expect(dorarQuery('حكم')).toBe('حكم');
    expect(dorarQuery('ما حكم')).toBe('حكم');
  });

  it('keeps a plain topic as it is', () => {
    expect(dorarQuery('  بر الوالدين  ')).toBe('بر الوالدين');
    expect(dorarQuery('الغيبة')).toBe('الغيبة');
  });

  it('falls back to the original when nothing remains', () => {
    expect(dorarQuery('هل')).toBe('هل');
    expect(dorarQuery('')).toBe('');
  });

  it('strips markup and control characters', () => {
    expect(dorarQuery('ما حكم <b>الغيبة</b>')).toBe('الغيبة');
  });

  it('builds a search link for the hadith encyclopedia', () => {
    expect(dorarSearchUrl('حكم الغيبة')).toBe(
      'https://dorar.net/hadith/search?q=%D8%AD%D9%83%D9%85%20%D8%A7%D9%84%D8%BA%D9%8A%D8%A8%D8%A9',
    );
  });
});

describe('encyclopedias', () => {
  it('maps each source to its own path in dorar.net', () => {
    expect(dorarSourceUrl('hadith', 'الغيبة')).toBe(
      'https://dorar.net/hadith/search?q=%D8%A7%D9%84%D8%BA%D9%8A%D8%A8%D8%A9&st=w&sc=a',
    );
    expect(dorarSourceUrl('fiqh', 'الغيبة')).toContain('/feqhia/search');
    expect(dorarSourceUrl('tafsir', 'الغيبة')).toContain('/tafseer/search');
    expect(dorarSourceUrl('aqeedah', 'الغيبة')).toContain('/aqeeda/search');
    expect(dorarSourceUrl('adab', 'الغيبة')).toContain('/aadab/search');
    // «جميع الكلمات» لا «أي كلمة»، وإلا غرقت النتائج.
    expect(dorarSourceUrl('fiqh', 'x')).toContain('st=w');
  });

  it('labels each encyclopedia as dorar.net names it', () => {
    expect(sourceMeta('fiqh').label).toBe('الموسوعة الفقهية');
    expect(sourceMeta('tafsir').label).toBe('موسوعة التفسير');
    expect(sourceMeta('adab').label).toBe('موسوعة الآداب');
    expect(sourceMeta('aqeedah').short).toBe('العقيدة');
  });
});

describe('HTML parsing', () => {
  it('decodes entities and removes tags', () => {
    expect(decodeEntities('أ&amp;ب&nbsp;ج&#160;د')).toBe('أ&ب ج د');
    expect(htmlToText('<span class="search-keys">الرِّبا</span> <br/> حرام')).toBe(
      'الرِّبا حرام',
    );
  });

  it('reads the labelled info block without confusing «المحدث»', () => {
    const info = parseHadithInfo(`
      <span class="info-subtitle">الراوي:</span> أبو هريرة
      <span class="info-subtitle">المحدث:</span> مسلم
      <span class="info-subtitle">المصدر:</span> صحيح مسلم
      <span class="info-subtitle">الصفحة أو الرقم:</span> 101
      <span class="info-subtitle">خلاصة حكم المحدث:</span> <span>صحيح</span>
    `);
    expect(info['الراوي']).toBe('أبو هريرة');
    expect(info['المحدث']).toBe('مسلم');
    expect(info['المصدر']).toBe('صحيح مسلم');
    expect(info['الصفحة أو الرقم']).toBe('101');
    expect(info['خلاصة حكم المحدث']).toBe('صحيح');
  });

  it('parses hadiths, sorts authentic first and keeps the search link', () => {
    const result = parseDorarHtml(SAMPLE, 'الربا');
    expect(result.hadiths).toHaveLength(2);
    expect(result.hadiths[0].grade).toBe('صحيح');
    expect(result.hadiths[0].text).toContain('مَن غشَّنا');
    expect(result.hadiths[0].rank).toBe(3);
    expect(result.hadiths[1].rank).toBe(0);
    expect(result.hadiths[1].text.startsWith('إنَّ')).toBe(true);
    expect(result.moreUrl).toBe(
      'https://dorar.net/hadith/search?q=%D8%A7%D9%84%D8%B1%D8%A8%D8%A7&page=2',
    );
  });

  it('returns an empty list for an empty result page', () => {
    const result = parseDorarHtml('<div class="hadith"></div>', 'لا شيء');
    expect(result.hadiths).toEqual([]);
    expect(result.moreUrl).toBe(dorarSearchUrl('لا شيء'));
  });
});

describe('relevance', () => {
  it('normalizes diacritics, hamza and taa marbuta', () => {
    expect(normalizeArabic('الغَيبةِ')).toBe('الغيبه');
    expect(normalizeArabic('أَحكام')).toBe('احكام');
    expect(normalizeArabic('على')).toBe('علي');
  });

  it('prefers the exact topic over a morphological decoy', () => {
    const real = relevanceScore(
      'الغيبة',
      'اجتنابُ الغَيبةِ والنَّميمةِ',
      'كتابُ الآداب',
    );
    const decoy = relevanceScore(
      'الغيبة',
      'القضاءُ على الغائِبِ',
      'كتابُ القضاء',
    );
    expect(real).toBeGreaterThan(decoy);
    expect(decoy).toBe(0);
  });

  it('ignores question stop words', () => {
    expect(relevanceScore('ما حكم الغيبة', 'الغيبة')).toBe(
      relevanceScore('الغيبة', 'الغيبة'),
    );
  });
});

describe('queryWords', () => {
  it('keeps topic words and drops particles and question words', () => {
    expect(queryWords('ما حكم الغيبة؟')).toEqual(['حكم', 'الغيبه']);
    expect(queryWords('فضل الصلاة على النبي')).toEqual([
      'فضل',
      'الصلاه',
      'النبي',
    ]);
    expect(queryWords('')).toEqual([]);
  });
});

describe('matchesQuery', () => {
  it('accepts a hadith that carries the topic and most words', () => {
    expect(
      matchesQuery(
        'فضل الصلاة على النبي',
        'مَن صلَّى على النبيِّ صلاةً صلَّى اللهُ عليه بها عشراً',
      ),
    ).toBe(true);
  });

  it('rejects a hadith about a different topic that shares words', () => {
    expect(
      matchesQuery(
        'فضل الصلاة على النبي',
        'فضلُ الصلاةِ بالسواكِ على الصلاةِ بغيرِ سواكٍ',
      ),
    ).toBe(false);
  });

  it('rejects a hadith about a morphological decoy', () => {
    expect(matchesQuery('الغيبة', 'القضاءُ على الغائبِ')).toBe(false);
    expect(matchesQuery('الغيبة', 'الغَيبةُ محرَّمة')).toBe(true);
  });

  it('ignores diacritics and lets an empty query through', () => {
    expect(matchesQuery('الصلاة', 'الصَّلاةُ عمودُ الدين')).toBe(true);
    expect(matchesQuery('', 'أي نص')).toBe(true);
  });
});

describe('cleanItems', () => {
  it('drops dangling punctuation at the start of an excerpt', () => {
    const [item] = cleanItems([
      {
        text: '  )) للرُّحَيْباني (3/316). وذلك للآتي',
        meta: 'كتاب',
        url: 'https://dorar.net/feqhia/1',
      },
    ]);
    expect(item.text).toBe('للرُّحَيْباني (3/316). وذلك للآتي');
  });

  it('keeps dorar links, strips markup, dedupes and limits', () => {
    const items = cleanItems([
      {
        text: '  <span class="search-keys">الغَيبةِ</span>   محرّمة  ',
        meta: ' كتابُ الآداب - الفصلُ الأول ',
        url: 'https://dorar.net/aadab/1407',
      },
      {
        text: 'مكرر',
        meta: '',
        url: 'https://dorar.net/aadab/1407',
      },
      { text: 'خارج الموقع', meta: '', url: 'https://example.com/x' },
      { text: '', meta: '', url: 'https://dorar.net/aadab/9' },
      ...Array.from({ length: 20 }, (_, i) => ({
        text: `نتيجة ${i}`,
        meta: 'باب',
        url: `https://dorar.net/feqhia/${i}`,
      })),
    ]);
    expect(items).toHaveLength(12);
    expect(items[0]).toEqual({
      text: 'الغَيبةِ محرّمة',
      meta: 'كتابُ الآداب - الفصلُ الأول',
      url: 'https://dorar.net/aadab/1407',
    });
    expect(items.some((item) => item.url.includes('example.com'))).toBe(false);
  });

  it('returns nothing for malformed payloads', () => {
    expect(cleanItems(undefined)).toEqual([]);
    expect(cleanItems('x')).toEqual([]);
    expect(cleanItems([null, 1, 'a'])).toEqual([]);
  });
});

describe('gradeRank', () => {
  it('ranks authentic above hasan above unknown above weak', () => {
    expect(gradeRank('صحيح')).toBe(3);
    expect(gradeRank('حسن صحيح')).toBe(3);
    expect(gradeRank('حسن')).toBe(2);
    expect(gradeRank('أورده في كتاب المراسيل')).toBe(1);
    expect(gradeRank('ضعيف')).toBe(0);
    expect(gradeRank('إسناده ضعيف جداً')).toBe(0);
    expect(gradeRank('إسناده فيه ضعف')).toBe(0);
    expect(gradeRank('[لا يتطرق إليه احتمال التحسين]')).toBe(0);
  });
});

/* ------------------------------------------------------------------ */

function mockFetch(payload: unknown, ok = true) {
  const spy = vi.fn(async () => ({
    ok,
    json: async () => payload,
  }));
  vi.stubGlobal('fetch', spy);
  return spy;
}

const FIQH_ITEMS = [
  {
    text: 'الفصلُ الثالثُ: حُكمُ الغيبةِ في الشرعِ',
    meta: 'كتابُ الآدابِ - البابُ الأول',
    url: 'https://dorar.net/feqhia/10463',
  },
];

describe('collectResults', () => {
  const makeAnswer = (): Parameters<typeof collectResults>[0] => ({
    query: 'الغيبة',
    total: 40,
    moreUrl: 'https://dorar.net/hadith/search?q=x',
    hadiths: [],
    partial: false,
    sources: [
      {
        source: 'hadith',
        label: 'الموسوعة الحديثية',
        short: 'الحديث',
        ok: true,
        total: 3,
        moreUrl: 'https://dorar.net/hadith/search?q=x',
        items: [],
        hadiths: [
          {
            text: 'الغيبةُ محرَّمة',
            narrator: 'أبو هريرة',
            scholar: 'مسلم',
            source: 'صحيح مسلم',
            reference: '1',
            grade: 'صحيح',
            rank: 3,
          },
          {
            text: 'ذِكرُ الغيبةِ في المجلس',
            narrator: 'أبو هريرة',
            scholar: 'الترمذي',
            source: 'سنن الترمذي',
            reference: '2',
            grade: 'حسن',
            rank: 2,
          },
          {
            text: 'الغيبةُ أشدُّ من الزنا',
            narrator: 'أبو هريرة',
            scholar: 'الدارقطني',
            source: 'السنن',
            reference: '3',
            grade: 'إسناده ضعيف',
            rank: 0,
          },
        ],
      },
      {
        source: 'fiqh',
        label: 'الموسوعة الفقهية',
        short: 'الفقه',
        ok: true,
        total: 2,
        moreUrl: 'https://dorar.net/feqhia/search?q=x',
        hadiths: [],
        items: [
          { text: 'مقتطف فقهي', meta: 'كتاب الآداب', url: 'https://dorar.net/feqhia/1' },
          { text: 'مكرر', meta: 'كتاب الآداب', url: 'https://dorar.net/feqhia/1' },
        ],
      },
    ],
  });

  it('puts authentic and hasan first and drops weak hadiths', () => {
    const collected = collectResults(makeAnswer());
    expect(collected.hadiths.map((hadith) => hadith.grade)).toEqual([
      'صحيح',
      'حسن',
    ]);
    expect(collected.skippedWeak).toBe(1);
  });

  it('merges excerpts into one list without repeats', () => {
    const collected = collectResults(makeAnswer());
    expect(collected.excerpts).toHaveLength(1);
    expect(collected.excerpts[0].url).toBe('https://dorar.net/feqhia/1');
  });

  it('puts the excerpt that matches the topic first', () => {
    const answer = makeAnswer();
    answer.sources[1].items = [
      {
        text: 'القضاءُ على الغائِبِ إضاعةٌ للحقوق',
        meta: 'كتاب القضاء',
        url: 'https://dorar.net/feqhia/2',
      },
      {
        text: 'اجتنابُ الغَيبةِ والنَّميمةِ',
        meta: 'كتاب الآداب',
        url: 'https://dorar.net/feqhia/3',
      },
    ];
    const collected = collectResults(answer);
    expect(collected.excerpts[0].url).toBe('https://dorar.net/feqhia/3');
    // المقتطف الذي لا يذكر الموضوع يُستبعد حين يوجد ما يذكره.
    expect(collected.excerpts.map((item) => item.url)).toEqual([
      'https://dorar.net/feqhia/3',
    ]);
  });

  it('honours the display limits', () => {
    const collected = collectResults(makeAnswer(), 1, 1);
    expect(collected.hadiths).toHaveLength(1);
    expect(collected.excerpts).toHaveLength(1);
  });

  it('reports when only weak hadiths exist', () => {
    const answer = makeAnswer();
    answer.sources[0].hadiths = answer.sources[0].hadiths.filter(
      (hadith) => hadith.rank === 0,
    );
    const collected = collectResults(answer);
    expect(collected.hadiths).toEqual([]);
    expect(collected.skippedWeak).toBe(1);
  });
});

describe('askDorar', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('asks every encyclopedia and groups the answer by source', async () => {
    const spy = mockFetch({
      ok: true,
      query: 'حكم الغيبة',
      via: 'browser',
      sources: {
        hadith: { ok: true, label: 'الموسوعة الحديثية', total: 15, html: SAMPLE },
        fiqh: {
          ok: true,
          label: 'الموسوعة الفقهية',
          total: 30,
          url: 'https://dorar.net/feqhia/search?q=x&st=w',
          items: FIQH_ITEMS,
        },
        tafsir: { ok: true, label: 'موسوعة التفسير', total: 0, items: [] },
        aqeedah: { ok: true, label: 'الموسوعة العقدية', total: 51, items: [] },
        adab: { ok: true, label: 'موسوعة الآداب', total: 27, items: [] },
      },
    });

    const answer = await askDorar('ما حكم الغيبة؟');

    expect(spy).toHaveBeenCalledTimes(1);
    const url = String((spy.mock.calls[0] as unknown[])[0]);
    expect(url).toContain('q=%D8%A7%D9%84%D8%BA%D9%8A%D8%A8%D8%A9');
    expect(url).toContain('src=hadith,fiqh,tafsir,aqeedah,adab');

    expect(answer.sources).toHaveLength(5);
    expect(answer.sources.map((result) => result.source)).toEqual([
      'hadith',
      'fiqh',
      'tafsir',
      'aqeedah',
      'adab',
    ]);
    expect(answer.hadiths).toHaveLength(2);
    expect(answer.sources[1].items[0].url).toBe('https://dorar.net/feqhia/10463');
    expect(answer.sources[1].moreUrl).toBe('https://dorar.net/feqhia/search?q=x&st=w');
    expect(answer.sources[2].total).toBe(0);
    // العدد مجموع النتائج الكاملة لا المعروضة.
    expect(answer.total).toBe(15 + 30 + 0 + 51 + 27);
    expect(answer.partial).toBe(false);
    expect(answer.via).toBe('browser');
  });

  it('searches only the encyclopedias the user picked', async () => {
    const spy = mockFetch({
      ok: true,
      query: 'الغيبة',
      sources: { fiqh: { ok: true, total: 3, items: FIQH_ITEMS } },
    });
    const answer = await askDorar('الغيبة', ['fiqh']);
    expect(String((spy.mock.calls[0] as unknown[])[0])).toContain('src=fiqh');
    expect(answer.sources).toHaveLength(1);
    expect(answer.sources[0].source).toBe('fiqh');
    expect(answer.total).toBe(3);
  });

  it('falls back to every encyclopedia when the selection is empty', async () => {
    const spy = mockFetch({
      ok: true,
      query: 'الغيبة',
      sources: { hadith: { ok: true, total: 15, html: SAMPLE } },
    });
    const answer = await askDorar('الغيبة', []);
    expect(String((spy.mock.calls[0] as unknown[])[0])).toContain(
      'src=hadith,fiqh,tafsir,aqeedah,adab',
    );
    expect(answer.sources).toHaveLength(5);
  });

  it('keeps working sources when one encyclopedia fails', async () => {
    mockFetch({
      ok: true,
      query: 'حكم الغيبة',
      sources: {
        hadith: { ok: true, total: 15, html: SAMPLE },
        fiqh: { ok: false, error: 'status-403' },
      },
    });
    const answer = await askDorar('ما حكم الغيبة؟', ['hadith', 'fiqh']);
    expect(answer.partial).toBe(true);
    expect(answer.sources[1].ok).toBe(false);
    expect(answer.sources[1].error).toBe('status-403');
    expect(answer.total).toBe(15);
  });

  it('throws when every encyclopedia fails', async () => {
    mockFetch({
      ok: true,
      query: 'x',
      sources: { hadith: { ok: false, error: 'status-403' } },
    });
    await expect(askDorar('ما حكم الغيبة؟', ['hadith'])).rejects.toBeInstanceOf(
      DorarError,
    );
  });

  it('still reads the legacy single-encyclopedia payload', async () => {
    mockFetch({ ok: true, query: 'الربا', html: SAMPLE, via: 'browser' });
    const answer = await askDorar('ما حكم الربا؟', ['hadith']);
    expect(answer.sources).toHaveLength(1);
    expect(answer.hadiths).toHaveLength(2);
    expect(answer.partial).toBe(false);
  });

  it('rejects a too-short query before any request', async () => {
    const spy = mockFetch({ ok: true });
    await expect(askDorar('ه')).rejects.toMatchObject({ code: 'query-too-short' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('maps a network failure to a DorarError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('failed');
    }));
    await expect(askDorar('ما حكم الغيبة؟')).rejects.toMatchObject({
      code: 'network',
    });
  });
});
