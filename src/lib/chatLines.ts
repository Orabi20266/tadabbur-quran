import { arabicNumber } from './quran';

/**
 * عبارات محادثة الدرر.
 *
 * الجواب نفسه لا يُصاغ هنا: النصوص والأحكام تُنقل من موسوعة الدرر السنية كما
 * هي. هذه العبارات مجرّد ترحيب وتقديم للنتائج، لذلك تُختار من قوائم ثابتة
 * بأسلوب مهذّب، ولا تحتوي حكماً شرعياً ولا تخترع نتيجة.
 */

const OPENINGS = [
  'أهلاً وسهلاً بك، بحثتُ لك في موسوعة الدرر السنية.',
  'بارك الله فيك، هذا جواب سؤالك من الدرر السنية.',
  'حياك الله، وهذا ما وجدته لك في الموسوعة.',
  'أبشر، تفضّل ما وقفت عليه في الدرر السنية.',
  'تفضّل، إليك الجواب من موسوعة الدرر السنية.',
  'جزاك الله خيراً، وهذا ما ورد في الدرر السنية.',
  'نفع الله بك، هذا ما ورد في موسوعة الدرر.',
];

const MISSING = [
  'لم أجد حديثاً مطابقاً لهذا السؤال في الدرر السنية.',
  'لم يظهر لي حديث مطابق في الدرر السنية.',
  'لا توجد نتيجة مطابقة لهذه الصياغة في الدرر السنية.',
];

const WEAK = [
  'وجدت نتائج، لكن خلاصة حكم المحدّثين عليها ضعف، فاقرأ الحكم بنصّه ولا تعتمد عليها.',
  'النتائج الموجودة ضعيفة الإسناد بحسب الدرر، فانظر في أسانيدها ولا تُبنَ عليها.',
  'كل ما وجدته ضعيف الإسناد عند المحدّثين، فاعرضه على أهل العلم قبل العمل به.',
];

/** أول رسالة في محادثة فارغة. */
export const WELCOME =
  'أهلاً وسهلاً بك. اسألني عن حديث أو حكم، وأبحث لك في موسوعة الدرر السنية وأنقل لك الجواب بنصّه مع الراوي والمحدّث والمصدر.';

/** تنبيه ثابت أسفل نتائج البحث. */
export const DISCLAIMER =
  'الأحاديث والأحكام منقولة بنصّها من موسوعة الدرر السنية، وليست فتوى شخصية. وفي النوازل يُرجع إلى أهل العلم.';

export const NOT_FOUND =
  'جرّب كلمة أخرى أقرب للموضوع، أو افتح البحث الكامل في الدرر.';

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

export function weakFor(seed: number): string {
  return pick(WEAK, seed);
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

/** «وجدت ١٥ نتيجة عن «حكم الغيبة» في الدرر السنية…» */
export function countLine(query: string, count: number): string {
  const topic = query.trim();
  const echo = topic && topic.length <= 48 ? ` عن «${topic}»` : '';
  const tail =
    count === 1
      ? ' في الدرر السنية.'
      : ' في الدرر السنية، مرتّبة بحسب درجة الحديث.';
  return `وجدت ${resultsWord(count)}${echo}${tail}`;
}
