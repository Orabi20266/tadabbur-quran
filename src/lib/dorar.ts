/**
 * محادثة الدرر السنية.
 *
 * الموقع لا يسمح للمتصفح بقراءة صفحاته من نطاق آخر، فيمرّ الطلب عبر عامل
 * Cloudflare صغير (`worker/dorar-proxy`) يفتح متصفحاً حقيقياً ويقرأ النتيجة.
 * يدعم العامل خمس موسوعات: الحديثية والفقهية والتفسير والعقدية والآداب.
 *
 * هذا الملف يبني استعلاماً مناسباً من سؤال المستخدم، ثم يفكّ ما يعيده العامل
 * إلى نتائج مرتّبة منسوبة إلى الدرر، بلا اختراع أي جواب ولا صياغة حكم.
 */

const WORKER_URL = 'https://tadabbur-dorar.bnanbrand.workers.dev';
const DORAR_SEARCH = 'https://dorar.net/hadith/search';

/** موسوعات الدرر التي يبحث فيها العامل. */
export type DorarSource = 'hadith' | 'fiqh' | 'tafsir' | 'aqeedah' | 'adab';

export interface DorarSourceMeta {
  key: DorarSource;
  /** اسم الموسوعة كما تكتبه الدرر. */
  label: string;
  /** اسم قصير لرقاقة التصفية. */
  short: string;
  /** مسار الموسوعة في الموقع. */
  path: string;
}

export const DORAR_SOURCES: DorarSourceMeta[] = [
  { key: 'hadith', label: 'الموسوعة الحديثية', short: 'الحديث', path: 'hadith' },
  { key: 'fiqh', label: 'الموسوعة الفقهية', short: 'الفقه', path: 'feqhia' },
  { key: 'tafsir', label: 'موسوعة التفسير', short: 'التفسير', path: 'tafseer' },
  { key: 'aqeedah', label: 'الموسوعة العقدية', short: 'العقيدة', path: 'aqeeda' },
  { key: 'adab', label: 'موسوعة الآداب', short: 'الآداب', path: 'aadab' },
];

/** كل الموسوعات: سلوك المحادثة الافتراضي. */
export const DEFAULT_SOURCES: DorarSource[] = DORAR_SOURCES.map(
  (source) => source.key,
);

export function sourceMeta(key: DorarSource): DorarSourceMeta {
  return DORAR_SOURCES.find((source) => source.key === key) ?? DORAR_SOURCES[0];
}

export interface DorarHadith {
  text: string;
  narrator: string;
  scholar: string;
  source: string;
  reference: string;
  /** حكم المحدث كما كتبه الدرر، بلا تعديل. */
  grade: string;
  /** 0 ضعيف · 1 غير محدّد · 2 حسن · 3 صحيح. */
  rank: number;
}

/** مقتطف من موسوعة غير حديثية: نصّ النتيجة وسطر الموضع ورابط المادة. */
export interface DorarItem {
  text: string;
  /** الكتاب والباب أو السورة والآية. */
  meta: string;
  /** رابط المادة كاملة في الدرر. */
  url: string;
}

/** نتيجة موسوعة واحدة، بنجاحها أو بخطئها. */
export interface DorarSourceResult {
  source: DorarSource;
  label: string;
  short: string;
  ok: boolean;
  /** العدد الكامل في الموسوعة، لا المعروض. */
  total: number;
  /** رابط البحث الكامل في هذه الموسوعة. */
  moreUrl: string;
  /** أحاديث الموسوعة الحديثية (فارغة لغيرها). */
  hadiths: DorarHadith[];
  /** مقتطفات بقية الموسوعات (فارغة للحديثية). */
  items: DorarItem[];
  error?: string;
}

export interface DorarAnswer {
  /** الاستعلام الذي أُرسل إلى الدرر. */
  query: string;
  /** الموسوعات التي جُرّبت، مرتّبة كترتيب الواجهة. */
  sources: DorarSourceResult[];
  /** مجموع النتائج في كل الموسوعات (بالعدد الكامل). */
  total: number;
  /** رابط نتائج الحديث الكاملة في الدرر. */
  moreUrl: string;
  /** أحاديث الموسوعة الحديثية وحدها، للتوافق مع العرض القديم. */
  hadiths: DorarHadith[];
  /** هل تعذّر بعض المصادر؟ تُعرض ملاحظة صريحة حينها. */
  partial: boolean;
  /** كيف جلب العامل النتيجة. */
  via?: string;
}

export class DorarError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = 'DorarError';
    this.code = code;
  }
}

/* ------------------------------------------------------------------ */
/* تنظيف السؤال                                                        */
/* ------------------------------------------------------------------ */

/**
 * ألفاظ الاستفهام والمجاملات التي لا تفيد محرك بحث الدرر. تُزال من البداية
 * فقط، ولا تُمسّ كلمات الموضوع نفسها («حكم»، «فضل»، «الغيبة»).
 */
const LEADING_FILLER =
  /^(?:لو\s+سمحت|من\s+فضلك|أرجو\s+أن|ارجو\s+ان|أريد\s+أن\s+أعرف|اريد\s+ان\s+اعرف|أريد\s+معرفة|اريد\s+معرفة|أريد\s+أن|اريد\s+ان|أخبرني\s+عن|اخبرني\s+عن|حدثني\s+عن|أخبرني|اخبرني|حدثني|اذكر\s+لي|اذكر|بيّن\s+لي|بين\s+لي|ما|ماذا|هل|كيف|لماذا|أين|اين|متى|هو|هي)\s+/u;

/** ألفاظ حكم عامة تُحذف من أول الاستعلام إن بقي بعده موضوع. */
const GENERIC_LEAD = /^(?:حكم|حُكم|حكمه|حكمها|أحكام|احكام|بيان|تعريف)\s+/u;

/**
 * حوّل سؤال المستخدم إلى استعلام بحث قصير.
 *
 * «ما حكم الغيبة؟» ← «حكم الغيبة»، و«ما هو فضل الصلاة على النبي» ← «فضل
 * الصلاة على النبي». إن لم يبقَ شيء بعد التنظيف يُعاد السؤال كما هو حتى لا
 * يضيع المعنى.
 */
export function dorarQuery(question: string): string {
  const original = question
    .replace(/<[^>]*>/g, ' ')
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!original) return '';

  let query = original
    .replace(/[؟?!.،,؛;:]+$/u, '')
    .replace(/^[«"'()\s]+|[»"'()\s]+$/gu, '')
    .trim();

  // قد تتراكم أكثر من مقدمة: «ما هو …» ثم «هو …».
  for (let pass = 0; pass < 3; pass += 1) {
    const next = query.replace(LEADING_FILLER, '').trim();
    if (next === query) break;
    query = next;
  }

  query = query.replace(/[؟?!.،,؛;:]+$/u, '').trim();

  // «حكم الغيبة» يُبحث عنه بـ«الغيبة»: محرك الدرر يطابق الجذور، فكلمة «حكم»
  // تجلب «الحُكم على الغائب» وتُزيح موضوع السؤال. تُحذف فقط إن بقي موضوع.
  const topical = query.replace(GENERIC_LEAD, '').trim();
  if (topical.length >= 3) query = topical;

  if (query.length < 2) return original;
  return query.split(/\s+/).slice(0, 12).join(' ').slice(0, 120);
}


/** رابط البحث في موسوعة بعينها، بنفس المعاملات التي يستخدمها العامل. */
export function dorarSourceUrl(source: DorarSource, query: string): string {
  const { path } = sourceMeta(source);
  return `https://dorar.net/${path}/search?q=${encodeURIComponent(
    query,
  )}&st=w&sc=a`;
}

/** رابط البحث في الموسوعة الحديثية (الافتراضي في الموقع). */
export function dorarSearchUrl(query: string): string {
  return `${DORAR_SEARCH}?q=${encodeURIComponent(query)}`;
}

/* ------------------------------------------------------------------ */
/* قراءة نتيجة الدرر                                                   */
/* ------------------------------------------------------------------ */

const ENTITIES: Record<string, string> = {
  '&nbsp;': ' ',
  '&#160;': ' ',
  '&amp;': '&',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&lt;': '<',
  '&gt;': '>',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;|&#160;|&amp;|&quot;|&#39;|&apos;|&lt;|&gt;/gi, (entity) => {
      return ENTITIES[entity.toLowerCase()] ?? entity;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCodePoint(Number.parseInt(dec, 10)),
    );
}

/** نص خالٍ من الوسوم، بمسافات منظّمة. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, ' ')
      .replace(/<\/(?:p|div|span|li)>/gi, ' ')
      .replace(/<[^>]*>/g, ' '),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * درجة الحديث من نصّ الحكم. الترتيب للعرض فقط، والحكم نفسه يبقى نصّ الدرر
 * حرفياً. الضعيف يُعرض أخيراً ولا يُحذف، حتى يرى السائل ما قاله المحدّثون.
 */
export function gradeRank(grade: string): number {
  const text = grade.replace(/[\[\]()]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!text || /^-+$/.test(text)) return 1;
  if (
    /ضعيف|ضعف|واه|منكر|باطل|موضوع|متروك|لا\s+يصح|لا\s+يثبت|لا\s+يتطرق|ساقط|معلول|شاذ/.test(
      text,
    )
  ) {
    return 0;
  }
  if (/صحيح/.test(text)) return 3;
  if (/حسن/.test(text)) return 2;
  return 1;
}

const INFO_LABELS =
  /(خلاصة حكم المحدث|الصفحة أو الرقم|الموسوعة|الراوي|المحدث|المصدر)\s*:/gu;

function cleanValue(value: string): string {
  return value
    .replace(/^[\s:،,.\-–—]+|[\s:،,.\-–—]+$/gu, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** يفكّ `.hadith-info` إلى حقول مسمّاة. */
export function parseHadithInfo(html: string): Record<string, string> {
  const text = htmlToText(html);
  const matches = [...text.matchAll(INFO_LABELS)];
  const fields: Record<string, string> = {};
  for (let i = 0; i < matches.length; i += 1) {
    const label = matches[i][1];
    const start = (matches[i].index ?? 0) + matches[i][0].length;
    const end = matches[i + 1]?.index ?? text.length;
    fields[label] = cleanValue(text.slice(start, end));
  }
  return fields;
}

function uniqueByText(hadiths: DorarHadith[]): DorarHadith[] {
  const seen = new Set<string>();
  const out: DorarHadith[] = [];
  for (const hadith of hadiths) {
    const key = `${hadith.text}|${hadith.reference}|${hadith.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(hadith);
  }
  return out;
}

export function parseDorarHtml(
  html: string,
  fallbackQuery = '',
): Pick<DorarAnswer, 'hadiths' | 'moreUrl'> {
  const texts = [
    ...html.matchAll(/<div class="hadith"[^>]*>([\s\S]*?)<\/div>/gi),
  ].map((match) => match[1]);
  const infos = [
    ...html.matchAll(/<div class="hadith-info">([\s\S]*?)<\/div>/gi),
  ].map((match) => match[1]);

  const hadiths: DorarHadith[] = [];
  for (let i = 0; i < texts.length; i += 1) {
    const text = htmlToText(texts[i]).replace(/^\d+\s*[-–—.]\s*/, '').trim();
    if (!text) continue;
    const info = parseHadithInfo(infos[i] ?? '');
    const grade = info['خلاصة حكم المحدث'] ?? '';
    hadiths.push({
      text,
      narrator: info['الراوي'] ?? '',
      scholar: info['المحدث'] ?? '',
      source: info['المصدر'] ?? '',
      reference: info['الصفحة أو الرقم'] ?? '',
      grade,
      rank: gradeRank(grade),
    });
  }

  const sorted = uniqueByText(hadiths).sort((a, b) => b.rank - a.rank);

  const more = html.match(
    /<a[^>]+href="([^"]+)"[^>]*>[^<]*المزيد[^<]*<\/a>/i,
  );
  const moreUrl = more
    ? decodeEntities(more[1])
    : dorarSearchUrl(fallbackQuery);

  return { hadiths: sorted, moreUrl };
}

/**
 * تطبيع للمقارنة فقط: بلا تشكيل ولا همزات ولا تاء مربوطة، حتى يُقارن
 * «الغَيبةِ» بـ«الغيبة».
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[\u064B-\u0652\u0670\u0640]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// تُطبَّع الكلمات مثل النصّ نفسه، حتى تُقارن «على» بـ«علي» بعد تطبيع الألف
// المقصورة، و«هذه» بـ«هذه» بعد تطبيع التاء المربوطة.
const STOP_WORDS = new Set(
  'في من على عن الى إلى ان أن انه أنه هل ما ماذا كيف لماذا هذا هذه ذلك التي الذي هو هي مع عند حتى قد لقد'.split(
    ' ',
  ).map(normalizeArabic),
);

/** كلمات الموضوع في الاستعلام، بلا حروف جرّ ولا أدوات استفهام. */
export function queryWords(query: string): string[] {
  return normalizeArabic(query)
    .split(' ')
    .filter((word) => word.length > 1 && !STOP_WORDS.has(word));
}

/**
 * «الصلاة» و«صلاة» كلمة واحدة في العربية للبحث؛ تُقارن بلا «ال» التعريف.
 */
function bareWord(word: string): string {
  return word.length > 4 && word.startsWith('ال') ? word.slice(2) : word;
}

function containsToken(haystack: string, token: string): boolean {
  if (haystack.includes(token)) return true;
  const bare = bareWord(token);
  const tokens = haystack.split(' ');
  if (tokens.some((word) => bareWord(word) === bare)) return true;
  // مطابقة جذرية تقريبية: «الغيبة» لا تطابق «الغائب» لأن أول أربعة أحرف تختلف.
  if (bare.length > 3) {
    const stem = bare.slice(0, 4);
    if (tokens.some((word) => bareWord(word).startsWith(stem))) return true;
  }
  return false;
}

/**
 * درجة صلة مقتطف بالاستعلام: كم مرة وردت كلمة الموضوع فيه بنصّها.
 * تفصل «الغيبة» عن «الغائب» اللتين يخلط بينهما محرك الدرر.
 */
export function relevanceScore(query: string, ...texts: string[]): number {
  const haystack = normalizeArabic(texts.join(' '));
  if (!haystack) return 0;
  const tokens = new Set(haystack.split(' '));
  let score = 0;
  for (const word of queryWords(query)) {
    if (tokens.has(word)) score += 4;
    else if (haystack.includes(word)) score += 2;
    else if (containsToken(haystack, word)) score += 1;
  }
  return score;
}

/**
 * هل يصلح النصّ جواباً عن السؤال؟ محرك الدرر يطابق بعض كلمات الاستعلام فقط،
 * فيأتي بـ«فضل الصلاة بالسواك» عن «فضل الصلاة على النبي». الشرط: كلمة الموضوع
 * الأخيرة (وهي عادةً المحور) موجودة، ونصف الكلمات على الأقل.
 */
export function matchesQuery(query: string, ...texts: string[]): boolean {
  const words = queryWords(query);
  if (!words.length) return true;
  const haystack = normalizeArabic(texts.join(' '));
  if (!haystack) return false;
  const present = words.filter((word) => containsToken(haystack, word));
  const anchor = words[words.length - 1];
  return present.includes(anchor) && present.length * 2 >= words.length;
}

/**
 * ينظّف مقتطفات الموسوعات الأخرى: نصّاً واحداً بلا تكرار ولا وسوم، وحدّاً
 * أقصى للطول كي لا تتضخّم المحادثة المحفوظة.
 */
export function cleanItems(raw: unknown, limit = 12): DorarItem[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: DorarItem[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const record = entry as Record<string, unknown>;
    const url = typeof record.url === 'string' ? record.url.trim() : '';
    if (!url.startsWith('https://dorar.net/')) continue;
    const text = htmlToText(
      typeof record.text === 'string' ? record.text : '',
    ).slice(0, 600);
    if (text.length < 3) continue;
    if (seen.has(url)) continue;
    seen.add(url);
    out.push({
      text,
      meta: htmlToText(typeof record.meta === 'string' ? record.meta : '').slice(
        0,
        160,
      ),
      url,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * اجمع الجواب في قائمة واحدة مبسّطة: الأحاديث الصحيحة والحسنة أولاً، ثم
 * مقتطفات الموسوعات، بلا تقسيم بحسب الموسوعة. الضعيف لا يُعرض في الردّ
 * المبسّط، ويُحصى في `skippedWeak` كي ينبّه التطبيق أنه لم يجد صحيحاً ولا حسناً.
 */
export interface DorarCollection {
  hadiths: DorarHadith[];
  excerpts: DorarItem[];
  /** أحاديث وُجدت لكنها ضعيفة أو غير محدّدة الحكم. */
  skippedWeak: number;
}

export function collectResults(
  answer: DorarAnswer,
  hadithLimit = 6,
  excerptLimit = 6,
): DorarCollection {
  const seenHadith = new Set<string>();
  const hadiths: DorarHadith[] = [];
  let skippedWeak = 0;

  for (const result of answer.sources) {
    for (const hadith of result.hadiths) {
      // صحيح (3) أو حسن (2) فقط.
      if (hadith.rank < 2) {
        skippedWeak += 1;
        continue;
      }
      const key = `${hadith.text}|${hadith.reference}`;
      if (seenHadith.has(key)) continue;
      // حديث صحيح عن غير المسألة لا ينفع؛ يُترك مكانه لمن يطابقها.
      if (!matchesQuery(answer.query, hadith.text)) continue;
      seenHadith.add(key);
      hadiths.push(hadith);
    }
  }
  hadiths.sort((a, b) => b.rank - a.rank);

  const seenUrl = new Set<string>();
  const excerpts: DorarItem[] = [];
  for (const result of answer.sources) {
    for (const item of result.items) {
      if (seenUrl.has(item.url)) continue;
      seenUrl.add(item.url);
      excerpts.push(item);
    }
  }

  // الأقرب للموضوع أولاً: المقتطف الذي يذكر كلمة السؤال بنصّها قبل الذي
  // طابقها المحرك بجذرها، حتى لا يتصدّر «الحكم على الغائب» سؤالَ «الغيبة».
  // ذكر الموضوع في عنوان المادة (سطر الموضع) أقوى من ذكره عابراً في المتن.
  const scored = excerpts.map((item, index) => ({
    item,
    index,
    score:
      relevanceScore(answer.query, item.text) +
      2 * relevanceScore(answer.query, item.meta),
  }));
  const relevant = scored.filter((entry) => entry.score > 0);
  // إن لم يطابق شيء بنصّه (مرادفات) نعرض ما أعاده الدرر كما هو.
  const pool = (relevant.length ? relevant : scored).sort(
    (a, b) => b.score - a.score || a.index - b.index,
  );
  pool.forEach((entry, position) => {
    excerpts[position] = entry.item;
  });
  if (relevant.length) excerpts.length = relevant.length;

  return {
    hadiths: hadiths.slice(0, hadithLimit),
    excerpts: excerpts.slice(0, excerptLimit),
    skippedWeak,
  };
}

/* ------------------------------------------------------------------ */
/* الطلب                                                               */
/* ------------------------------------------------------------------ */

interface WorkerSourcePayload {
  ok?: boolean;
  label?: string;
  total?: number;
  url?: string;
  html?: string;
  items?: unknown;
  error?: string;
}

interface WorkerPayload {
  ok?: boolean;
  query?: string;
  html?: string;
  sources?: Record<string, WorkerSourcePayload>;
  via?: string;
  error?: string;
}

function toCount(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? Math.min(Math.trunc(value), 1_000_000)
    : fallback;
}

/** يبني نتيجة موسوعة واحدة من ردّ العامل. */
function buildSource(
  source: DorarSource,
  payload: WorkerSourcePayload | undefined,
  query: string,
): DorarSourceResult {
  const meta = sourceMeta(source);
  const base = {
    source,
    label: meta.label,
    short: meta.short,
    moreUrl: dorarSourceUrl(source, query),
  };

  if (!payload || payload.ok !== true) {
    return {
      ...base,
      ok: false,
      total: 0,
      hadiths: [],
      items: [],
      error:
        typeof payload?.error === 'string' ? payload.error.slice(0, 60) : '',
    };
  }

  if (source === 'hadith') {
    const parsed =
      typeof payload.html === 'string'
        ? parseDorarHtml(payload.html, query)
        : { hadiths: [] as DorarHadith[], moreUrl: base.moreUrl };
    return {
      ...base,
      ok: true,
      total: toCount(payload.total, parsed.hadiths.length),
      moreUrl:
        typeof payload.url === 'string' && payload.url.startsWith('https://')
          ? payload.url
          : parsed.moreUrl,
      hadiths: parsed.hadiths,
      items: [],
    };
  }

  const items = cleanItems(payload.items);
  return {
    ...base,
    ok: true,
    total: toCount(payload.total, items.length),
    moreUrl:
      typeof payload.url === 'string' && payload.url.startsWith('https://')
        ? payload.url
        : base.moreUrl,
    hadiths: [],
    items,
  };
}

/**
 * ابحث في موسوعات الدرر عبر العامل.
 *
 * `sources` افتراضياً كل الموسوعات. إن فشلت موسوعة وبقيت أخرى تُعاد النتائج
 * المتاحة مع `partial`، وإن فشلت كلها يُرفع `DorarError` كي تعرض المحادثة
 * رسالة واضحة وزر إعادة المحاولة.
 */
export async function askDorar(
  question: string,
  sources: DorarSource[] = DEFAULT_SOURCES,
  signal?: AbortSignal,
): Promise<DorarAnswer> {
  const query = dorarQuery(question);
  if (query.length < 2) throw new DorarError('query-too-short');

  const wanted = DEFAULT_SOURCES.filter((key) => sources.includes(key));
  const list = wanted.length ? wanted : DEFAULT_SOURCES;

  let response: Response;
  try {
    response = await fetch(
      `${WORKER_URL}/?q=${encodeURIComponent(query)}&src=${list.join(',')}`,
      { headers: { Accept: 'application/json' }, signal },
    );
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new DorarError('network');
  }

  let payload: WorkerPayload;
  try {
    payload = (await response.json()) as WorkerPayload;
  } catch {
    throw new DorarError('invalid-response');
  }

  if (!response.ok || !payload.ok) {
    throw new DorarError(payload.error ?? 'upstream');
  }

  let results: DorarSourceResult[];
  if (payload.sources && typeof payload.sources === 'object') {
    results = list.map((source) =>
      buildSource(source, payload.sources?.[source], query),
    );
  } else if (typeof payload.html === 'string') {
    // عامل قديم يعيد الموسوعة الحديثية وحدها.
    results = [buildSource('hadith', { ok: true, html: payload.html }, query)];
  } else {
    throw new DorarError('invalid-response');
  }

  const ok = results.filter((result) => result.ok);
  if (!ok.length) throw new DorarError(results[0]?.error || 'upstream');

  return {
    query: typeof payload.query === 'string' ? payload.query : query,
    sources: results,
    total: ok.reduce((sum, result) => sum + result.total, 0),
    moreUrl: results[0].moreUrl,
    hadiths: results.find((result) => result.source === 'hadith')?.hadiths ?? [],
    partial: ok.length < results.length,
    via: payload.via,
  };
}
