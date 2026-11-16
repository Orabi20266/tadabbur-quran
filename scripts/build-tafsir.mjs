#!/usr/bin/env node
/**
 * يجلب تفسير ابن كثير (نسخة quran.com، التفسير رقم ١٤) ويحوّله إلى ملفات
 * ثابتة لكل سورة في `public/tafsir/ibn-kathir/`.
 *
 * التشغيل: node scripts/build-tafsir.mjs
 *
 * سبب وجود السكربت: النص يُجلب مرة واحدة ويُحفظ مع المستودع، فلا يحتاج البناء
 * ولا الموقع إلى اتصال بخدمة خارجية. HTML القادم من الخدمة لا يُعرض كما هو:
 * تُحذف كل الوسوم والسمات ويُبقى على المقاطع الدلالية فقط (آية، إسناد، حديث،
 * إحالة) بفئات خاصة بالتطبيق.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const EDITION = 14;
const API = `https://api.quran.com/api/v4/tafsirs/${EDITION}/by_chapter`;
const OUT = fileURLToPath(
  new URL('../public/tafsir/ibn-kathir/', import.meta.url),
);
const SURAH_COUNT = 114;

/** فئات الخدمة → فئات التطبيق. */
const SPAN_CLASS = {
  arabic: 'ayah',
  'qpc-hafs': 'ayah',
  blue: 'isnad',
  red: 'quote',
  reference: 'ref',
  brown: 'ref',
};

const ALLOWED = /^(?:\/?p|\/?span)$/;

/**
 * يُبقي على p/span فقط، ويحوّل فئات الخدمة إلى فئات التطبيق. المحتوى من خدمة
 * واحدة معروفة ولا يحمل وسمًا آخر ولا سمة غير class/lang، لكن الحذف هنا مقصود
 * ليكون العرض آمنًا حتى لو تغيّر المصدر.
 */
export function sanitizeTafsir(html) {
  return html
    .replace(/<(\/?)([a-zA-Z][a-zA-Z0-9]*)([^>]*)>/g, (tag, close, name) => {
      if (!ALLOWED.test(`${close}${name}`)) return '';
      if (close) return `</${name}>`;
      if (name === 'p') return '<p>';
      const classes = (tag.match(/class="([^"]*)"/) ?? [])[1] ?? '';
      const kind = classes
        .split(/\s+/)
        .map((className) => SPAN_CLASS[className])
        .find(Boolean);
      return kind ? `<span class="${kind}">` : '<span>';
    })
    .trim();
}

async function fetchSurah(surah) {
  const response = await fetch(`${API}/${surah}?per_page=300`, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`surah ${surah}: HTTP ${response.status}`);
  }
  const body = await response.json();
  const ayahs = (body.tafsirs ?? []).map((item) => ({
    ayah: Number(item.verse_key.split(':')[1]),
    text: sanitizeTafsir(item.text ?? ''),
  }));
  if (ayahs.length === 0) throw new Error(`surah ${surah}: no tafsir`);
  return { surah, edition: EDITION, ayahs };
}

async function main() {
  await mkdir(OUT, { recursive: true });
  let chars = 0;
  for (let surah = 1; surah <= SURAH_COUNT; surah++) {
    const data = await fetchSurah(surah);
    await writeFile(`${OUT}${surah}.json`, JSON.stringify(data), 'utf8');
    chars += data.ayahs.reduce((sum, ayah) => sum + ayah.text.length, 0);
    process.stdout.write(`\r${surah}/${SURAH_COUNT}`);
    // لطفًا بالخدمة: طلب واحد كل ١٢٠ مللي ثانية.
    await new Promise((done) => setTimeout(done, 120));
  }
  process.stdout.write(`\nتمّ: ${chars.toLocaleString('ar')} حرفًا\n`);
}

const invokedDirectly =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) await main();
