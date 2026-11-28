/**
 * محادثة IslamQA.
 *
 * مصدر الجواب واحد فقط: https://islamqa.info/ar . لا يوجد نموذج لغوي ولا
 * صياغة حكم من عندنا؛ نعرض نصوص الموقع كما نشرها، ومع كل جواب رابطه.
 * الموقع لا يرسل CORS، فالقراءة تتم عبر وسيط Cloudflare (`worker/islamqa-proxy`)
 * أو عبر وكيل Vite المحلي أثناء التطوير.
 */

/** إجابة واحدة منقولة من IslamQA. النصوص قد تحتوي وسوم HTML خامّة من الواجهة. */
export interface IslamqaAnswer {
  id: number;
  title: string;
  question: string;
  body: string;
  url: string;
}

export interface IslamqaAnswerSet {
  /** الاستعلام الذي أُرسل إلى الموقع بعد تنظيمه. */
  query: string;
  answers: IslamqaAnswer[];
  total: number;
  fetchedAt: number;
}

export type IslamqaErrorCode =
  | 'network'
  | 'bad-response'
  | 'query-too-short'
  | 'not-configured';

export class IslamqaError extends Error {
  readonly code: IslamqaErrorCode;

  constructor(code: IslamqaErrorCode) {
    super(code);
    this.name = 'IslamqaError';
    this.code = code;
  }
}

interface WorkerResult {
  id?: unknown;
  title?: unknown;
  question?: unknown;
  body?: unknown;
  url?: unknown;
}

interface WorkerPayload {
  ok?: unknown;
  query?: unknown;
  total?: unknown;
  fetchedAt?: unknown;
  results?: unknown;
}

const SITE = 'https://islamqa.info';
/**
 * الوسيط المنشور، ويُستخدم في الإنتاج وفي التطبيق الأصلي حين لا يُضبط متغير
 * بيئة صريح. التطوير المحلي يستخدم وكيل Vite أدناه.
 */
const DEFAULT_WORKER = 'https://tadabbur-islamqa.bnanbrand.workers.dev';
/** كلمات لا تُفيد في ترتيب النتائج داخل استعلام عربي. */
const STOP_WORDS = new Set([
  'في', 'من', 'على', 'عن', 'إلي', 'الى', 'مع', 'هل', 'ما', 'كيف', 'لم',
  'اله', 'الله', 'هذا', 'هذه', 'التي', 'الذي', 'كان', 'كانت', 'قد', 'يا',
  'كل', 'بعض', 'بين', 'بعد', 'قبل', 'مع', 'الان', 'الآن', 'جواب', 'سؤال',
]);

/** ينظّم سؤال المستخدم إلى استعلام بحث عربي خالٍ من التشكيل والرموز. */
export function islamqaQuery(question: string): string {
  return question
    .replace(/[\u064b-\u065f\u0670]/g, '')
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ؤ/g, 'و')
    .replace(/ئ/g, 'ي')
    .replace(/ة/g, 'ه')
    .replace(/ء/g, '')
    .replace(/[^\u0621-\u064A0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

/** فكّ وسوم HTML الواردة من واجهة الموقع إلى نصّ عربي قابل للعرض. */
export function htmlToText(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6]|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (whole, digits: string) => {
      const point = Number(digits);
      return point > 0 && point <= 0x10ffff
        ? String.fromCodePoint(point)
        : whole;
    })
    .replace(/[ \t]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

/** مقطع قصير من الجواب، يُقطع عند آخر كلمة كاملة ولا يخترع كلاماً. */
export function excerpt(text: string, max = 900): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const space = cut.lastIndexOf(' ');
  return `${cut.slice(0, space > max * 0.7 ? space : max)}…`;
}

function tokens(text: string): string[] {
  return islamqaQuery(text)
    .split(' ')
    .filter((word) => word.length > 2 && !STOP_WORDS.has(word));
}

function score(answer: IslamqaAnswer, keys: string[]): number {
  const title = islamqaQuery(answer.title);
  const question = islamqaQuery(answer.question);
  const body = islamqaQuery(answer.body);
  let value = 0;
  for (const key of keys) {
    if (title.includes(key)) value += 3;
    if (question.includes(key)) value += 2;
    if (body.includes(key)) value += 1;
  }
  return value;
}

/** الموقع يرتّب نتائجه؛ نعيد ترتيبها بلطف بحسب كلمات السؤال المطابقة. */
export function rankAnswers(
  answers: IslamqaAnswer[],
  query: string,
): IslamqaAnswer[] {
  const keys = tokens(query);
  if (!keys.length) return answers;
  return [...answers].sort((a, b) => score(b, keys) - score(a, keys));
}

function endpoint(): string {
  const env = import.meta.env as Record<string, string | undefined>;
  const configured = (env.VITE_ISLAMQA_WORKER_URL ?? '').trim().replace(/\/+$/, '');
  if (configured) return configured;
  if (import.meta.env.DEV) return '/islamqa-api';
  return DEFAULT_WORKER;
}

function answerFrom(raw: WorkerResult): IslamqaAnswer | null {
  const id = Number(raw.id);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  const title = htmlToText(typeof raw.title === 'string' ? raw.title : '');
  const question = htmlToText(typeof raw.question === 'string' ? raw.question : '');
  const body = excerpt(htmlToText(typeof raw.body === 'string' ? raw.body : ''));
  if (!title && !body) return null;
  // الرابط دائماً من نطاق الموقع، مهما أرسل الوسيط.
  return {
    id,
    title,
    question,
    body,
    url: `${SITE}/ar/answers/${id}`,
  };
}

/** رابط البحث في الموقع، يُستخدم عند غياب نتيجة أو عند تعذّر الوصول. */
export function islamqaSearchUrl(query: string): string {
  const params = new URLSearchParams({ lang: 'ar', searchType: 'answer', query });
  return `${SITE}/ar/search?${params.toString()}`;
}

/**
 * تبحث في IslamQA وحده، وتعيد نصوص الإجابات كما وردت.
 * غياب النتيجة ليس خطأً: « answers: []» ويقول التطبيق صراحةً إنه لم يجد جواباً.
 */
export async function askIslamqa(
  question: string,
  signal?: AbortSignal,
): Promise<IslamqaAnswerSet> {
  const query = islamqaQuery(question);
  if (query.length < 2) throw new IslamqaError('query-too-short');

  let response: Response;
  try {
    response = await fetch(`${endpoint()}/?q=${encodeURIComponent(query)}`, {
      headers: { Accept: 'application/json' },
      signal,
    });
  } catch (error) {
    if ((error as Error).name === 'AbortError') throw error;
    throw new IslamqaError('network');
  }

  if (response.status === 400) throw new IslamqaError('query-too-short');
  if (!response.ok) throw new IslamqaError('bad-response');

  let payload: WorkerPayload;
  try {
    payload = (await response.json()) as WorkerPayload;
  } catch {
    throw new IslamqaError('bad-response');
  }
  if (!payload || payload.ok !== true || !Array.isArray(payload.results)) {
    throw new IslamqaError('bad-response');
  }

  const answers = payload.results
    .map((item) => answerFrom(item as WorkerResult))
    .filter((item): item is IslamqaAnswer => item !== null);
  const total = Number(payload.total);
  return {
    query,
    answers: rankAnswers(answers, query),
    total: Number.isFinite(total) && total >= 0 ? total : answers.length,
    fetchedAt: Number(payload.fetchedAt) || Date.now(),
  };
}
