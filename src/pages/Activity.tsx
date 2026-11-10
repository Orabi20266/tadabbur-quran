import { useState } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDays, Clock, History, ListChecks, Sparkles, TriangleAlert } from 'lucide-react';
import {
  useApp,
  removeMistake,
  restoreMistake,
  todayKey,
} from '../lib/store';
import { arabicNumber, getSurah } from '../lib/quran';
import { MistakesList, timeLabel } from '../components/MistakesList';

type Tab = 'sessions' | 'mistakes';

function dayLabel(ts: number): string {
  const key = todayKey(new Date(ts));
  if (key === todayKey()) return 'اليوم';
  const y = new Date();
  y.setDate(y.getDate() - 1);
  if (key === todayKey(y)) return 'أمس';
  return new Intl.DateTimeFormat('ar-u-nu-arab', { day: 'numeric', month: 'long' }).format(new Date(ts));
}

export function Activity() {
  const sessions = useApp((s) => s.sessions);
  const mistakes = useApp((s) => s.mistakes);
  const daily = useApp((s) => s.daily);
  const [tab, setTab] = useState<Tab>('sessions');

  const activeMistakes = mistakes.filter((m) => !m.removed);
  const days = Object.entries(daily)
    .sort((a, b) => (a[0] < b[0] ? 1 : -1))
    .slice(0, 14);
  const recent = sessions.slice().reverse();
  const recentMistakes = mistakes.slice().reverse();

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <History size={14} aria-hidden /> سجلّك
          </p>
          <h1>السجل</h1>
        </div>
      </header>

      <div className="stat-grid">
        <div className="stat">
          <strong>{arabicNumber(sessions.length)}</strong>
          <span>جلسة</span>
        </div>
        <div className="stat is-bad">
          <strong>{arabicNumber(activeMistakes.length)}</strong>
          <span>خطأ مسجّل</span>
        </div>
        <div className="stat is-good">
          <strong>{arabicNumber(Object.keys(daily).length)}</strong>
          <span>يوم نشاط</span>
        </div>
      </div>

      <section className="card heat-card">
        <header className="section-head">
          <h2 className="section-title">
            <CalendarDays size={17} aria-hidden /> آخر ١٤ يوماً
          </h2>
        </header>
        <div className="heat" aria-hidden>
          {Array.from({ length: 14 }).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (13 - i));
            const key = todayKey(d);
            const value = daily[key]?.ayahs ?? 0;
            const level = value === 0 ? 0 : value < 3 ? 1 : value < 8 ? 2 : 3;
            return <span key={key} className={`heat-cell heat-${level}`} title={`${key}: ${value}`} />;
          })}
        </div>
        {!days.length ? <p className="muted small">لا نشاط بعد. أول جلسة تظهر هنا.</p> : null}
      </section>

      <div className="segmented" role="tablist" aria-label="نوع السجل">
        <button
          role="tab"
          aria-selected={tab === 'sessions'}
          className={tab === 'sessions' ? 'is-active' : ''}
          onClick={() => setTab('sessions')}
        >
          الجلسات
        </button>
        <button
          role="tab"
          aria-selected={tab === 'mistakes'}
          className={tab === 'mistakes' ? 'is-active' : ''}
          onClick={() => setTab('mistakes')}
        >
          الأخطاء
        </button>
      </div>

      {tab === 'sessions' ? (
        recent.length ? (
          <ul className="clean session-list">
            {recent.map((s) => (
              <li key={s.id} className="card session-card">
                <span className="session-icon">
                  <Clock size={18} aria-hidden />
                </span>
                <span className="session-copy">
                  <strong>{getSurah(s.surah).name}</strong>
                  <small className="muted">
                    الآيات {arabicNumber(s.fromAyah)}–{arabicNumber(s.toAyah)} ·{' '}
                    {dayLabel(s.startedAt)} · {timeLabel(s.startedAt)}
                  </small>
                </span>
                <span className="session-meta">
                  <span className={s.mistakes ? 'is-bad' : 'is-good'}>
                    {arabicNumber(s.mistakes)} خطأ
                  </span>
                  <small className="muted">{arabicNumber(s.ayahsRevealed)} آية</small>
                </span>
                <Link
                  className="icon-btn"
                  to={`/read/${s.surah}?ayah=${s.fromAyah}`}
                  aria-label={`افتح ${getSurah(s.surah).name}`}
                >
                  ←
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <div className="card empty">
            <ListChecks size={26} aria-hidden />
            <p>لا جلسات بعد. ابدأ تلاوة من الذاكرة لتظهر هنا.</p>
            <Link className="btn btn-primary" to="/memorize">
              اذهب إلى الحفظ
            </Link>
          </div>
        )
      ) : (
        <section className="card">
          {recentMistakes.length ? (
            <MistakesList
              mistakes={recentMistakes}
              onRemove={removeMistake}
              onRestore={restoreMistake}
            />
          ) : (
            <div className="empty">
              <Sparkles size={26} aria-hidden />
              <p>سجل الأخطاء فارغ. كل تلاوة نظيفة تُبقي هذا السجل فارغاً.</p>
              <Link className="btn btn-primary" to="/memorize">
                ابدأ جلسة
              </Link>
            </div>
          )}
        </section>
      )}

      {activeMistakes.length > 0 ? (
        <p className="muted small center">
          <TriangleAlert size={13} aria-hidden /> يمكنك إزالة أي خطأ علّمته بالخطأ من قائمة الأخطاء.
        </p>
      ) : null}
    </div>
  );
}
