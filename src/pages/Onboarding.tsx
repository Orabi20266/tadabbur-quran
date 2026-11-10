import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  BookOpenText,
  Check,
  ChevronLeft,
  Headphones,
  ListChecks,
  Mic,
  Sparkles,
  Target,
  TriangleAlert,
} from 'lucide-react';
import { getSurah, surahs } from '../lib/quran';
import { setLastRead, setOnboarded, updateSettings, useApp } from '../lib/store';

const features = [
  {
    icon: Mic,
    title: 'تلاوة من الذاكرة',
    text: 'أخفِ الآيات واقرأ بصوتك، والتتبّع يمشي معك كلمة بكلمة.',
  },
  {
    icon: ListChecks,
    title: 'أخطاء مُعلّمة',
    text: 'كل خطأ يُسجَّل مع كلمته، ويمكنك إزالته إذا كان علماً خاطئاً.',
  },
  {
    icon: Target,
    title: 'خريطة حفظ',
    text: 'علّم ما أتممت حفظه، وشاهد تقدّمك في كل سورة.',
  },
  {
    icon: Headphones,
    title: 'يعمل دون اتصال',
    text: 'ثبّته كتطبيق على شاشتك، ويبقى نص المصحف وسجلك على جهازك.',
  },
];

export function Onboarding() {
  const navigate = useNavigate();
  const lastRead = useApp((s) => s.lastRead);
  const goalAyahs = useApp((s) => s.settings.goalAyahs);
  const [step, setStep] = useState(0);
  const [surah, setSurah] = useState(lastRead.surah);
  const [ayah, setAyah] = useState(lastRead.ayah);
  const [goal, setGoal] = useState(goalAyahs);

  const sData = getSurah(surah);

  const finish = (start: boolean) => {
    updateSettings({ goalAyahs: goal });
    if (start) setLastRead(surah, Math.min(ayah, sData.total_verses));
    setOnboarded(true);
    navigate(start ? `/read/${surah}?ayah=${ayah}` : '/');
  };

  return (
    <div className="onboarding">
      <div className="onboarding-inner">
        <div className="onboarding-brand">
          <span className="brand-mark brand-lg">تدبّر</span>
          <span className="pill pill-soft">رفيق الحفظ</span>
        </div>

        <div className="steps" aria-hidden>
          {[0, 1, 2].map((i) => (
            <span key={i} className={i <= step ? 'on' : ''} />
          ))}
        </div>

        {step === 0 ? (
          <section className="onboarding-step">
            <h1>اقرأ من ذاكرتك، ونحن نتابع</h1>
            <p className="muted">
              حلقة حفظ بسيطة: تخفي الآيات، تتلو بصوتك، ويُعلَّم كل خطأ في وقته. لا حسابات
              ولا اشتراكات — كل شيء على جهازك.
            </p>
            <ul className="clean feature-list">
              {features.map(({ icon: Icon, title, text }) => (
                <li key={title}>
                  <span className="feature-icon">
                    <Icon size={19} aria-hidden />
                  </span>
                  <span>
                    <strong>{title}</strong>
                    <small className="muted">{text}</small>
                  </span>
                </li>
              ))}
            </ul>
            <div className="notice notice-warn">
              <TriangleAlert size={17} aria-hidden />
              <span>
                يتتبّع التطبيق الكلمات التي يسمعها من تلاوتك عبر محرّك التعرّف في
                المتصفح، ولا يتقدّم بالمؤقّت أو الصمت. إن رفضت إذن الميكروفون فالتتبّع
                اليدوي متاح كلمة بعد كلمة.
              </span>
            </div>
          </section>
        ) : null}

        {step === 1 ? (
          <section className="onboarding-step">
            <h1>من أين تبدأ؟</h1>
            <p className="muted">اختر سورتك وهدفك اليومي. يمكنك تغيير كل ذلك لاحقاً.</p>

            <label className="field">
              <span>السورة</span>
              <select
                value={surah}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  setSurah(id);
                  setAyah(1);
                }}
              >
                {surahs.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.id}. {s.name}
                  </option>
                ))}
              </select>
            </label>

            <label className="field">
              <span>تبدأ من الآية</span>
              <input
                type="number"
                min={1}
                max={sData.total_verses}
                value={ayah}
                onChange={(e) =>
                  setAyah(Math.min(sData.total_verses, Math.max(1, Number(e.target.value) || 1)))
                }
              />
              <small className="muted">
                {sData.name} فيها {sData.total_verses} آية
              </small>
            </label>

            <label className="range-row">
              <span className="range-copy">
                <strong>هدفك اليومي</strong>
                <small className="muted">{goal} آية</small>
              </span>
              <input
                type="range"
                min={1}
                max={30}
                step={1}
                value={goal}
                onChange={(e) => setGoal(Number(e.target.value))}
              />
            </label>
          </section>
        ) : null}

        {step === 2 ? (
          <section className="onboarding-step">
            <h1>جاهز</h1>
            <p className="muted">ستبدأ من هنا. لا تنسَ السماح بالميكروفون ليعمل التتبّع.</p>
            <div className="card ready-card">
              <div className="continue-icon">
                <BookOpenText size={22} aria-hidden />
              </div>
              <div className="continue-copy">
                <strong>{sData.name}</strong>
                <small className="muted">
                  من الآية {ayah} · هدف {goal} آية يومياً
                </small>
              </div>
              <Check size={20} aria-hidden />
            </div>
            <ul className="clean checklist">
              <li>
                <Check size={15} aria-hidden /> اضغط «تلاوة من الذاكرة» لتبدأ الجلسة.
              </li>
              <li>
                <Check size={15} aria-hidden /> الآيات تُخفى تلقائياً؛ اضغط أي كلمة لعرض سجلها.
              </li>
              <li>
                <Check size={15} aria-hidden /> أزل أي خطأ تراه غير صحيح من قائمة الأخطاء.
              </li>
            </ul>
          </section>
        ) : null}

        <footer className="onboarding-foot">
          {step > 0 ? (
            <button className="btn btn-ghost" onClick={() => setStep(step - 1)}>
              السابق
            </button>
          ) : (
            <button className="btn btn-ghost" onClick={() => finish(false)}>
              تخطّي
            </button>
          )}
          <span className="spacer" />
          {step < 2 ? (
            <button className="btn btn-primary" onClick={() => setStep(step + 1)}>
              التالي <ChevronLeft size={17} aria-hidden />
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => finish(true)}>
              <Sparkles size={17} aria-hidden /> ابدأ الآن
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}
