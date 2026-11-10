import { Link } from 'react-router-dom';
import { ArrowLeft, BookmarkCheck, Flame, Play, Sparkles, Target, TriangleAlert } from 'lucide-react';
import { useApp, todayKey, highlightLevel, memorizedCount } from '../lib/store';
import { getSurah, arabicNumber, wordsOf } from '../lib/quran';

function Ring({ value, max }: { value: number; max: number }) {
  const pct = Math.min(100, Math.round((value / Math.max(1, max)) * 100));
  return (
    <div
      className="ring"
      style={{
        background: `conic-gradient(var(--accent) ${pct}%, var(--surface-2) ${pct}% 100%)`,
      }}
      role="img"
      aria-label={`${pct}% من هدف اليوم`}
    >
      <div className="ring-inner">
        <strong>{pct}%</strong>
      </div>
    </div>
  );
}

export function Dashboard() {
  const streak = useApp((s) => s.streak);
  const daily = useApp((s) => s.daily[todayKey()]);
  const settings = useApp((s) => s.settings);
  const marks = useApp((s) => s.marks);
  const sessions = useApp((s) => s.sessions);
  const wordStats = useApp((s) => s.wordStats);
  const lastRead = useApp((s) => s.lastRead);

  const goalAyahs = settings.goalAyahs;
  const doneAyahs = daily?.ayahs ?? 0;
  const memorized = memorizedCount(marks);
  const totalSessions = sessions.length;
  const weak = Object.entries(wordStats)
    .filter(([, st]) => highlightLevel(st) !== 'none')
    .sort((a, b) => b[1].wrong - a[1].wrong)
    .slice(0, 3)
    .map(([key]) => key);

  const dateLabel = new Intl.DateTimeFormat('ar-u-nu-arab', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  }).format(new Date());

  const continueSurah = getSurah(lastRead.surah);

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1>السلام عليكم</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card streak-card" aria-label="سلسلة الأيام">
        <div className="streak-flame">
          <Flame size={26} aria-hidden />
        </div>
        <div className="streak-copy">
          <strong>
            {streak.current > 0
              ? `${streak.current} ${streak.current === 1 ? 'يوم' : 'أيام'} متتالية`
              : 'ابدأ سلسلتك اليوم'}
          </strong>
          <small className="muted">
            {streak.current === 0
              ? 'أول جلسة اليوم تشعل السلسلة.'
              : `أطول سلسلة لك: ${streak.longest} يوم`}
          </small>
        </div>
        <div className="streak-days" aria-hidden>
          {Array.from({ length: 7 }).map((_, i) => {
            const d = new Date();
            d.setDate(d.getDate() - (6 - i));
            const key = todayKey(d);
            return <span key={key} className={streak.days.includes(key) ? 'on' : ''} />;
          })}
        </div>
      </section>

      <section className="card goal-card">
        <Ring value={doneAyahs} max={goalAyahs} />
        <div className="goal-copy">
          <p className="eyebrow">
            <Target size={14} aria-hidden /> هدف اليوم
          </p>
          <strong>
            {doneAyahs} من {goalAyahs} آيات
          </strong>
          <small className="muted">
            {doneAyahs >= goalAyahs
              ? 'أتممت هدف اليوم. تقبّل الله.'
              : 'كل آية تُتقنها تُقرّبك من الهدف.'}
          </small>
        </div>
        <Link className="btn btn-primary" to={`/read/${lastRead.surah}?ayah=${lastRead.ayah}&session=1`}>
          <Play size={17} aria-hidden />
          ابدأ
        </Link>
      </section>

      <Link className="card continue-card" to={`/read/${lastRead.surah}?ayah=${lastRead.ayah}`}>
        <div className="continue-icon">
          <BookmarkCheck size={22} aria-hidden />
        </div>
        <div className="continue-copy">
          <p className="eyebrow">أكمل من حيث توقفت</p>
          <strong>{continueSurah.name}</strong>
          <small className="muted">الآية {arabicNumber(lastRead.ayah)}</small>
        </div>
        <ArrowLeft size={20} aria-hidden />
      </Link>

      <div className="mini-grid">
        <div className="card mini">
          <strong>{arabicNumber(memorized)}</strong>
          <span>آية محفوظة</span>
        </div>
        <div className="card mini">
          <strong>{arabicNumber(totalSessions)}</strong>
          <span>جلسة تلاوة</span>
        </div>
        <div className="card mini">
          <strong>{arabicNumber(weak.length)}</strong>
          <span>كلمات للمراجعة</span>
        </div>
      </div>

      <section className="card weak-card">
        <header className="section-head">
          <h2 className="section-title">
            <Sparkles size={17} aria-hidden /> نقاط تحتاج مراجعة
          </h2>
        </header>
        {weak.length ? (
          <ul className="clean weak-list">
            {weak.map((key) => {
              const st = wordStats[key];
              const level = highlightLevel(st);
              const [s, a, i] = key.split(':').map(Number);
              const word = wordsOf(s, a)[i] ?? '';
              return (
                <li key={key}>
                  <span className={`dot dot-${level === 'none' ? 'wrong' : level}`} aria-hidden />
                  <span className="weak-text">
                    <strong className="quran-word">{word}</strong>
                    <small className="muted">
                      {getSurah(s).name} · الآية {arabicNumber(a)} · أخطأت {st.wrong} مرة
                    </small>
                  </span>
                  <Link className="btn btn-ghost btn-sm" to={`/read/${s}?ayah=${a}`}>
                    راجع
                  </Link>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="empty">
            <TriangleAlert size={24} aria-hidden />
            <p>لا كلمات مُعلّمة بعد. ابدأ جلسة حفظ ليظهر لك سجلّك.</p>
            <Link className="btn btn-primary" to={`/read/${lastRead.surah}?ayah=${lastRead.ayah}&session=1`}>
              ابدأ جلسة
            </Link>
          </div>
        )}
      </section>

      <p className="muted small center">
        التتبّع يعمل بالتعرّف الصوتي في المتصفح، ويُفتح كل كلمة فقط عندما تُنطق.
        عند تعذّر الميكروفون يتوفّر التتبّع اليدوي — راجع الإعدادات.
      </p>
    </div>
  );
}
