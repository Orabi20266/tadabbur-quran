import { useRef, useState } from 'react';
import {
  Download,
  Info,
  Keyboard,
  Mic,
  Moon,
  Palette,
  RotateCcw,
  SlidersHorizontal,
  Sun,
  Upload,
  MonitorSmartphone,
} from 'lucide-react';
import {
  exportState,
  importState,
  resetAll,
  updateSettings,
  useApp,
} from '../lib/store';
import type { Theme } from '../lib/types';
import { ToggleRow } from '../components/ToggleRow';

const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'فاتح', icon: Sun },
  { id: 'dark', label: 'داكن', icon: Moon },
  { id: 'system', label: 'النظام', icon: MonitorSmartphone },
];

export function Settings() {
  const settings = useApp((s) => s.settings);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const notify = (text: string) => {
    setMsg(text);
    window.setTimeout(() => setMsg(null), 2500);
  };

  const download = () => {
    const blob = new Blob([exportState()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `tadabbur-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    notify('تم تصدير النسخة الاحتياطية.');
  };

  const importFile = async (file: File) => {
    const text = await file.text();
    if (importState(text)) notify('تم استيراد البيانات بنجاح.');
    else notify('الملف غير صالح — يجب أن يكون نسخة تدبّر بصيغة schema 1.');
  };

  const reset = () => {
    if (!window.confirm('سيُحذف كل سجلك وعلامات حفظك على هذا الجهاز. متابعة؟')) return;
    resetAll();
    notify('أُعيد ضبط البيانات.');
  };

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">
            <SlidersHorizontal size={14} aria-hidden /> تخصيص
          </p>
          <h1>الإعدادات</h1>
        </div>
      </header>

      {msg ? (
        <div className="toast toast-inline" role="status">
          {msg}
        </div>
      ) : null}

      <section className="card settings-card">
        <h2 className="section-title">
          <Palette size={17} aria-hidden /> المظهر
        </h2>
        <div className="segmented" role="radiogroup" aria-label="السمة">
          {themes.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={settings.theme === id}
              className={settings.theme === id ? 'is-active' : ''}
              onClick={() => updateSettings({ theme: id })}
            >
              <Icon size={16} aria-hidden /> {label}
            </button>
          ))}
        </div>

        <label className="range-row">
          <span className="range-copy">
            <strong>حجم خط المصحف</strong>
            <small className="muted">{settings.fontSize}px</small>
          </span>
          <input
            type="range"
            min={22}
            max={52}
            step={1}
            value={settings.fontSize}
            onChange={(e) => updateSettings({ fontSize: Number(e.target.value) })}
          />
        </label>
        <p
          className="mushaf-preview"
          style={{ fontSize: `${settings.fontSize}px` }}
          lang="ar"
        >
          إِنَّا أَعۡطَيۡنَٰكَ ٱلۡكَوۡثَرَ
        </p>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">
          <Mic size={17} aria-hidden /> التتبّع
        </h2>
        <div className="segmented" role="radiogroup" aria-label="محرّك التتبّع">
          <button
            role="radio"
            aria-checked={settings.speechEngine === 'browser'}
            className={settings.speechEngine === 'browser' ? 'is-active' : ''}
            onClick={() =>
              updateSettings({ speechEngine: 'browser', speechConsent: true })
            }
          >
            <Mic size={16} aria-hidden /> تعرّف المتصفح
          </button>
          <button
            role="radio"
            aria-checked={settings.speechEngine === 'manual'}
            className={settings.speechEngine === 'manual' ? 'is-active' : ''}
            onClick={() =>
              updateSettings({ speechEngine: 'manual', speechConsent: true })
            }
          >
            <Keyboard size={16} aria-hidden /> يدوي
          </button>
        </div>
        <p className="muted small">
          في وضع التعرّف الصوتي يتقدّم التتبّع فقط عندما يسمع المحرّك كلمة من الآية؛
          لا مؤقّت ولا تقدّم تلقائي. قد يعالج المتصفح الصوت في خدمة سحابية تابعة
          لمزوّده، وتدبّر لا يسجّل صوتك ولا يخزّنه.
        </p>
        <p className="muted small">
          في الوضع اليدوي تضغط «الكلمة التالية» بعد كل كلمة. هذا هو البديل عند رفض
          إذن الميكروفون أو عدم توفّر التعرّف الصوتي.
        </p>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">كشف الأخطاء</h2>
        <p className="muted small">
          يطابق المحرّك ما سمعه مع كلمات الآية. تُعلَّم الكلمة الخاطئة بالأحمر مع
          نغمة تنبيه، ويستمر التتبّع دون توقّف.
        </p>
        <ToggleRow
          label="كشف أخطاء الكلمات"
          hint="علّم الكلمة عند اختلافها عن النص"
          checked={settings.detectMistakes}
          onChange={(v) => updateSettings({ detectMistakes: v })}
        />
        <ToggleRow
          label="كشف أخطاء التشكيل"
          hint="غير متاح: تعرّف المتصفح يعيد الكلمات دون حركات"
          checked={false}
          onChange={() => {}}
          disabled
        />
      </section>

      <section className="card settings-card">
        <h2 className="section-title">العرض</h2>
        <ToggleRow
          label="تظليل سجل الأخطاء"
          hint="ألوان خفيفة على الكلمات التي أخطأت فيها سابقاً"
          checked={settings.highlightHistory}
          onChange={(v) => updateSettings({ highlightHistory: v })}
        />
        <ToggleRow
          label="إخفاء أرقام الآيات أثناء الجلسة"
          hint="عرض أنظف عند الحفظ"
          checked={settings.hideAyahMarkers}
          onChange={(v) => updateSettings({ hideAyahMarkers: v })}
        />
        <label className="range-row">
          <span className="range-copy">
            <strong>هدف اليوم</strong>
            <small className="muted">{settings.goalAyahs} آية</small>
          </span>
          <input
            type="range"
            min={1}
            max={30}
            step={1}
            value={settings.goalAyahs}
            onChange={(e) => updateSettings({ goalAyahs: Number(e.target.value) })}
          />
        </label>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">بياناتك</h2>
        <p className="muted small">
          كل شيء محفوظ على جهازك في localStorage. صدّر نسخة قبل تغيير المتصفح أو مسح بياناته.
        </p>
        <div className="row wrap">
          <button className="btn btn-secondary" onClick={download}>
            <Download size={17} aria-hidden /> تصدير
          </button>
          <button className="btn btn-secondary" onClick={() => fileRef.current?.click()}>
            <Upload size={17} aria-hidden /> استيراد
          </button>
          <button className="btn btn-danger" onClick={reset}>
            <RotateCcw size={17} aria-hidden /> إعادة ضبط
          </button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importFile(f);
            e.target.value = '';
          }}
        />
      </section>

      <section className="card settings-card about-card">
        <h2 className="section-title">
          <Info size={17} aria-hidden /> حول التطبيق
        </h2>
        <p className="small">
          <strong>تدبّر</strong> — نسخة تعلّم شخصية لحلقة الحفظ: إخفاء الآيات، التلاوة من
          الذاكرة، تتبّع الكلمات، وسجل الأخطاء. مبنية من الصفر، ولا تستخدم أي كود أو أصول
          من التطبيقات التجارية.
        </p>
        <p className="muted small">
          نص القرآن الكريم: <strong>quran-json</strong> (المصدر: Tanzil.net) بترخيص
          CC-BY-4.0. الخطوط: Amiri Quran و IBM Plex Sans Arabic بترخيص OFL.
        </p>
        <p className="muted small">
          التعرّف الصوتي يتم عبر محرّك متصفحك، ومطابقة الكلمات مع نص المصحف تجري
          محلياً داخل التطبيق. المرحلة التالية تستبدله بمحرّك مفتوح المصدر مستضاف
          ذاتياً عبر WebSocket.
        </p>
        <p className="muted small">الإصدار 0.1.0</p>
      </section>
    </div>
  );
}
