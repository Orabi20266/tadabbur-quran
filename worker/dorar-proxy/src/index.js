/**
 * وسيط قراءة صغير بين تطبيق «تدبّر» وموقع الدرر السنية.
 *
 * السبب: dorar.net لا يسمح للمتصفحات بجلب `dorar_api.json` من نطاق آخر،
 * وحماية Cloudflare لديه تردّ طلبات العمال السحابية المباشرة. لذلك يفتح العامل
 * متصفح Cloudflare (Browser Rendering) ويقرأ النتيجة كما يقرأها متصفح حقيقي،
 * ثم يعيدها JSON مع سماح CORS.
 *
 * لا يحفظ شيئاً عن السائل، ولا يحتاج مفتاحاً. النتائج تُخزَّن في حافة Cloudflare
 * يوماً كاملاً، فلا يتكرر البحث نفسه ولا يُستهلك من رصيد المتصفح إلا مرة.
 *
 * النشر: `npx wrangler deploy` من هذا المجلد.
 */

import puppeteer from '@cloudflare/puppeteer';

const DORAR = 'https://dorar.net/dorar_api.json';
const READER = 'https://r.jina.ai/';
const ALLOWED_ORIGINS = new Set([
  'https://orabi20266.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);

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
 * يقرأ الواجهة через متصفح Cloudflare. صفحة التحدي أو أي ردّ غير JSON
 * تُعدّ فشلاً، فلا يُنسب إلى الدرر ما لم يقله.
 */
async function fetchViaBrowser(env, query) {
  if (!env.BROWSER) throw new Error('no-browser');
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    let last = 'empty';
    // حماية الدرر قد تتحدى الجلسة أحياناً؛ محاولة ثانية بصفحة جديدة تحلّ
    // معظم الحالات من دون إثقال الموقع.
    for (let attempt = 1; attempt <= 2; attempt++) {
      const page = await browser.newPage();
      try {
        await page.setUserAgent(
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
        );
        await page.setExtraHTTPHeaders({
          'Accept-Language': 'ar,en;q=0.8',
          Referer: 'https://dorar.net/hadith/search',
        });
        const target = `${DORAR}?skey=${encodeURIComponent(query)}`;
        const response = await page.goto(target, {
          waitUntil: 'domcontentloaded',
          timeout: 25000,
        });
        const status = response?.status() ?? 0;
        if (status === 200) {
          const text = await page.evaluate(() => document.body.innerText);
          const result = resultFromPayload(JSON.parse(text));
          if (result !== null) return result;
          last = 'shape';
        } else {
          last = `status-${status}`;
        }
      } catch (error) {
        last = String(error).slice(0, 80);
      } finally {
        await page.close().catch(() => {});
      }
      await new Promise((done) => setTimeout(done, 700));
    }
    throw new Error(last);
  } finally {
    await browser.close();
  }
}

/** نتيجة قارئ r.jina.ai: ترويسة نصية ثم JSON خام. */
function parseReaderBody(text) {
  const marker = text.lastIndexOf('Markdown Content:');
  const raw = marker >= 0 ? text.slice(marker + 'Markdown Content:'.length) : text;
  const start = raw.indexOf('{');
  if (start < 0) return null;
  try {
    return JSON.parse(raw.slice(start));
  } catch {
    return null;
  }
}

async function fetchViaReader(env, query) {
  const target = `${DORAR}?skey=${encodeURIComponent(query)}`;
  const headers = { Accept: 'text/plain' };
  if (env.JINA_API_KEY) headers.Authorization = `Bearer ${env.JINA_API_KEY}`;
  const response = await fetch(`${READER}${target}`, {
    headers,
    signal: AbortSignal.timeout(25000),
  });
  if (!response.ok) throw new Error(`reader ${response.status}`);
  const result = resultFromPayload(parseReaderBody(await response.text()));
  if (result === null) throw new Error('reader shape');
  return result;
}

/** محاولة مباشرة احتياطية إن تغيّرت سياسة الدرر يوماً. */
async function fetchDirect(query) {
  const response = await fetch(`${DORAR}?skey=${encodeURIComponent(query)}`, {
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'ar,en;q=0.8',
      Referer: 'https://dorar.net/hadith/search',
      'User-Agent':
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/152.0.0.0 Safari/537.36',
    },
    signal: AbortSignal.timeout(15000),
  });
  const type = response.headers.get('content-type') ?? '';
  if (!response.ok || !type.includes('json')) {
    throw new Error(`direct ${response.status}`);
  }
  const result = resultFromPayload(await response.json());
  if (result === null) throw new Error('direct shape');
  return result;
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

    // ذاكرة الحافة: السؤال نفسه لا يُجلب من الدرر مرتين في اليوم.
    const cache = caches.default;
    const cacheKey = new Request(
      `https://tadabbur-dorar.internal/search?q=${encodeURIComponent(query)}`,
    );
    let hit = await cache.match(cacheKey);
    if (!hit) {
      let html;
      let via = 'browser';
      try {
        html = await fetchViaBrowser(env, query);
      } catch {
        via = 'reader';
        try {
          html = await fetchViaReader(env, query);
        } catch {
          via = 'direct';
          try {
            html = await fetchDirect(query);
          } catch {
            return json({ ok: false, error: 'upstream-blocked' }, 502, cors);
          }
        }
      }

      hit = new Response(
        JSON.stringify({ ok: true, query, html, via, fetchedAt: Date.now() }),
        {
          headers: {
            'Content-Type': 'application/json; charset=utf-8',
            'Cache-Control': 'public, max-age=86400',
          },
        },
      );
      ctx.waitUntil(cache.put(cacheKey, hit.clone()));
    }

    return new Response(hit.body, {
      status: 200,
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
      },
    });
  },
};
