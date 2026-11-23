import { Link } from 'react-router-dom';
import {
  ArrowLeft,
  BookMarked,
  BookOpen,
  Flame,
  GraduationCap,
  MessageCircle,
  Play,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
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
  const readHref = `/read/${lastRead.surah}?ayah=${lastRead.ayah}`;
  const startHref = `${readHref}&session=1`;

  const shortcuts = [
    {
      to: '/hadith',
      icon: BookMarked,
      title: 'تسميع الحديث',
      text: 'الأربعون النووية، بالسند أو المتن.',
    },
    {
      to: '/ask',
      icon: MessageCircle,
      title: 'اسأل الدرر',
      text: 'جواب منقول بنصّه مع مصدره.',
    },
    {
      to: '/tafsir',
      icon: BookOpen,
      title: 'التفسير',
      text: 'افهم الآية وسياقها.',
    },
    {
      to: '/tajweed',
      icon: GraduationCap,
      title: 'التجويد',
      text: 'دروس قصيرة وتطبيقات.',
    },
  ];

  return (
    <div className="stack home">
      <header className="page-head">
        <div>
          <p className="eyebrow">{dateLabel}</p>
          <h1>السلام عليكم</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      {/* خطوة واحدة واضحة: لا يختار المستخدم بين ثلاث بطاقات متشابهة. */}
      <section className="card home-hero" aria-labelledby="home-start-title">
        <div className="home-hero-head">
          <Ring value={doneAyahs} max={goalAyahs} />
          <div className="home-hero-copy">
            <p className="eyebrow">
              <Target size={14} aria-hidden /> هدف اليوم
            </p>
            <h2 id="home-start-title">ابدأ جلسة الحفظ</h2>
            <p className="home-hero-place">
              {continueSurah.name} · الآية {arabicNumber(lastRead.ayah)}
            </p>
            <p className="muted small">
              {doneAyahs >= goalAyahs
                ? 'أتممت هدف اليوم. تقبّل الله.'
                : `${arabicNumber(doneAyahs)} من ${arabicNumber(goalAyahs)} آيات اليوم — كل آية تُتقنها تُقرّبك من الهدف.`}
            </p>
          </div>
        </div>
        <div className="home-hero-actions">
          <Link className="btn btn-primary" to={startHref}>
            <Play size={18} aria-hidden />
            ابدأ التلاوة من الذاكرة
          </Link>
          <Link className="btn btn-ghost" to={readHref}>
            اقرأ الآيات
          </Link>
        </div>
        <p className="home-hero-note">
          يظهر النص كلمةً بكلمة أثناء التلاوة، ويتوفّر التتبّع اليدوي عند تعذّر الميكروفون.
        </p>
      </section>

      <section className="card home-stats" aria-label="ملخصك">
        <div className="home-stat">
          <span className="home-stat-icon is-warm">
            <Flame size={18} aria-hidden />
          </span>
          <span>
            <strong>{arabicNumber(streak.current)}</strong>
            <small>يوم متتالي</small>
          </span>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon">
            <BookMarked size={18} aria-hidden />
          </span>
          <span>
            <strong>{arabicNumber(memorized)}</strong>
            <small>آية محفوظة</small>
          </span>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon">
            <Target size={18} aria-hidden />
          </span>
          <span>
            <strong>{arabicNumber(totalSessions)}</strong>
            <small>جلسة تلاوة</small>
          </span>
        </div>
        <div className="home-stat">
          <span className="home-stat-icon">
            <Sparkles size={18} aria-hidden />
          </span>
          <span>
            <strong>{arabicNumber(weak.length)}</strong>
            <small>للمراجعة</small>
          </span>
        </div>
      </section>

      <section className="home-section" aria-labelledby="home-links-title">
        <div className="section-head">
          <h2 className="section-title" id="home-links-title">
            ماذا تريد أن تفعل؟
          </h2>
        </div>
        <div className="quick-grid">
          {shortcuts.map(({ to, icon: Icon, title, text }) => (
            <Link className="card quick-card" to={to} key={to}>
              <span className="quick-icon">
                <Icon size={20} aria-hidden />
              </span>
              <strong>{title}</strong>
              <small className="muted">{text}</small>
              <ArrowLeft className="quick-arrow" size={17} aria-hidden />
            </Link>
          ))}
        </div>
      </section>

      <section className="card weak-card" aria-labelledby="home-review-title">
        <header className="section-head">
          <h2 className="section-title" id="home-review-title">
            <Sparkles size={17} aria-hidden /> كلمات تحتاج مراجعة
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
                      {getSurah(s).name} · الآية {arabicNumber(a)} · أخطأت {arabicNumber(st.wrong)} مرة
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
            <Link className="btn btn-primary" to={startHref}>
              ابدأ جلسة
            </Link>
          </div>
        )}
      </section>

      <p className="muted small center">
        التتبّع بالتعرّف الصوتي في المتصفح، ولا يُفتح إلا ما نطقته فعلاً.
      </p>
    </div>
  );
}
