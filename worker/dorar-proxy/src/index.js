/**
 * وسيط قراءة صغير بين تطبيق «تدبّر» وموقع الدرر السنية.
 *
 * السبب: dorar.net لا يسمح للمتصفحات بجلب صفحاته من نطاق آخر، وحماية
 * Cloudflare لديه تردّ طلبات العمال السحابية المباشرة (403). لذلك يفتح العامل
 * متصفح Cloudflare (Browser Rendering) ويقرأ النتائج كما يقرأها متصفح حقيقي،
 * ثم يعيدها JSON مع سماح CORS.
 *
 * يدعم عدة موسوعات: الحديثية، والفقهية، والتفسير، والعقدية، والآداب. الحديث
 * يُقرأ من واجهة `dorar_api.json` (نصّ الحديث والراوي والمحدّث والمصدر والحكم)،
 * وبقية الموسوعات من صفحات البحث نفسها (عنوان المقتطف وسطر الموضع ورابط المادة).
 *
 * لا يحفظ شيئاً عن السائل، ولا يحتاج مفتاحاً. النتائج تُخزَّن في حافة Cloudflare
 * يوماً كاملاً، فلا يتكرر البحث نفسه ولا يُستهلك من رصيد المتصفح إلا مرة.
 *
 * النشر: `npx wrangler deploy` من هذا المجلد.
 */

import puppeteer from '@cloudflare/puppeteer';

const DORAR = 'https://dorar.net/dorar_api.json';
const SITE = 'https://dorar.net';
const ALLOWED_ORIGINS = new Set([
  'https://orabi20266.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36';

/**
 * `path` هو مسار الموسوعة في الموقع، و`label` اسمعا كما يظهر في الواجهة.
 * مفتاح كل مصدر هو نفسه الذي يرسله التطبيق في `src`.
 */
const SOURCES = {
  hadith: { path: 'hadith', label: 'الموسوعة الحديثية' },
  fiqh: { path: 'feqhia', label: 'الموسوعة الفقهية' },
  tafsir: { path: 'tafseer', label: 'موسوعة التفسير' },
  aqeedah: { path: 'aqeeda', label: 'الموسوعة العقدية' },
  adab: { path: 'aadab', label: 'موسوعة الآداب' },
};
/** العملاء القدامى لا يرسلون `src`، وكانوا يطلبون الحديث وحده. */
const DEFAULT_SOURCES = ['hadith'];

/** نطاق الإنتاج، وأي منفذ محلي للتطوير ونسخة سطح المكتب. */
function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    return (
      (url.protocol === 'http:' || url.protocol === 'https:') &&
      (url.hostname === 'localhost' || url.hostname === '127.0.0.1')
    );
  } catch {
    return false;
  }
}

/** رؤوس CORS: النطاق المعروف فقط، ومن دون بيانات اعتماد. */
function corsHeaders(origin) {
  const allowed = isAllowedOrigin(origin)
    ? origin
    : 'https://orabi20266.github.io';
  return {
    'Access-Control-Allow-Origin': allowed,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Accept, Content-Type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

/** يمنع حقن HTML/رموز تحكّم في استعلام يُمرَّر إلى الخدمة. */
function cleanQuery(raw) {
  return (raw ?? '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** قائمة المصادر المطلوبة، مرتّبة وبدون تكرار ومع تجاهل المجهول. */
function parseSources(raw) {
  const asked = (raw ?? '')
    .split(',')
    .map((value) => value.trim())
    .filter(Boolean);
  if (!asked.length) return DEFAULT_SOURCES;
  const known = [...new Set(asked.filter((key) => key in SOURCES))];
  return known.length ? known : DEFAULT_SOURCES;
}

function json(body, status, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
      ...extra,
    },
  });
}

/** يستخرج `ahadith.result` من جسم واجهة الدرر. */
function resultFromPayload(payload) {
  const result = payload?.ahadith?.result;
  return typeof result === 'string' ? result : null;
}

/**
 * رابط بحث الموسوعة. `st=w` يجعل البحث عن «جميع الكلمات»، وهو الافتراضي في
 * واجهة الموقع لكنه ليس الافتراضي في الرابط: بدونه يصير البحث «أي كلمة»
 * فتُغرق النتائج (٢١٣٧ نتيجة لـ«حكم الغيبة» بدل ١٥). و`sc=a` يبحث في الفهرس
 * والمحتوى كما يفعل زر الموقع.
 */
function searchUrl(source, query) {
  return `${SITE}/${SOURCES[source].path}/search?q=${encodeURIComponent(
    query,
  )}&st=w&sc=a`;
}

async function openPage(browser) {
  const page = await browser.newPage();
  await page.setUserAgent(UA);
  await page.setExtraHTTPHeaders({ 'Accept-Language': 'ar,en;q=0.8' });
  await page.setViewport({ width: 1280, height: 900 });
  return page;
}

/**
 * يقرأ الموسوعة الحديثية من واجهتها: صفحة JSON تُعرض في المتصفح، ويُقرأ
 * نصّها ثم يُفكّ. أي ردّ غير JSON أو بلا `ahadith.result` يُعدّ فشلاً.
 */
async function readHadith(page, query) {
  const target = `${DORAR}?skey=${encodeURIComponent(query)}`;
  const response = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  const status = response?.status() ?? 0;
  if (status !== 200) throw new Error(`status-${status}`);
  const text = await page.evaluate(() => document.body.innerText);
  const html = resultFromPayload(JSON.parse(text));
  if (html === null) throw new Error('shape');
  return { html, total: countHadiths(html) };
}

/** عدد الأحاديث في نتيجة الواجهة (كل حديث يبدأ بـ`<div class="hadith">`). */
function countHadiths(html) {
  return (html.match(/<div class="hadith"/g) ?? []).length;
}

/**
 * يقرأ صفحة بحث أي موسوعة أخرى. صفحات البحث كلها تعرض النتائج في
 * `article.border-bottom`: عنوان المقتطف داخل `h5`، وسطر الموضع في
 * `span.text-muted`، ورابط المادة في `a`. يُستخرج العدد الكلي أيضًا.
 */
async function readSection(page, source, query) {
  const target = searchUrl(source, query);
  const response = await page.goto(target, {
    waitUntil: 'domcontentloaded',
    timeout: 25000,
  });
  const status = response?.status() ?? 0;
  if (status !== 200) throw new Error(`status-${status}`);

  const data = await page.evaluate(() => {
    const items = [...document.querySelectorAll('article.border-bottom')]
      .slice(0, 12)
      .map((article) => {
        const link = article.querySelector('a[href]');
        const heading = article.querySelector('h5');
        const place = article.querySelector('span.text-muted');
        let url = link?.getAttribute('href') ?? '';
        if (url.startsWith('/')) url = `https://dorar.net${url}`;
        return {
          text: (heading?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          meta: (place?.innerText ?? '').replace(/\s+/g, ' ').trim(),
          url,
        };
      })
      .filter((item) => item.text && item.url);

    const marker = (document.body.innerText ?? '').match(
      /عدد النتائج\s*\(?\s*([\d٠-٩,]+)/,
    );
    return { items, total: marker ? marker[1] : '' };
  });

  const total = toNumber(data.total);
  const items = data.items.map((item) => ({
    ...item,
    // الصفحة ترقّم النتائج «1 - …» وهذا ليس جزءًا من النص.
    text: item.text.replace(/^\s*\d+\s*[-–—]\s*/, ''),
  }));
  return { items, total: total || items.length };
}

/** يحوّل الأرقام العربية الهندية إلى لاتينية ويزيل الفواصل. */
function toNumber(value) {
  const digits = String(value ?? '')
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

/**
 * يفتح متصفحاً واحداً ويقرأ كل المصادر المطلوبة في الجلسة نفسها. فشل مصدر لا
 * يُسقط الباقي: تُعاد النتائج المتاحة مع حالة لكل مصدر.
 */
async function readSources(env, sources, query) {
  if (!env.BROWSER) throw new Error('no-browser');
  const browser = await puppeteer.launch(env.BROWSER);
  const results = {};
  try {
    let page = await openPage(browser);
    for (const source of sources) {
      try {
        const data =
          source === 'hadith'
            ? await readHadith(page, query)
            : await readSection(page, source, query);
        results[source] = { ok: true, ...data };
      } catch {
        // حماية الدرر قد تتحدّى الصفحة الأولى؛ محاولة واحدة ثانية كافية.
        try {
          await page.close().catch(() => {});
          page = await openPage(browser);
          const data =
            source === 'hadith'
              ? await readHadith(page, query)
              : await readSection(page, source, query);
          results[source] = { ok: true, ...data };
        } catch (error) {
          results[source] = {
            ok: false,
            error: String(error).slice(0, 60) || 'upstream',
          };
        }
      }
    }
    return results;
  } finally {
    await browser.close().catch(() => {});
  }
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') ?? '';
    const cors = corsHeaders(origin);

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method !== 'GET') {
      return json({ ok: false, error: 'method' }, 405, cors);
    }

    const url = new URL(request.url);
    if (url.pathname === '/health') {
      return json({ ok: true, browser: Boolean(env.BROWSER) }, 200, cors);
    }

    const query = cleanQuery(url.searchParams.get('q'));
    if (query.length < 2) {
      return json({ ok: false, error: 'query-too-short' }, 400, cors);
    }
    const sources = parseSources(url.searchParams.get('src'));

    // ذاكرة الحافة: السؤال نفسه لا يُجلب من الدرر مرتين في اليوم.
    const cache = caches.default;
    const cacheKey = new Request(
      // رقم النسخة يتغيّر كلما تغيّرت طريقة القراءة، كي لا تُخدم نتيجة قديمة.
      `https://tadabbur-dorar.internal/v2/search?q=${encodeURIComponent(query)}&src=${sources.join(',')}`,
    );
    const hit = await cache.match(cacheKey);
    if (hit) {
      return new Response(hit.body, {
        status: 200,
        headers: {
          'Content-Type': 'application/json; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff',
          ...cors,
        },
      });
    }

    let found;
    try {
      found = await readSources(env, sources, query);
    } catch {
      return json({ ok: false, error: 'upstream-blocked' }, 502, cors);
    }

    const payloadSources = {};
    for (const source of sources) {
      const result = found[source];
      payloadSources[source] = result.ok
        ? {
            ok: true,
            label: SOURCES[source].label,
            total: result.total,
            url: searchUrl(source, query),
            ...(source === 'hadith'
              ? { html: result.html }
              : { items: result.items }),
          }
        : { ok: false, error: result.error };
    }

    const anyOk = sources.some((source) => payloadSources[source].ok);
    if (!anyOk) {
      return json({ ok: false, error: 'upstream-blocked' }, 502, cors);
    }
    const allOk = sources.every((source) => payloadSources[source].ok);

    const body = {
      ok: true,
      query,
      via: 'browser',
      fetchedAt: Date.now(),
      sources: payloadSources,
      // توافق خلفي: العملاء السابقة تقرأ `html` وتتوقع نتيجة الحديث وحدها.
      ...(payloadSources.hadith?.html ? { html: payloadSources.hadith.html } : {}),
    };
    const response = new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        // لا تُخزَّن نتيجة ناقصة كي تُستكمل في المحاولة التالية.
        'Cache-Control': allOk
          ? 'public, max-age=86400'
          : 'no-store',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
      },
    });
    if (allOk) ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
