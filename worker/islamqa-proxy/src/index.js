/**
 * وسيط قراءة صغير بين تطبيق «تدبّر» وموقع IslamQA (islamqa.info).
 *
 * الموقع يوفّر واجهة JSON عامة للبحث عن الإجابات، لكنه لا يرسل ترويسة CORS،
 * لذلك لا يستطيع المتصفح قراءتها مباشرة من نطاق آخر. هذا العامل يقرأ الواجهة
 * من الخادم ويعيد نتائج بسيطة: عنوان السؤال ونصّه ونصّ الجواب ورابط المادة.
 *
 * لا يُنشئ العامل أي جواب، ولا يستخدم نموذجاً لغوياً، ولا يحفظ بيانات السائل.
 * كل ما يعيده هو نقل حرفي لما نشره الموقع. النتائج تُخزَّن في حافة Cloudflare
 * يوماً كاملاً حتى لا يتكرر البحث نفسه.
 *
 * النشر: `npx wrangler deploy` من هذا المجلد، ثم ضبط VITE_ISLAMQA_WORKER_URL
 * في إعدادات بناء التطبيق على الرابط الذي يظهره Wrangler.
 */

const SITE = 'https://islamqa.info';
/** النطاقات التي يُسمح لها بقراءة العامل من المتصفح. */
const ALLOWED_ORIGINS = new Set([
  'https://orabi20266.github.io',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
]);
/** عدد الإجابات التي تُجلب من أعلى نتائج البحث. */
const MAX_RESULTS = 6;

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  try {
    const url = new URL(origin);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (!local) return false;
    // Capacitor يفتح الحزمة من capacitor://localhost على iOS وhttp على أندرويد.
    return (
      url.protocol === 'http:' ||
      url.protocol === 'https:' ||
      url.protocol === 'capacitor:' ||
      url.protocol === 'ionic:'
    );
  } catch {
    return false;
  }
}

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

function searchUrl(query) {
  const params = new URLSearchParams({
    lang: 'ar',
    limit: '12',
    searchType: 'answer',
    query,
  });
  return `${SITE}/api/search?${params.toString()}`;
}

function postUrl(id) {
  return `${SITE}/api/posts/answer/${encodeURIComponent(String(id))}?lang=ar`;
}

function publicUrl(id) {
  return `${SITE}/ar/answers/${id}`;
}

async function getJson(url) {
  const response = await fetch(url, {
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`upstream ${response.status}`);
  return response.json();
}

function text(value) {
  return typeof value === 'string' ? value : '';
}

/** إجابة واحدة بالشكل الذي يستهلكه التطبيق. النصوص كما وردت من الموقع. */
function shape(post) {
  const id = Number(post?.id ?? post?.reference);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return {
    id,
    title: text(post.title),
    question: text(post.question),
    body: text(post.body),
    url: publicUrl(id),
  };
}

async function readAnswers(query) {
  const payload = await getJson(searchUrl(query));
  const found = payload?.Search?.results;
  if (!Array.isArray(found)) throw new Error('upstream-shape');

  const ids = [
    ...new Set(
      found
        .map((item) => Number(item?.id ?? item?.reference))
        .filter((id) => Number.isSafeInteger(id) && id > 0),
    ),
  ].slice(0, MAX_RESULTS);
  if (!ids.length) return { results: [], total: 0 };

  const settled = await Promise.allSettled(ids.map((id) => getJson(postUrl(id))));
  const results = [];
  for (const outcome of settled) {
    if (outcome.status !== 'fulfilled') continue;
    const answer = shape(outcome.value);
    if (answer && (answer.title || answer.body)) results.push(answer);
  }
  if (!results.length) throw new Error('upstream-empty');

  const total = Number(payload?.Search?.total);
  return {
    results,
    total: Number.isFinite(total) && total >= 0 ? total : results.length,
  };
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
      return json({ ok: true, source: SITE }, 200, cors);
    }

    const query = cleanQuery(url.searchParams.get('q'));
    if (query.length < 2) {
      return json({ ok: false, error: 'query-too-short' }, 400, cors);
    }

    // ذاكرة الحافة: نفس السؤال لا يُجلب من الموقع مرتين في اليوم.
    const cache = caches.default;
    const cacheKey = new Request(
      `https://tadabbur-islamqa.internal/v1/search?q=${encodeURIComponent(query)}`,
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
      found = await readAnswers(query);
    } catch {
      return json({ ok: false, error: 'upstream-blocked' }, 502, cors);
    }

    const body = {
      ok: true,
      source: SITE,
      query,
      total: found.total,
      fetchedAt: Date.now(),
      results: found.results,
    };
    const response = new Response(JSON.stringify(body), {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Cache-Control': 'public, max-age=86400',
        'X-Content-Type-Options': 'nosniff',
        ...cors,
      },
    });
    ctx.waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  },
};
