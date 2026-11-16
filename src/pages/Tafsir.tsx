import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  ChevronLeft,
  ChevronRight,
  Loader2,
  RefreshCw,
  ScrollText,
} from 'lucide-react';
import { ayahText, arabicNumber, getSurah, surahs } from '../lib/quran';
import { loadTafsir, tafsirFor } from '../lib/tafsir';
import type { TafsirSurah } from '../lib/tafsir';

const STORAGE_KEY = 'tadabbur.tafsir.v1';

interface Stored {
  surah: number;
  ayah: number;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { surah: 1, ayah: 1 };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      surah: Number(parsed?.surah) || 1,
      ayah: Number(parsed?.ayah) || 1,
    };
  } catch {
    return { surah: 1, ayah: 1 };
  }
}

function saveStored(value: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* التخزين قد يكون معطّلاً */
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

type Status = 'loading' | 'ready' | 'error';

export function Tafsir() {
  const params = useParams();
  const navigate = useNavigate();
  const storedRef = useRef<Stored>(loadStored());
  const stored = storedRef.current;

  const surah = clamp(Number(params.surah) || stored.surah || 1, 1, 114);
  const data = getSurah(surah);
  const ayah = clamp(Number(params.ayah) || stored.ayah || 1, 1, data.total_verses);

  const [tafsir, setTafsir] = useState<TafsirSurah | null>(null);
  const [status, setStatus] = useState<Status>('loading');
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    saveStored({ surah, ayah });
  }, [surah, ayah]);

  useEffect(() => {
    let alive = true;
    setStatus('loading');
    loadTafsir(surah)
      .then((result) => {
        if (!alive) return;
        setTafsir(result);
        setStatus('ready');
      })
      .catch(() => {
        if (alive) setStatus('error');
      });
    return () => {
      alive = false;
    };
  }, [surah, attempt]);

  const go = (nextSurah: number, nextAyah: number, replace = false) => {
    const total = getSurah(nextSurah).total_verses;
    navigate(`/tafsir/${nextSurah}/${clamp(nextAyah, 1, total)}`, { replace });
  };

  const previous =
    ayah > 1
      ? { surah, ayah: ayah - 1 }
      : surah > 1
        ? { surah: surah - 1, ayah: getSurah(surah - 1).total_verses }
        : null;
  const next =
    ayah < data.total_verses
      ? { surah, ayah: ayah + 1 }
      : surah < 114
        ? { surah: surah + 1, ayah: 1 }
        : null;

  const current = tafsirFor(tafsir, ayah);
  const ayahTextValue = ayahText(surah, ayah);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">تفسير القرآن الكريم</p>
          <h1>تفسير ابن كثير</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card tafsir-picker">
        <label>
          السورة
          <select
            value={surah}
            onChange={(event) => go(Number(event.target.value), 1, true)}
          >
            {surahs.map((item) => (
              <option key={item.id} value={item.id}>
                {item.id}. {item.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          الآية
          <input
            type="number"
            min={1}
            max={data.total_verses}
            value={ayah}
            onChange={(event) =>
              go(surah, Number(event.target.value) || 1, true)
            }
          />
        </label>
      </section>

      <section className="card tafsir-verse-card">
        <p className="eyebrow">
          سورة {data.name} · الآية {arabicNumber(ayah)} من{' '}
          {arabicNumber(data.total_verses)}
        </p>
        <p className="tafsir-verse" dir="rtl" lang="ar">
          {ayahTextValue}
        </p>
      </section>

      <section className="card tafsir-body-card">
        <div className="section-head">
          <h2>تفسير ابن كثير</h2>
          <span className="pill pill-soft">ت ٧٧٤هـ</span>
        </div>

        {status === 'loading' ? (
          <p className="tafsir-loading" role="status">
            <Loader2 size={18} className="spin" aria-hidden /> جارٍ تحميل تفسير
            السورة…
          </p>
        ) : null}

        {status === 'error' ? (
          <div className="tafsir-error" role="alert">
            <p>
              تعذّر تحميل التفسير. تحقّق من الاتصال ثم أعد المحاولة — التفسير
              يُحمّل مرة واحدة لكل سورة ثم يبقى في الجهاز.
            </p>
            <button
              className="btn btn-secondary"
              onClick={() => setAttempt((value) => value + 1)}
            >
              <RefreshCw size={17} aria-hidden /> إعادة المحاولة
            </button>
          </div>
        ) : null}

        {status === 'ready' && current ? (
          <div
            className="tafsir-body"
            dir="rtl"
            lang="ar"
            /* المحتوى ملف ثابت منظّف في scripts/build-tafsir.mjs: p/span فقط. */
            dangerouslySetInnerHTML={{ __html: current.text }}
          />
        ) : null}

        {status === 'ready' && !current ? (
          <div className="tafsir-missing">
            <ScrollText size={20} aria-hidden />
            <p>
              لم يخصّ ابن كثير هذه الآية بنصّ مستقل في النسخة الرقمية. جرّب
              الآية السابقة أو التالية.
            </p>
          </div>
        ) : null}
      </section>

      <div className="tafsir-nav">
        <button
          className="btn btn-ghost"
          onClick={() => previous && go(previous.surah, previous.ayah)}
          disabled={!previous}
        >
          <ChevronRight size={18} aria-hidden /> السابقة
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => next && go(next.surah, next.ayah)}
          disabled={!next}
        >
          التالية <ChevronLeft size={18} aria-hidden />
        </button>
      </div>

      <p className="muted small">
        النص المنسوب إلى الحافظ ابن كثير (ت ٧٧٤هـ) من نسخة quran.com الرقمية،
        منظّف ومعروض لكل آية. قد يختصر النص أو يجمع كلام ابن كثير على آيات
        متتالية.
      </p>
    </div>
  );
}
