import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

/** The config runs in Node, but this project does not depend on @types/node. */
declare const process: { env: Record<string, string | undefined> };

/**
 * IslamQA لا يرسل CORS، فالمتصفح لا يقرأ واجهته مباشرة. في التطوير نُشغّل
 * نفس شكل ردّ عامل Cloudflare داخل Vite، حتى يعمل `/ask` من دون نشر العامل.
 * الإنتاج يستخدم VITE_ISLAMQA_WORKER_URL (انظر worker/islamqa-proxy).
 */
function islamqaDevApi() {
  const send = (res: any, status: number, body: unknown) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify(body));
  };
  const clean = (raw: string) =>
    raw.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200);
  const text = (value: unknown) => (typeof value === 'string' ? value : '');

  return {
    name: 'islamqa-dev-api',
    configureServer(server: any) {
      server.middlewares.use(async (req: any, res: any, next: any) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/islamqa-api')) return next();

        if (url.pathname.includes('/health')) {
          send(res, 200, { ok: true, source: 'https://islamqa.info' });
          return;
        }

        const query = clean(url.searchParams.get('q') ?? '');
        if (query.length < 2) {
          send(res, 400, { ok: false, error: 'query-too-short' });
          return;
        }

        try {
          const searchParams = new URLSearchParams({
            lang: 'ar',
            limit: '12',
            searchType: 'answer',
            query,
          });
          const search = await (
            await fetch(`https://islamqa.info/api/search?${searchParams}`, {
              headers: { Accept: 'application/json' },
            })
          ).json();
          const found = Array.isArray(search?.Search?.results)
            ? search.Search.results
            : [];
          const ids = [
            ...new Set(
              found
                .map((item: any) => Number(item?.id ?? item?.reference))
                .filter((id: number) => Number.isSafeInteger(id) && id > 0),
            ),
          ].slice(0, 6) as number[];
          const posts = await Promise.all(
            ids.map((id) =>
              fetch(`https://islamqa.info/api/posts/answer/${id}?lang=ar`, {
                headers: { Accept: 'application/json' },
              })
                .then((response) => response.json())
                .catch(() => null),
            ),
          );
          const results = posts
            .filter((post: any) => post && (post.title || post.body))
            .map((post: any) => ({
              id: Number(post.id ?? post.reference),
              title: text(post.title),
              question: text(post.question),
              body: text(post.body),
              url: `https://islamqa.info/ar/answers/${Number(post.id ?? post.reference)}`,
            }));
          if (!results.length) {
            send(res, 502, { ok: false, error: 'upstream-blocked' });
            return;
          }
          const total = Number(search?.Search?.total);
          send(res, 200, {
            ok: true,
            source: 'https://islamqa.info',
            query,
            total: Number.isFinite(total) && total >= 0 ? total : results.length,
            fetchedAt: Date.now(),
            results,
          });
        } catch {
          send(res, 502, { ok: false, error: 'upstream-blocked' });
        }
      });
    },
  };
}

export default defineConfig({
  base: './',
  define: {
    __BUILD_ID__: JSON.stringify(
      (process.env.GITHUB_SHA ?? '').slice(0, 7) ||
        new Date().toISOString().slice(0, 10),
    ),
  },
  plugins: [
    react(),
    islamqaDevApi(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['fonts/*.woff2', 'icon.svg'],
      manifest: {
        name: 'تدبّر — رفيق الحفظ',
        short_name: 'تدبّر',
        description: 'حفظ القرآن: إخفاء الآيات، التلاوة من الذاكرة، وتتبّع الأخطاء.',
        lang: 'ar',
        dir: 'rtl',
        theme_color: '#1e6b4a',
        background_color: '#f7f4ec',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
          { src: 'icon-maskable.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,woff2,json}'],
        // التفسير ١٨ ميغابايت: لا يُحمَّل مع أول فتح للتطبيق. كل سورة تُجلب
        // عند فتحها ثم يخزّنها عامل الخدمة، فلا يدفع القارئ ثمن ما لم يقرأه.
        globIgnores: ['tafsir/**', '**/tafsir/**'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // A new deployment must replace the old cache instead of waiting for
        // every tab to close: readers keep this app open for long sessions.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
        runtimeCaching: [
          {
            // ملفات التفسير في `tafsir/ibn-kathir/<رقم>.json`، فالمسار فيه
            // مجلدان بعد tafsir؛ النمط القديم كان يقبل مقطعاً واحداً فلا يطابق.
            urlPattern: /\/tafsir\/.+\.json$/,
            handler: 'CacheFirst',
            options: {
              cacheName: 'tafsir',
              expiration: {
                maxEntries: 240,
                maxAgeSeconds: 60 * 60 * 24 * 365,
              },
            },
          },
        ],
      },
    }),
  ],
  server: { port: 5174 },
});
