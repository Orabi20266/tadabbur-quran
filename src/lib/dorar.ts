/**
 * محادثة الدرر السنية.
 *
 * الموقع لا يسمح للمتصفح بقراءة `dorar_api.json` من نطاق آخر، فيمرّ الطلب عبر
 * عامل Cloudflare صغير (`worker/dorar-proxy`) يعيد نتيجة البحث كما هي. هذا
 * الملف يبني استعلاماً مناسباً من سؤال المستخدم ثم يفكّ HTML الدرر إلى أحاديث
 * مرتّبة، مع نسبة كل حكم إلى المصدر وعدم اختراع أي جواب.
 */

const WORKER_URL = 'https://tadabbur-dorar.bnanbrand.workers.dev';
const DORAR_SEARCH = 'https://dorar.net/hadith/search';

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

export interface DorarAnswer {
  /** الاستعلام الذي أُرسل إلى الدرر. */
  query: string;
  hadiths: DorarHadith[];
  /** العدد الكامل قبل الاقتصار على ما يُحفظ في المحادثة. */
  total: number;
  /** رابط نتائج البحث الكاملة في الدرر. */
  moreUrl: string;
  /** كيف جلب العامل النتيجة: browser أو reader أو direct. */
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
  if (query.length < 2) return original;
  return query.split(/\s+/).slice(0, 12).join(' ').slice(0, 120);
}

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

/* ------------------------------------------------------------------ */
/* الطلب                                                               */
/* ------------------------------------------------------------------ */

interface WorkerPayload {
  ok?: boolean;
  query?: string;
  html?: string;
  via?: string;
  error?: string;
}

/** ابحث في الدرر عبر العامل، وأعد أحاديث مفكوكة أو ارفع DorarError. */
export async function askDorar(
  question: string,
  signal?: AbortSignal,
): Promise<DorarAnswer> {
  const query = dorarQuery(question);
  if (query.length < 2) throw new DorarError('query-too-short');

  let response: Response;
  try {
    response = await fetch(`${WORKER_URL}/?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
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

  if (!response.ok || !payload.ok || typeof payload.html !== 'string') {
    throw new DorarError(payload.error ?? 'upstream');
  }

  const parsed = parseDorarHtml(payload.html, query);
  return {
    query: payload.query ?? query,
    ...parsed,
    total: parsed.hadiths.length,
    via: payload.via,
  };
}
