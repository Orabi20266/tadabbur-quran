import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

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
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        // A new deployment must replace the old cache instead of waiting for
        // every tab to close: readers keep this app open for long sessions.
        skipWaiting: true,
        clientsClaim: true,
        cleanupOutdatedCaches: true,
      },
    }),
  ],
  server: { port: 5174 },
});
