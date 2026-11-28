import { arabicNumber } from './quran';

/**
 * عبارات محادثة IslamQA.
 *
 * الجواب نفسه لا يُصاغ هنا: النصوص تُنقل من موقع IslamQA كما نشرها. هذه
 * العبارات مجرّد ترحيب وتقديم للنتائج، لذلك تُختار من قوائم ثابتة، ولا تحتوي
 * حكماً شرعياً ولا تخترع نتيجة.
 */

const OPENINGS = [
  'أهلاً وسهلاً بك، بحثتُ لك في موقع الإسلام سؤال وجواب.',
  'بارك الله فيك، هذا جواب سؤالك من الإسلام سؤال وجواب.',
  'حياك الله، وهذا ما وجدته لك في الموقع.',
  'أبشر، تفضّل ما وقفت عليه في الإسلام سؤال وجواب.',
  'تفضّل، إليك الجواب من موقع IslamQA.',
  'جزاك الله خيراً، وهذا ما ورد في الموقع.',
  'نفع الله بك، هذا ما ورد في الإسلام سؤال وجواب.',
];

const MISSING = [
  'لم أجد نتيجة مطابقة لهذا السؤال في موقع الإسلام سؤال وجواب.',
  'لم يظهر لي شيء مطابق في الموقع.',
  'لا توجد نتيجة مطابقة لهذه الصياغة في الإسلام سؤال وجواب.',
];

/** أول رسالة في محادثة فارغة. */
export const WELCOME =
  'أهلاً وسهلاً. اسأل عن مسألة شرعية أو تفسير آية، وأبحث لك في موقع الإسلام سؤال وجواب وأنقل لك الجواب بنصّه.';

/** تنبيه ثابت أسفل نتائج البحث. */
export const DISCLAIMER = 'الجواب منقول من موقع الإسلام سؤال وجواب، وليس فتوى من عندنا.';

/** الإجابات المحفوظة قديماً من الدرر تُعرض كما حُفظت، ولا يبحث بها من جديد. */
export const DORAR_DISCLAIMER = 'النقول معروضة كما وردت في الدرر السنية، ولم نضف إليها حكماً.';

export const NOT_FOUND =
  'جرّب كلمة أخرى أقرب للموضوع، أو افتح البحث الكامل في الموقع.';

/**
 * حين لا نجد جواباً: نقول ذلك صراحةً ولا نفتئ على المسألة باجتهاد من عندنا.
 */
export const NO_ANSWER =
  'لا أدري بامكانك مراجعة من تثق في علمه في هذه المسألة.';

/** النصوص عرض منقولة، لا تعليق ولا استنباط من التطبيق. */
export const NO_AUTHENTIC =
  'النقول معروضة كما وردت في المصدر، ولا نزيد عليها شيئاً من عندنا.';

/** فشل تحميل بعض الإجابات لا يُسقط الجواب كله. */
export const PARTIAL = 'تعذّر تحميل بعض الإجابات هذه المرة.';

/** ترتيب مستقر لكل محادثة، حتى لا يتغيّر الترحيب عند إعادة تحميل الصفحة. */
export function seedFor(id: string): number {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) {
    hash = (hash * 31 + id.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

function pick(lines: string[], seed: number): string {
  return lines[Math.abs(Math.trunc(seed)) % lines.length];
}

export function openingFor(seed: number): string {
  return pick(OPENINGS, seed);
}

export function missingFor(seed: number): string {
  return pick(MISSING, seed);
}

/**
 * صيغة العدد بالعربية: نتيجة واحدة، نتيجتان، ٣ نتائج، ١١ نتيجة.
 */
export function resultsWord(count: number): string {
  if (count === 1) return 'نتيجة واحدة';
  if (count === 2) return 'نتيجتين';
  const rest = count % 100;
  if (rest >= 3 && rest <= 10) return `${arabicNumber(count)} نتائج`;
  return `${arabicNumber(count)} نتيجة`;
}

/**
 * سطر واحد بسيط بعد الترحيب: «وجدت ٣ نتائج عن «حكم الغيبة» في الموقع.»
 */
export function countLine(query: string, count: number): string {
  const topic = query.trim();
  const echo = topic && topic.length <= 48 ? ` عن «${topic}»` : '';
  return `وجدت ${resultsWord(count)}${echo} في موقع الإسلام سؤال وجواب.`;
}

/** سطر النتائج للإجابات الدررية المحفوظة على الجهاز. */
export function dorarCountLine(query: string, count: number): string {
  const topic = query.trim();
  const echo = topic && topic.length <= 48 ? ` عن «${topic}»` : '';
  return `وجدت ${resultsWord(count)}${echo} في الدرر السنية.`;
}
