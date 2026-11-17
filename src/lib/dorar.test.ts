import { describe, expect, it } from 'vitest';
import {
  decodeEntities,
  dorarQuery,
  dorarSearchUrl,
  gradeRank,
  htmlToText,
  parseDorarHtml,
  parseHadithInfo,
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
    expect(dorarQuery('ما حكم الغيبة؟')).toBe('حكم الغيبة');
    expect(dorarQuery('ما هو فضل الصلاة على النبي')).toBe(
      'فضل الصلاة على النبي',
    );
    expect(dorarQuery('هل يجوز الربا')).toBe('يجوز الربا');
    expect(dorarQuery('أريد أن أعرف حكم الغيبة')).toBe('حكم الغيبة');
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
    expect(dorarQuery('ما حكم <b>الغيبة</b>')).toBe('حكم الغيبة');
  });

  it('builds a search link', () => {
    expect(dorarSearchUrl('حكم الغيبة')).toBe(
      'https://dorar.net/hadith/search?q=%D8%AD%D9%83%D9%85%20%D8%A7%D9%84%D8%BA%D9%8A%D8%A8%D8%A9',
    );
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
