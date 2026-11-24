import { askDorar, dorarQuery } from './dorar';
import type { DorarAnswer } from './dorar';

export const OFFLINE_KEY = 'tadabbur.dorar.offline.v1';

const MAX_ENTRIES = 40;
const MAX_HADITHS = 12;
const MAX_PER_SOURCE = 10;

export interface CachedDorar {
  /** الاستعلام المُوحَّد الذي تُحفظ تحته الإجابة. */
  query: string;
  answer: DorarAnswer;
  savedAt: number;
}

export interface OfflinePackItem {
  label: string;
  query: string;
}

/** حزمة مختارة تُحمَّل مرة واحدة لتُقرأ لاحقاً دون اتصال. */
export const OFFLINE_PACK: OfflinePackItem[] = [
  { label: 'الأربعين النووية', query: 'الأربعين النووية' },
  { label: 'نية الأعمال', query: 'نية الأعمال' },
  { label: 'الإيمان والإسلام والإحسان', query: 'الإيمان والإسلام والإحسان' },
  { label: 'بر الوالدين', query: 'بر الوالدين' },
  { label: 'حكم الغيبة', query: 'حكم الغيبة' },
  { label: 'فضل الصلاة على النبي', query: 'فضل الصلاة على النبي' },
  { label: 'أذكار الصباح', query: 'أذكار الصباح' },
  { label: 'آية الكرسي', query: 'تفسير آية الكرسي' },
];

function keyFor(question: string): string {
  return dorarQuery(question) || question.trim();
}

function trimAnswer(answer: DorarAnswer): DorarAnswer {
  return {
    ...answer,
    hadiths: answer.hadiths.slice(0, MAX_HADITHS),
    sources: answer.sources.map((source) => ({
      ...source,
      hadiths: source.hadiths.slice(0, MAX_PER_SOURCE),
      items: source.items.slice(0, MAX_PER_SOURCE),
    })),
  };
}

function persist(entries: CachedDorar[]): void {
  try {
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(entries));
  } catch {
    // إذا امتلأ التخزين، احتفظ بالأحدث فقط ثم أعد المحاولة مرة واحدة.
    const reduced = entries.slice(0, Math.max(1, Math.ceil(entries.length / 2)));
    try {
      localStorage.setItem(OFFLINE_KEY, JSON.stringify(reduced));
    } catch {
      /* التخزين غير متاح؛ تبقى النسخة المحمّلة في الذاكرة لهذه الجلسة */
    }
  }
}

function load(): CachedDorar[] {
  try {
    const raw = localStorage.getItem(OFFLINE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is CachedDorar => {
        if (!entry || typeof entry !== 'object') return false;
        const item = entry as Partial<CachedDorar>;
        return (
          typeof item.query === 'string' &&
          typeof item.savedAt === 'number' &&
          Boolean(item.answer) &&
          Array.isArray((item.answer as Partial<DorarAnswer>).sources)
        );
      })
      .sort((a, b) => b.savedAt - a.savedAt)
      .slice(0, MAX_ENTRIES);
  } catch {
    return [];
  }
}

/** الإجابات المحفوظة، الأحدث أولاً. */
export function offlineAnswers(): CachedDorar[] {
  return load();
}

export function offlineCount(): number {
  return load().length;
}

export function getCachedAnswer(question: string): DorarAnswer | null {
  const key = keyFor(question);
  return load().find((entry) => entry.query === key)?.answer ?? null;
}

/** تُحفظ كل إجابة تُجلب أثناء الاتصال لتُعرض لاحقاً دون إنترنت. */
export function saveCachedAnswer(question: string, answer: DorarAnswer): void {
  const key = keyFor(question);
  if (!key) return;
  const trimmed = trimAnswer({ ...answer, query: key });
  const rest = load().filter((entry) => entry.query !== key);
  persist([{ query: key, answer: trimmed, savedAt: Date.now() }, ...rest].slice(0, MAX_ENTRIES));
}

export function clearOfflineAnswers(): void {
  try {
    localStorage.removeItem(OFFLINE_KEY);
  } catch {
    /* لا شيء يمكن فعله إن كان التخزين معطّلاً */
  }
}

export interface PackResult {
  ok: number;
  skipped: number;
  failed: string[];
  total: number;
}

/** تنزيل الحزمة المختارة؛ الموجود منها يُتخطّى افتراضياً. */
export async function downloadOfflinePack(
  onProgress?: (done: number, total: number, label: string) => void,
  force = false,
): Promise<PackResult> {
  const result: PackResult = { ok: 0, skipped: 0, failed: [], total: OFFLINE_PACK.length };
  let done = 0;

  for (const item of OFFLINE_PACK) {
    done += 1;
    const key = keyFor(item.query);
    const exists = load().some((entry) => entry.query === key);
    if (exists && !force) {
      result.skipped += 1;
      onProgress?.(done, result.total, item.label);
      continue;
    }

    try {
      const answer = await askDorar(item.query);
      saveCachedAnswer(item.query, answer);
      result.ok += 1;
    } catch {
      result.failed.push(item.label);
    }
    onProgress?.(done, result.total, item.label);
  }

  return result;
}
