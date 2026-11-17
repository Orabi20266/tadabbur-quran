import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookMarked,
  Bookmark,
  Check,
  Copy,
  ExternalLink,
  MessageCircle,
  Search,
  X,
} from 'lucide-react';
import { hadiths, hadithTopics } from '../data/hadith';
import type { Hadith } from '../data/hadith';
import { arabicNumber, normalizeArabic } from '../lib/quran';

const STORAGE_KEY = 'tadabbur.hadith.v1';

interface Stored {
  saved: string[];
}

function loadSaved(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return Array.isArray(parsed.saved) ? parsed.saved : [];
  } catch {
    return [];
  }
}

function saveSaved(saved: string[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ saved }));
  } catch {
    /* التخزين قد يكون معطّلاً */
  }
}

const topicTitle = Object.fromEntries(hadithTopics.map((t) => [t.id, t.title]));

function dorarUrl(hadith: Hadith): string {
  return `https://dorar.net/hadith/search?q=${encodeURIComponent(hadith.query)}`;
}

function gradeTone(grade: string): string {
  if (grade.includes('صحيح')) return 'is-sahih';
  if (grade.includes('حسن')) return 'is-hasan';
  return '';
}

export function HadithPage() {
  const [search, setSearch] = useState('');
  const [topic, setTopic] = useState<string>('all');
  const [savedOnly, setSavedOnly] = useState(false);
  const [saved, setSaved] = useState<string[]>(loadSaved);
  const [copied, setCopied] = useState<string | null>(null);
  const copyTimer = useRef<number | null>(null);

  useEffect(() => {
    saveSaved(saved);
  }, [saved]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    },
    [],
  );

  const counts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const hadith of hadiths) map[hadith.topic] = (map[hadith.topic] ?? 0) + 1;
    return map;
  }, []);

  const filtered = useMemo(() => {
    const query = normalizeArabic(search.trim());
    return hadiths.filter((hadith) => {
      if (topic !== 'all' && hadith.topic !== topic) return false;
      if (savedOnly && !saved.includes(hadith.id)) return false;
      if (!query) return true;
      const haystack = normalizeArabic(
        [
          hadith.text,
          hadith.narrator ?? '',
          hadith.scholar,
          hadith.source,
          hadith.reference,
          topicTitle[hadith.topic] ?? '',
        ].join(' '),
      );
      return haystack.includes(query);
    });
  }, [search, topic, savedOnly, saved]);

  const toggleSaved = (id: string) => {
    setSaved((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id],
    );
  };

  const copy = async (hadith: Hadith) => {
    const origin = `${hadith.source}${hadith.reference ? ` (${hadith.reference})` : ''}`;
    const text = `${hadith.text}\n\n— ${origin}\nالمصدر: موسوعة الدرر السنية ${dorarUrl(hadith)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(hadith.id);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">من موسوعة الدرر السنية</p>
          <h1>الحديث الشريف</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card hadith-intro">
        <span className="hadith-intro-icon">
          <BookMarked size={26} aria-hidden />
        </span>
        <div>
          <strong>
            {arabicNumber(hadiths.length)} حديثاً صحيحاً في{' '}
            {arabicNumber(hadithTopics.length)} باباً
          </strong>
          <p className="muted small">
            نصوص مختارة من موسوعة الدرر السنية، مع الراوي والمصدر ودرجة الحديث
            كما ذكرها المصدر. اضغط «الدرر السنية» لفتح البحث الأصلي.
          </p>
          <div className="hadith-intro-actions">
            <a
              className="hadith-source-link"
              href="https://dorar.net/hadith"
              target="_blank"
              rel="noreferrer"
            >
              dorar.net/hadith
              <ExternalLink size={13} aria-hidden />
            </a>
            <Link className="btn btn-primary btn-sm" to="/ask">
              <MessageCircle size={14} aria-hidden />
              اسأل الدرر
            </Link>
          </div>
        </div>
      </section>

      <div className="hadith-search">
        <Search size={18} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث في النص أو الراوي أو المصدر"
          aria-label="بحث في الأحاديث"
        />
        {search ? (
          <button
            className="hadith-search-clear"
            onClick={() => setSearch('')}
            aria-label="مسح البحث"
          >
            <X size={16} />
          </button>
        ) : null}
      </div>

      <div className="hadith-filters" role="group" aria-label="تصفية الأحاديث">
        <button
          className={`topic-chip${topic === 'all' && !savedOnly ? ' is-active' : ''}`}
          onClick={() => {
            setTopic('all');
            setSavedOnly(false);
          }}
        >
          الكل
          <span>{arabicNumber(hadiths.length)}</span>
        </button>
        {hadithTopics.map((item) => (
          <button
            key={item.id}
            className={`topic-chip${topic === item.id && !savedOnly ? ' is-active' : ''}`}
            onClick={() => {
              setTopic(item.id);
              setSavedOnly(false);
            }}
          >
            {item.title}
            <span>{arabicNumber(counts[item.id] ?? 0)}</span>
          </button>
        ))}
        <button
          className={`topic-chip is-saved${savedOnly ? ' is-active' : ''}`}
          onClick={() => setSavedOnly((value) => !value)}
          disabled={saved.length === 0 && !savedOnly}
        >
          <Bookmark size={13} aria-hidden />
          المحفوظة
          <span>{arabicNumber(saved.length)}</span>
        </button>
      </div>

      <div className="hadith-results">
        <span className="muted small">
          {filtered.length === 0
            ? 'لا توجد أحاديث مطابقة'
            : `${arabicNumber(filtered.length)} حديثاً`}
        </span>
        {savedOnly ? (
          <span className="muted small">· تعرض المحفوظة فقط</span>
        ) : null}
      </div>

      {filtered.length === 0 ? (
        <section className="card hadith-empty">
          <p className="muted">
            لم نجد حديثاً يطابق «{search || 'هذا الاختيار'}». جرّب كلمة أخرى أو
            أزل التصفية.
          </p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSearch('');
              setTopic('all');
              setSavedOnly(false);
            }}
          >
            إزالة التصفية
          </button>
        </section>
      ) : (
        <div className="hadith-list">
          {filtered.map((hadith) => {
            const isSaved = saved.includes(hadith.id);
            return (
              <article className="card hadith-card" key={hadith.id}>
                <div className="hadith-card-head">
                  <span className="hadith-topic">{topicTitle[hadith.topic]}</span>
                  <button
                    className={`hadith-save${isSaved ? ' is-saved' : ''}`}
                    onClick={() => toggleSaved(hadith.id)}
                    aria-label={isSaved ? 'إزالة من المحفوظة' : 'حفظ الحديث'}
                    aria-pressed={isSaved}
                  >
                    <Bookmark size={17} aria-hidden />
                  </button>
                </div>

                <p className="hadith-text" dir="rtl">
                  {hadith.text}
                </p>

                <div className="hadith-meta">
                  <span className={`hadith-grade ${gradeTone(hadith.grade)}`}>
                    {hadith.grade}
                  </span>
                  <span>
                    {hadith.source}
                    {hadith.reference ? ` · ${hadith.reference}` : ''}
                  </span>
                </div>

                <div className="hadith-people">
                  {hadith.narrator ? <span>الراوي: {hadith.narrator}</span> : null}
                  <span>المحدّث: {hadith.scholar}</span>
                </div>

                <div className="hadith-actions">
                  <a
                    className="hadith-action"
                    href={dorarUrl(hadith)}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <ExternalLink size={15} aria-hidden />
                    الدرر السنية
                  </a>
                  <button className="hadith-action" onClick={() => copy(hadith)}>
                    {copied === hadith.id ? (
                      <Check size={15} aria-hidden />
                    ) : (
                      <Copy size={15} aria-hidden />
                    )}
                    {copied === hadith.id ? 'نُسخ' : 'نسخ'}
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
