import { useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
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
  Trash2,
  Upload,
  MonitorSmartphone,
  RefreshCw,
  WifiOff,
} from 'lucide-react';
import {
  exportState,
  importState,
  resetAll,
  updateSettings,
  useApp,
} from '../lib/store';
import type { Theme } from '../lib/types';
import { arabicNumber } from '../lib/quran';
import { APP_VERSION } from '../lib/version';
import { checkForUpdate } from '../lib/update';
import {
  clearOfflineAnswers,
  downloadOfflinePack,
  offlineCount,
} from '../lib/dorarOffline';
import { ToggleRow } from '../components/ToggleRow';

const themes: { id: Theme; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: 'فاتح', icon: Sun },
  { id: 'dark', label: 'داكن', icon: Moon },
  { id: 'system', label: 'النظام', icon: MonitorSmartphone },
];

export function Settings() {
  const settings = useApp((s) => s.settings);
  const nativeApp = Capacitor.isNativePlatform();
  const [msg, setMsg] = useState<string | null>(null);
  const [offlineTotal, setOfflineTotal] = useState(offlineCount);
  const [packStatus, setPackStatus] = useState<string | null>(null);
  const [packBusy, setPackBusy] = useState(false);
  const [updateBusy, setUpdateBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const speechBiasing =
    typeof window !== 'undefined' &&
    typeof (window as unknown as { SpeechRecognitionPhrase?: unknown })
      .SpeechRecognitionPhrase === 'function';

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

  const downloadPack = async () => {
    if (!navigator.onLine) {
      notify('لا يوجد اتصال الآن. جرّب بعد العودة إلى الإنترنت.');
      return;
    }
    setPackBusy(true);
    setPackStatus('جارٍ تجهيز الحزمة…');
    try {
      const result = await downloadOfflinePack((done, total, label) => {
        setPackStatus(`جارٍ تنزيل ${label} (${arabicNumber(done)}/${arabicNumber(total)})`);
      });
      setOfflineTotal(offlineCount());
      if (result.failed.length) {
        setPackStatus(
          `اكتمل جزئياً: ${arabicNumber(result.ok)} جديد، ${arabicNumber(result.failed.length)} تعذّر؛ أعد المحاولة لاحقاً.`,
        );
        notify('بعض الأحاديث لم تُحمَّل؛ أعد المحاولة عند توفر الاتصال.');
      } else {
        setPackStatus(
          `الحزمة جاهزة: ${arabicNumber(result.ok)} جديد، ${arabicNumber(result.skipped)} كان محفوظاً.`,
        );
        notify('أُضيفت الحزمة للقراءة دون إنترنت.');
      }
    } catch {
      setPackStatus('تعذّر تنزيل الحزمة. تحقق من الاتصال ثم أعد المحاولة.');
    } finally {
      setPackBusy(false);
    }
  };

  const clearOffline = () => {
    if (!window.confirm('سيُحذف ما حفظته من نتائج الدرر على هذا الجهاز. متابعة؟')) return;
    clearOfflineAnswers();
    setOfflineTotal(0);
    setPackStatus(null);
    notify('حُذفت الإجابات المحفوظة.');
  };

  const checkUpdate = async () => {
    setUpdateBusy(true);
    try {
      const info = await checkForUpdate(true);
      notify(info ? `توجد نسخة جديدة: ${info.version}` : 'أنت على آخر نسخة متاحة.');
    } catch {
      notify('تعذّر التحقق من التحديث الآن.');
    } finally {
      setUpdateBusy(false);
    }
  };

  /** Drop the service worker and its cache, then load the published bundle. */
  const refreshApp = async () => {
    if (
      !window.confirm(
        'سيُعاد تحميل التطبيق من آخر نسخة منشورة. بياناتك المحفوظة لا تُحذف. متابعة؟',
      )
    )
      return;
    try {
      const regs = await navigator.serviceWorker?.getRegistrations?.();
      await Promise.all((regs ?? []).map((reg) => reg.unregister()));
      if ('caches' in window) {
        const keys = await caches.keys();
        await Promise.all(keys.map((key) => caches.delete(key)));
      }
    } catch {
      /* storage may be unavailable; a plain reload still helps */
    }
    window.location.reload();
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
        <p className="muted small">
          {speechBiasing
            ? 'توجيه السماع: مفعّل — تُمرَّر كلمات الآية القادمة إلى المحرّك ليتعرّف على الألفاظ القرآنية النادرة.'
            : 'توجيه السماع: غير مدعوم في هذا المتصفح. استخدم Chrome حديثًا على الحاسب أو أندرويد لتحسين سماع الكلمات النادرة.'}
        </p>
      </section>

      <section className="card settings-card">
        <h2 className="section-title">كشف الأخطاء</h2>
        <p className="muted small">
          يطابق المحرّك ما سمعه مع كلمات الآية. تُعلَّم الكلمة الخاطئة بالأحمر وخطأ
          الحركة بالكهرماني، مع نغمة تنبيه، ويستمر التتبّع دون توقّف.
        </p>
        <ToggleRow
          label="كشف أخطاء الكلمات"
          hint="علّم الكلمة عند اختلافها عن النص"
          checked={settings.detectMistakes}
          onChange={(v) => updateSettings({ detectMistakes: v })}
        />
        <ToggleRow
          label="كشف أخطاء التشكيل"
          hint="إن أعاد المحرّك الحركات فحصها تلقائياً؛ وإلا سجّلها بزر «حركة» أو من بطاقة الكلمة"
          checked={settings.detectTashkeel}
          onChange={(v) => updateSettings({ detectTashkeel: v })}
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

      <section className="card settings-card">
        <h2 className="section-title">
          <WifiOff size={17} aria-hidden /> القراءة دون إنترنت
        </h2>
        <p className="muted small">
          تُحفظ إجابات الدرر التي تفتحها أثناء الاتصال تلقائياً على جهازك، فتُعرض
          عند انقطاع الشبكة. يمكنك أيضاً تنزيل حزمة مختارة من الأحاديث مرة واحدة.
        </p>
        <p className="muted small">
          المحفوظ حالياً: {arabicNumber(offlineTotal)} إجابة.
        </p>
        <div className="row wrap">
          <button
            className="btn btn-secondary"
            onClick={() => void downloadPack()}
            disabled={packBusy}
          >
            <Download size={17} aria-hidden />
            {packBusy ? 'جارٍ التنزيل…' : 'تنزيل حزمة أحاديث'}
          </button>
          {offlineTotal > 0 ? (
            <button className="btn btn-danger" onClick={clearOffline} disabled={packBusy}>
              <Trash2 size={17} aria-hidden /> مسح المحفوظات
            </button>
          ) : null}
        </div>
        {packStatus ? <p className="offline-status muted">{packStatus}</p> : null}
        <p className="muted small">
          تظهر الإجابات المحفوظة في أعلى صفحة «المحادثة»، ويمكن فتحها مباشرة دون
          بحث جديد.
        </p>
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
          {nativeApp
            ? 'التعرّف الصوتي يتم عبر محرّك النظام، ومطابقة الكلمات مع نص المصحف تجري محلياً داخل التطبيق.'
            : 'التعرّف الصوتي يتم عبر محرّك متصفحك، ومطابقة الكلمات مع نص المصحف تجري محلياً داخل التطبيق. المرحلة التالية تستبدله بمحرّك مفتوح المصدر مستضاف ذاتياً عبر WebSocket.'}
        </p>
        <p className="muted small">
          الإصدار {APP_VERSION} · بناء <span className="mono">{__BUILD_ID__}</span>
        </p>
        {nativeApp ? (
          <div className="row wrap">
            <button
              className="btn btn-secondary"
              onClick={() => void checkUpdate()}
              disabled={updateBusy}
            >
              <RefreshCw size={17} aria-hidden />
              {updateBusy ? 'جارٍ البحث…' : 'التحقق من تحديث'}
            </button>
          </div>
        ) : null}
        {nativeApp ? null : (
          <>
            <div className="row wrap">
              <button className="btn btn-secondary" onClick={() => void refreshApp()}>
                <RefreshCw size={17} aria-hidden /> تحميل آخر نسخة
              </button>
            </div>
            <p className="muted small">
              إن بدا أن الرابط يعرض سلوكًا قديمًا، فهذا الزر يزيل نسخة الخدمة
              المخزّنة ويعيد التحميل من الشبكة. لا يمسّ سجلك.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
