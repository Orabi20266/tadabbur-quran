import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  BookOpenText,
  Check,
  ChevronDown,
  Search,
  Sparkles,
  Target,
} from 'lucide-react';
import { useApp, toggleMark, markRange, memorizedCount } from '../lib/store';
import { arabicNumber, getSurah, surahs, TOTAL_AYAHS } from '../lib/quran';

export function Tracker() {
  const marks = useApp((s) => s.marks);
  const goalAyahs = useApp((s) => s.settings.goalAyahs);
  const lastRead = useApp((s) => s.lastRead);
  const [open, setOpen] = useState<number | null>(null);
  const [query, setQuery] = useState('');

  const total = memorizedCount(marks);
  const pct = Math.min(100, Math.round((total / Math.max(1, TOTAL_AYAHS)) * 100));

  const list = useMemo(() => {
    const q = query.trim();
    if (!q) return surahs;
    return surahs.filter(
      (s) =>
        s.name.includes(q) ||
        s.transliteration.toLowerCase().includes(q.toLowerCase()) ||
        String(s.id) === q,
    );
  }, [query]);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <Target size={14} aria-hidden /> خريطة الحفظ
          </p>
          <h1>الحفظ</h1>
        </div>
        <span className="pill">{arabicNumber(pct)}%</span>
      </header>

      <section className="card tracker-summary">
        <div
          className="ring"
          style={{
            background: `conic-gradient(var(--accent) ${pct}%, var(--surface-2) ${pct}% 100%)`,
          }}
          role="img"
          aria-label={`${pct}% من القرآن`}
        >
          <div className="ring-inner">
            <strong>{arabicNumber(pct)}%</strong>
          </div>
        </div>
        <div className="goal-copy">
          <strong>
            {arabicNumber(total)} من {arabicNumber(TOTAL_AYAHS)} آية
          </strong>
          <small className="muted">
            علّم الآيات التي أتممت حفظها لتظهر خريطتك. هدف اليوم: {arabicNumber(goalAyahs)} آية.
          </small>
        </div>
        <Link className="btn btn-primary" to={`/read/${lastRead.surah}?ayah=${lastRead.ayah}`}>
          <BookOpenText size={17} aria-hidden /> اقرأ
        </Link>
      </section>

      <label className="search-field">
        <Search size={18} aria-hidden />
        <input
          type="search"
          placeholder="ابحث باسم السورة أو رقمها"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="ابحث عن سورة"
        />
      </label>

      <section className="card surah-list-card">
        <ul className="clean surah-list">
          {list.map((s) => {
            const marked = marks[String(s.id)] ?? [];
            const done = marked.length;
            const per = Math.round((done / s.total_verses) * 100);
            const isOpen = open === s.id;
            return (
              <li key={s.id} className={isOpen ? 'is-open' : ''}>
                <button
                  type="button"
                  className="surah-row"
                  onClick={() => setOpen(isOpen ? null : s.id)}
                  aria-expanded={isOpen}
                >
                  <span className="surah-num">{arabicNumber(s.id)}</span>
                  <span className="surah-copy">
                    <strong>{s.name}</strong>
                    <small className="muted">
                      {s.type === 'meccan' ? 'مكية' : 'مدنية'} · {arabicNumber(s.total_verses)} آية
                    </small>
                  </span>
                  <span className="surah-progress" aria-hidden>
                    <span style={{ width: `${per}%` }} />
                  </span>
                  <span className="surah-count muted small">
                    {arabicNumber(done)}/{arabicNumber(s.total_verses)}
                  </span>
                  <ChevronDown
                    size={18}
                    className="chev"
                    style={{ transform: isOpen ? 'rotate(180deg)' : undefined }}
                    aria-hidden
                  />
                </button>

                {isOpen ? (
                  <div className="ayah-grid-wrap">
                    <div className="ayah-grid" role="group" aria-label={`آيات ${s.name}`}>
                      {Array.from({ length: s.total_verses }).map((_, i) => {
                        const a = i + 1;
                        const on = marked.includes(a);
                        return (
                          <button
                            key={a}
                            type="button"
                            className={`ayah-chip${on ? ' is-on' : ''}`}
                            onClick={() => toggleMark(s.id, a)}
                            aria-pressed={on}
                            aria-label={`الآية ${a}${on ? ' محفوظة' : ''}`}
                          >
                            {on ? <Check size={13} aria-hidden /> : null}
                            {arabicNumber(a)}
                          </button>
                        );
                      })}
                    </div>
                    <div className="row wrap">
                      <button className="btn btn-sm btn-secondary" onClick={() => markRange(s.id, 1, s.total_verses, true)}>
                        تعليم الكل
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => markRange(s.id, 1, s.total_verses, false)}>
                        إلغاء الكل
                      </button>
                      <span className="spacer" />
                      <Link className="btn btn-sm btn-primary" to={`/read/${s.id}?ayah=1`}>
                        افتح السورة
                      </Link>
                    </div>
                  </div>
                ) : null}
              </li>
            );
          })}
        </ul>

        {!list.length ? (
          <div className="empty">
            <Sparkles size={24} aria-hidden />
            <p>لا سورة بهذا الاسم. جرّب رقماً أو اسماً آخر.</p>
          </div>
        ) : null}
      </section>

      <p className="muted small center">
        تُحفظ العلامات على جهازك فقط. {getSurah(lastRead.surah).name} آخر موضع قراءة.
      </p>
    </div>
  );
}
