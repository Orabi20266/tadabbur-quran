/**
 * إعدادات الاتصال بخدمة Gemini.
 *
 * `GEMINI_PROXY` هو رابط الوسيط المنشور (Cloudflare Worker) الذي يحمل مفتاح
 * Gemini على الخادم. عند تعبئته يعمل التعرّف الصوتي لكل زائر فوراً دون مفتاح،
 * ولا يحتاج المفتاح إلى الظهور في المتصفّح إطلاقاً.
 *
 * اتركه فارغاً أثناء التطوير إن أردت استخدام مفتاحك الشخصي من الإعدادات.
 */
export const GEMINI_PROXY =
  'https://tadabbur-proxy.bnanbrand.workers.dev/transcribe';

/** هل التعرّف الصوتي متاح للزوار بلا مفتاح؟ */
export const hasSharedSpeech = GEMINI_PROXY.length > 0;
