import { arabicNumber } from './quran';

/**
 * عبارات محادثة الدرر.
 *
 * الجواب نفسه لا يُصاغ هنا: النصوص والأحكام تُنقل من موسوعات الدرر السنية كما
 * هي. هذه العبارات مجرّد ترحيب وتقديم للنتائج، لذلك تُختار من قوائم ثابتة
 * بأسلوب مهذّب، ولا تحتوي حكماً شرعياً ولا تخترع نتيجة.
 */

const OPENINGS = [
  'أهلاً وسهلاً بك، بحثتُ لك في الدرر السنية.',
  'بارك الله فيك، هذا جواب سؤالك من الدرر السنية.',
  'حياك الله، وهذا ما وجدته لك في الموسوعة.',
  'أبشر، تفضّل ما وقفت عليه في الدرر السنية.',
  'تفضّل، إليك الجواب من الدرر السنية.',
  'جزاك الله خيراً، وهذا ما ورد في الدرر السنية.',
  'نفع الله بك، هذا ما ورد في موسوعة الدرر.',
];

const MISSING = [
  'لم أجد نتيجة مطابقة لهذا السؤال في الدرر السنية.',
  'لم يظهر لي شيء مطابق في الدرر السنية.',
  'لا توجد نتيجة مطابقة لهذه الصياغة في الدرر السنية.',
];

/** أول رسالة في محادثة فارغة. */
export const WELCOME =
  'أهلاً وسهلاً. اسأل عن حديث أو حكم أو تفسير، وأبحث لك في موسوعات الدرر السنية وأنقل لك الجواب بنصّه.';

/** تنبيه ثابت أسفل نتائج البحث. */
export const DISCLAIMER = 'النقول من موسوعات الدرر السنية، وليست فتوى شخصية.';

export const NOT_FOUND =
  'جرّب كلمة أخرى أقرب للموضوع، أو افتح البحث الكامل في الدرر.';

/** حين لا يوجد حديث صحيح ولا حسن، تُعرض النقول مع تنبيه صريح. */
export const NO_AUTHENTIC =
  'لم أجد في هذه المسألة حديثاً صحيحاً أو حسناً، وهذه نقول من الموسوعات.';

/** فشل بعض المصادر لا يُسقط الجواب كله. */
export const PARTIAL = 'تعذّر الوصول إلى بعض الموسوعات هذه المرة.';

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
 * سطر واحد بسيط بعد الترحيب: «وجدت ٣ نتائج عن «حكم الغيبة» في الدرر السنية.»
 * بلا تعداد موسوعات ولا تفصيل، لأن الجواب يُعرض قائمة واحدة.
 */
export function countLine(query: string, count: number): string {
  const topic = query.trim();
  const echo = topic && topic.length <= 48 ? ` عن «${topic}»` : '';
  return `وجدت ${resultsWord(count)}${echo} في الدرر السنية.`;
}
