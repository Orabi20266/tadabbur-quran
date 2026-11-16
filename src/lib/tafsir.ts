/**
 * تفسير ابن كثير المحفوظ مع التطبيق.
 *
 * النص يأتي من واجهة quran.com (التفسير رقم ١٤) بعد تنظيفه في
 * `scripts/build-tafsir.mjs`، ويُحفظ ملفاً لكل سورة في
 * `public/tafsir/ibn-kathir/` بدل تضمينه في حزمة JavaScript. تُجلب سورة
 * واحدة عند فتحها فقط، فتبقى الحزمة الأساسية صغيرة، ويعمل عامل الخدمة على
 * تخزين ما قرأه القارئ ليعود إليه بلا اتصال.
 */

export interface TafsirAyah {
  ayah: number;
  /** HTML منظّف: p وspan بفئات ayah/isnad/quote/ref فقط. */
  text: string;
}

export interface TafsirSurah {
  surah: number;
  edition: number;
  ayahs: TafsirAyah[];
}

const EDITION = 'ibn-kathir';
const cache = new Map<number, Promise<TafsirSurah>>();

function url(surah: number): string {
  return `${import.meta.env.BASE_URL}tafsir/${EDITION}/${surah}.json`;
}

/** حمّل تفسير سورة كاملة، مع طلب واحد مشترك لكل سورة. */
export function loadTafsir(surah: number): Promise<TafsirSurah> {
  const cached = cache.get(surah);
  if (cached) return cached;
  const request = fetch(url(surah))
    .then((response) => {
      if (!response.ok) throw new Error(`tafsir ${surah}: ${response.status}`);
      return response.json() as Promise<TafsirSurah>;
    })
    .catch((error: unknown) => {
      // A failed request must not poison the cache for the retry button.
      cache.delete(surah);
      throw error;
    });
  cache.set(surah, request);
  return request;
}

/** الآية المطلوبة من سورة محمّلة، أو null إذا لم يخصّها ابن كثير بنصّ. */
export function tafsirFor(
  data: TafsirSurah | null,
  ayah: number,
): TafsirAyah | null {
  return data?.ayahs.find((item) => item.ayah === ayah) ?? null;
}
