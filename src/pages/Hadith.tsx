import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bookmark,
  Check,
  ChevronLeft,
  Copy,
  Eye,
  EyeOff,
  ExternalLink,
  Mic,
  Pause,
  Play,
  Search,
  Square,
  X,
} from 'lucide-react';
import { hadiths } from '../data/hadith';
import type { Hadith } from '../data/hadith';
import { normalizeToken } from '../lib/align';
import {
  detectorWords,
  MODE_HINT,
  MODE_LABEL,
  passageText,
  passageWords,
  progressKey,
  RECITE_MODES,
} from '../lib/hadith';
import type { PassageWord, ReciteMode } from '../lib/hadith';
import { arabicNumber, normalizeArabic } from '../lib/quran';
import { playMistakeSound, primeMistakeSound } from '../lib/sound';
import { updateSettings, useApp } from '../lib/store';
import type { DetectorWord, EventType, SpeechEngine, WordStatus } from '../lib/types';
import { TranscriptTracker } from '../lib/tracker';
import type { TrackerMeta } from '../lib/tracker';
import { usePlatformSpeech } from '../lib/usePlatformSpeech';
import { Sheet } from '../components/Sheet';
import { WordSpan } from '../components/WordSpan';

const STORAGE_KEY = 'tadabbur.hadith.v1';

type Phase = 'list' | 'live' | 'summary';

interface ReciteSession {
  hadith: Hadith;
  mode: ReciteMode;
}

interface ReciteMistake {
  key: string;
  text: string;
  recitedText?: string;
  at: number;
}

interface Progress {
  best: number;
  done: boolean;
  mistakes: ReciteMistake[];
}

interface Stored {
  saved: string[];
  progress: Record<string, Progress>;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { saved: [], progress: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      saved: Array.isArray(parsed.saved) ? parsed.saved : [],
      progress: parsed.progress && typeof parsed.progress === 'object' ? parsed.progress : {},
    };
  } catch {
    return { saved: [], progress: {} };
  }
}

function speechLabel(status: string): string {
  if (status === 'listening') return 'يسمع…';
  if (status === 'starting') return 'يبدأ…';
  if (status === 'denied') return 'الميكروفون مرفوض';
  if (status === 'unsupported') return 'الميكروفون غير متاح';
  if (status === 'error') return 'تعذّر الاستماع';
  return 'الميكروفون متوقف';
}

export function HadithPage() {
  const [search, setSearch] = useState('');
  const [savedOnly, setSavedOnly] = useState(false);
  const [stored, setStored] = useState<Stored>(loadStored);
  const [selected, setSelected] = useState<Hadith | null>(null);
  const [engineChoiceOpen, setEngineChoiceOpen] = useState(false);
  const [pendingChoice, setPendingChoice] = useState<{
    hadith: Hadith;
    mode: ReciteMode;
  } | null>(null);
  const [session, setSession] = useState<ReciteSession | null>(null);
  const [phase, setPhase] = useState<Phase>('list');
  const [copied, setCopied] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<Record<string, WordStatus>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [cursor, setCursor] = useState(0);
  const [mistakes, setMistakes] = useState<ReciteMistake[]>([]);
  const [hidden, setHidden] = useState(true);
  const [paused, setPaused] = useState(false);
  const [summary, setSummary] = useState<{ words: number; errors: number } | null>(null);

  const speechConsent = useApp((s) => s.settings.speechConsent);
  const speechEngine = useApp((s) => s.settings.speechEngine);
  const copyTimer = useRef<number | null>(null);
  const trackerRef = useRef<TranscriptTracker | null>(null);
  const pendingTokensRef = useRef<string[]>([]);
  const sessionRef = useRef<ReciteSession | null>(null);
  const engineRef = useRef<SpeechEngine>('browser');
  const pausedRef = useRef(false);
  const wordsRef = useRef<PassageWord[]>([]);
  const wordByKeyRef = useRef<Record<string, PassageWord>>({});
  const cursorRef = useRef(0);
  const statusesRef = useRef<Record<string, WordStatus>>({});
  const revealedRef = useRef<Record<string, boolean>>({});
  const mistakesRef = useRef<ReciteMistake[]>([]);
  const eventRef = useRef<(word: DetectorWord, type: EventType, meta?: TrackerMeta) => void>(
    () => {},
  );
  const finishRef = useRef<() => void>(() => {});
  const speechRef = useRef({ start: () => {}, stop: () => {} });

  const handleTokens = useCallback((tokens: string[]) => {
    if (pausedRef.current) return;
    const tracker = trackerRef.current;
    if (!tracker || tracker.isDone()) {
      pendingTokensRef.current.push(...tokens);
      return;
    }
    tracker.feed(tokens);
  }, []);

  const speech = usePlatformSpeech(handleTokens, 'ar-SA', {
    phrases: () => trackerRef.current?.biasPhrases(8) ?? [],
  });
  speechRef.current = { start: speech.start, stop: speech.stop };

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    } catch {
      /* التخزين قد يكون معطّلاً */
    }
  }, [stored]);

  useEffect(
    () => () => {
      if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
      speechRef.current.stop();
    },
    [],
  );

  const persistProgress = useCallback(
    (recite: ReciteSession, reached: number, done: boolean) => {
      const total = wordsRef.current.length;
      if (!total || reached <= 0) return;
      const fraction = Math.min(1, reached / total);
      const key = progressKey(recite.hadith, recite.mode);
      setStored((prev) => {
        const old = prev.progress[key] ?? { best: 0, done: false, mistakes: [] };
        return {
          ...prev,
          progress: {
            ...prev.progress,
            [key]: {
              best: Math.max(old.best, fraction),
              done: old.done || done,
              mistakes: mistakesRef.current,
            },
          },
        };
      });
    },
    [],
  );

  const beginSession = useCallback(
    (hadith: Hadith, mode: ReciteMode, engine: SpeechEngine) => {
      const words = passageWords(hadith, mode);
      wordsRef.current = words;
      wordByKeyRef.current = Object.fromEntries(words.map((word) => [word.key, word]));
      cursorRef.current = 0;
      statusesRef.current = {};
      revealedRef.current = {};
      mistakesRef.current = [];
      pendingTokensRef.current = [];
      pausedRef.current = false;
      engineRef.current = engine;
      const recite = { hadith, mode };
      sessionRef.current = recite;

      primeMistakeSound();
      setStatuses({});
      setRevealed({});
      setMistakes([]);
      setCursor(0);
      setHidden(true);
      setPaused(false);
      setSummary(null);
      setSelected(null);
      setEngineChoiceOpen(false);
      setPendingChoice(null);
      setSession(recite);
      setPhase('live');
    },
    [],
  );

  const chooseMode = useCallback(
    (hadith: Hadith, mode: ReciteMode) => {
      if (speechConsent) {
        // Honour a manual choice the reader made earlier, just like the Quran
        // memorisation page does.
        beginSession(hadith, mode, speechEngine);
      } else {
        setPendingChoice({ hadith, mode });
        setSelected(null);
        setEngineChoiceOpen(true);
      }
    },
    [beginSession, speechConsent, speechEngine],
  );

  const finishSession = useCallback(() => {
    const recite = sessionRef.current;
    if (!recite || phase !== 'live') return;
    const reached = cursorRef.current;
    const total = wordsRef.current.length;
    persistProgress(recite, reached, reached >= total);
    setSummary({ words: reached, errors: mistakesRef.current.length });
    setPhase('summary');
    speechRef.current.stop();
    trackerRef.current = null;
  }, [persistProgress, phase]);

  finishRef.current = finishSession;

  eventRef.current = (word, type, meta) => {
    const entry = wordByKeyRef.current[word.key];
    if (!entry) return;
    const next = { ...statusesRef.current, [word.key]: type };
    statusesRef.current = next;
    setStatuses(next);

    // A word the reader has actually recited stays visible from then on, just
    // as on the Quran page. A word only guessed wrong stays hidden until it is
    // corrected, so the answer is never given away early.
    if ((type === 'correct' || type === 'tashkeel') && !revealedRef.current[word.key]) {
      revealedRef.current = { ...revealedRef.current, [word.key]: true };
      setRevealed(revealedRef.current);
    }

    if (type === 'correct') {
      const kept = mistakesRef.current.filter((item) => item.key !== word.key);
      if (kept.length !== mistakesRef.current.length) {
        mistakesRef.current = kept;
        setMistakes(kept);
      }
    } else if (type === 'wrong' || type === 'tashkeel') {
      if (!mistakesRef.current.some((item) => item.key === word.key && item.at === cursorRef.current)) {
        const item: ReciteMistake = {
          key: word.key,
          text: entry.text,
          recitedText: meta?.recitedText,
          at: Date.now(),
        };
        mistakesRef.current = [...mistakesRef.current, item];
        setMistakes(mistakesRef.current);
      }
      playMistakeSound();
    }
  };

  useEffect(() => {
    if (phase !== 'live' || !session) return;
    const words = passageWords(session.hadith, session.mode);
    const tracker = new TranscriptTracker({
      words: detectorWords(words, session.hadith),
      normalized: words.map((word) => normalizeToken(word.text)),
      diacritized: words.map((word) => word.text),
      detectMistakes: true,
      // Harakat are not checked for hadith: browsers rarely return vowels and
      // the reader is not asked to reproduce a reciter's exact qira'a here.
      detectTashkeel: false,
      dontProgressUntilFixed: false,
      detectPreamble: false,
      detectMuqattaat: false,
      onEvent: (word, type, meta) => eventRef.current(word, type, meta),
      onBlocked: () => {},
      onDone: () => finishRef.current(),
      onCursor: (index) => {
        cursorRef.current = index;
        setCursor(index);
      },
    });
    trackerRef.current = tracker;
    if (import.meta.env.DEV) {
      // Test hook for local verification only; stripped from production builds.
      (window as unknown as { __hadithTracker?: TranscriptTracker }).__hadithTracker =
        tracker;
    }
    if (pendingTokensRef.current.length) {
      tracker.feed(pendingTokensRef.current);
      pendingTokensRef.current = [];
    }
    if (engineRef.current === 'browser' && !pausedRef.current) speechRef.current.start();

    return () => {
      const recite = sessionRef.current;
      if (recite && cursorRef.current > 0) {
        persistProgress(recite, cursorRef.current, false);
      }
      trackerRef.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __hadithTracker?: TranscriptTracker }).__hadithTracker;
      }
      speechRef.current.stop();
    };
  }, [persistProgress, phase, session?.hadith.id, session?.mode]);

  const toggleSaved = (id: string) => {
    setStored((prev) => ({
      ...prev,
      saved: prev.saved.includes(id)
        ? prev.saved.filter((item) => item !== id)
        : [...prev.saved, id],
    }));
  };

  const copy = async (hadith: Hadith) => {
    const text = `${passageText(hadith, 'both')}\n\n— ${hadith.source}\nالمصدر: الأربعين النووية ${hadith.url}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      return;
    }
    setCopied(hadith.id);
    if (copyTimer.current !== null) window.clearTimeout(copyTimer.current);
    copyTimer.current = window.setTimeout(() => setCopied(null), 1800);
  };

  const leaveSession = () => {
    const recite = sessionRef.current;
    if (phase === 'live' && recite && cursorRef.current > 0) {
      persistProgress(recite, cursorRef.current, false);
    }
    trackerRef.current = null;
    sessionRef.current = null;
    pendingTokensRef.current = [];
    speechRef.current.stop();
    setSession(null);
    setPhase('list');
    setSummary(null);
  };

  const togglePause = () => {
    const next = !pausedRef.current;
    pausedRef.current = next;
    setPaused(next);
    if (engineRef.current === 'browser') {
      if (next) speechRef.current.stop();
      else speechRef.current.start();
    }
  };

  const stepWord = () => trackerRef.current?.step();
  const manualMode = engineRef.current === 'manual';
  const micOff = !manualMode && ['denied', 'unsupported', 'error'].includes(speech.status);

  const filtered = useMemo(() => {
    const query = normalizeArabic(search.trim());
    return hadiths.filter((hadith) => {
      if (savedOnly && !stored.saved.includes(hadith.id)) return false;
      if (!query) return true;
      return normalizeArabic(
        `${hadith.title} ${hadith.label} ${hadith.isnad} ${hadith.matn} ${hadith.source}`,
      ).includes(query);
    });
  }, [search, savedOnly, stored.saved]);

  if (session && phase !== 'list') {
    const words = passageWords(session.hadith, session.mode);
    const total = words.length;
    const currentWord = words[cursor];
    const modeLabel = MODE_LABEL[session.mode];

    return (
      <div className="stack">
        <header className="page-head">
          <div>
            <p className="eyebrow">الأربعون النووية · {session.hadith.label}</p>
            <h1>{session.hadith.title}</h1>
          </div>
          <button className="btn btn-secondary" onClick={leaveSession}>
            <ChevronLeft size={16} aria-hidden />
            الأحاديث
          </button>
        </header>

        {phase === 'summary' ? (
          <section className="card hadith-summary">
            <span className="hadith-summary-check">
              <Check size={30} aria-hidden />
            </span>
            <h2>انتهى التسميع</h2>
            <p className="muted">
              {modeLabel} · {arabicNumber(summary?.words ?? 0)} من {arabicNumber(total)} كلمة
              {summary?.errors ? ` · ${arabicNumber(summary.errors)} أخطاء` : ' · بلا أخطاء'}
            </p>
            <div className="hadith-actions">
              <button
                className="btn btn-primary"
                onClick={() => beginSession(session.hadith, session.mode, engineRef.current)}
              >
                <Play size={16} aria-hidden />
                إعادة
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => {
                  leaveSession();
                  setSelected(session.hadith);
                }}
              >
                تغيير نوع التسميع
              </button>
              <button className="btn btn-secondary" onClick={leaveSession}>
                العودة إلى الأحاديث
              </button>
            </div>
          </section>
        ) : (
          <section className="card hadith-recite">
            <div className={`session-strip${manualMode ? ' is-manual' : ''}${micOff ? ' is-mic-off' : ''}`}>
              <span className={`live-dot${paused ? ' is-paused' : ''}${manualMode ? ' is-off' : ''}`} />
              <strong>{manualMode ? 'تتبّع يدوي' : speechLabel(speech.status)}</strong>
              <span className="muted small">{modeLabel}</span>
              <span className="session-strip-spacer" />
              <span className="mono">
                {arabicNumber(cursor)} / {arabicNumber(total)}
              </span>
              <button className="chip-btn" onClick={() => setHidden((value) => !value)}>
                {hidden ? <Eye size={15} aria-hidden /> : <EyeOff size={15} aria-hidden />}
                {hidden ? 'إظهار النص' : 'إخفاء النص'}
              </button>
              <button className="chip-btn" onClick={togglePause}>
                {paused ? <Play size={15} aria-hidden /> : <Pause size={15} aria-hidden />}
                {paused ? 'متابعة' : 'إيقاف مؤقت'}
              </button>
              <button className="chip-btn" onClick={finishSession}>
                <Square size={14} aria-hidden />
                إنهاء
              </button>
            </div>

            {manualMode ? (
              <div className="mode-banner">
                التتبّع اليدوي: اضغط «الكلمة التالية» بعد كل كلمة تقرأها. لا يُسجّل أي تقدّم بالوقت أو
                الصمت.
                <button className="chip-btn" onClick={stepWord} disabled={paused || cursor >= total}>
                  الكلمة التالية
                </button>
              </div>
            ) : null}
            {micOff ? (
              <div className="mic-banner">
                <span>{speechLabel(speech.status)}. يمكنك التبديل إلى التتبّع اليدوي.</span>
                <span className="banner-actions">
                  <button className="chip-btn" onClick={speech.start}>
                    إعادة الميكروفون
                  </button>
                  <button
                    className="chip-btn"
                    onClick={() => {
                      engineRef.current = 'manual';
                      updateSettings({ speechEngine: 'manual' });
                      speech.stop();
                    }}
                  >
                    تتبّع يدوي
                  </button>
                </span>
              </div>
            ) : null}

            {!manualMode ? (
              <p className="heard-line" aria-live="polite">
                سمعنا: {speech.heard || '—'}
              </p>
            ) : null}

            <div className="hadith-passage" dir="rtl">
              {words.map((word, index) => {
                const status = statuses[word.key] ?? 'neutral';
                const isHidden =
                  hidden &&
                  !revealed[word.key] &&
                  status !== 'wrong' &&
                  status !== 'tashkeel';
                return (
                  <Fragment key={word.key}>
                    <WordSpan
                      text={word.text}
                      status={status}
                      hidden={isHidden}
                      history="none"
                      current={index === cursor && phase === 'live'}
                      active={index === cursor - 1}
                    />{' '}
                  </Fragment>
                );
              })}
            </div>

            <p className="muted small hadith-recite-hint">
              {currentWord && !hidden
                ? `الكلمة التالية: ${currentWord.text}`
                : 'النص مخفي. اقرأ من الحفظ، وستظهر كل كلمة تسمعها بعد تسميعها. يمكنك إظهار النص كاملاً إن احتجت.'}
            </p>

            {mistakes.length ? (
              <div className="hadith-mistakes">
                <strong>الأخطاء في هذه الجولة</strong>
                <ul>
                  {mistakes.map((item) => (
                    <li key={`${item.key}:${item.at}`}>
                      <span className="hadith-mistake-word">{item.text}</span>
                      {item.recitedText ? (
                        <span className="muted small">سمعنا: {item.recitedText}</span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>
        )}
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">من الأربعين النووية · alnawawiforty.com</p>
          <h1>الحديث الشريف</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card hadith-intro">
        <span className="hadith-intro-icon">
          <Bookmark size={26} aria-hidden />
        </span>
        <div>
          <strong>
            {arabicNumber(hadiths.length)} حديثاً من الأربعين النووية
          </strong>
          <p className="muted small">
            النصوص كما وردت في موقع الأربعين النووية، مع فصل السند عن المتن. اختر الحديث ثم نوع
            التسميع: السند أو المتن أو كلاهما. لا تُشترط حركات الحديث كما تُشترط في القرآن.
          </p>
          <a
            className="hadith-source-link"
            href="https://alnawawiforty.com/"
            target="_blank"
            rel="noreferrer"
          >
            alnawawiforty.com
            <ExternalLink size={13} aria-hidden />
          </a>
        </div>
      </section>

      <div className="hadith-search">
        <Search size={18} aria-hidden />
        <input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="ابحث في الحديث أو العنوان أو المصدر"
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
          className={`topic-chip${!savedOnly ? ' is-active' : ''}`}
          onClick={() => setSavedOnly(false)}
        >
          الكل
          <span>{arabicNumber(hadiths.length)}</span>
        </button>
        <button
          className={`topic-chip is-saved${savedOnly ? ' is-active' : ''}`}
          onClick={() => setSavedOnly((value) => !value)}
          disabled={stored.saved.length === 0 && !savedOnly}
        >
          <Bookmark size={13} aria-hidden />
          المحفوظة
          <span>{arabicNumber(stored.saved.length)}</span>
        </button>
      </div>

      <div className="hadith-results">
        <span className="muted small">
          {filtered.length === 0
            ? 'لا توجد أحاديث مطابقة'
            : `${arabicNumber(filtered.length)} حديثاً`}
        </span>
        {savedOnly ? <span className="muted small">· تعرض المحفوظة فقط</span> : null}
      </div>

      {filtered.length === 0 ? (
        <section className="card hadith-empty">
          <p className="muted">لم نجد حديثاً يطابق «{search || 'هذا الاختيار'}».</p>
          <button
            className="btn btn-secondary"
            onClick={() => {
              setSearch('');
              setSavedOnly(false);
            }}
          >
            إزالة التصفية
          </button>
        </section>
      ) : (
        <div className="hadith-list">
          {filtered.map((hadith) => {
            const isSaved = stored.saved.includes(hadith.id);
            const best = Math.max(
              ...RECITE_MODES.map(
                (mode) => stored.progress[progressKey(hadith, mode)]?.best ?? 0,
              ),
            );
            return (
              <article className="card hadith-card" key={hadith.id}>
                <div className="hadith-card-head">
                  <span className="hadith-topic">{hadith.label}</span>
                  <button
                    className={`hadith-save${isSaved ? ' is-saved' : ''}`}
                    onClick={() => toggleSaved(hadith.id)}
                    aria-label={isSaved ? 'إزالة من المحفوظة' : 'حفظ الحديث'}
                    aria-pressed={isSaved}
                  >
                    <Bookmark size={17} aria-hidden />
                  </button>
                </div>

                <h2 className="hadith-card-title">{hadith.title}</h2>
                <p className="hadith-text" dir="rtl">
                  {hadith.matn}
                </p>
                <p className="hadith-isnad" dir="rtl">
                  {hadith.isnad}
                </p>

                <div className="hadith-meta">
                  {hadith.source ? <span className="hadith-grade">{hadith.source}</span> : null}
                  {best > 0 ? (
                    <span className="hadith-progress">
                      أُتقن {arabicNumber(Math.round(best * 100))}٪
                    </span>
                  ) : null}
                </div>

                <div className="hadith-actions">
                  <button
                    className="hadith-action is-primary"
                    onClick={() => {
                      setSelected(hadith);
                      setPendingChoice(null);
                    }}
                  >
                    <Mic size={15} aria-hidden />
                    تسميع
                  </button>
                  <a className="hadith-action" href={hadith.url} target="_blank" rel="noreferrer">
                    <ExternalLink size={15} aria-hidden />
                    النص الأصلي
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

      <Sheet
        open={Boolean(selected) && !engineChoiceOpen}
        title="ماذا تريد أن تسمّع؟"
        onClose={() => setSelected(null)}
      >
        {selected ? (
          <>
            <p className="muted small">الحديث {arabicNumber(selected.number)} — {selected.title}</p>
            <div className="hadith-mode-list">
              {RECITE_MODES.map((mode) => {
                const progress = stored.progress[progressKey(selected, mode)];
                return (
                  <button
                    key={mode}
                    className="hadith-mode"
                    onClick={() => chooseMode(selected, mode)}
                  >
                    <strong>{MODE_LABEL[mode]}</strong>
                    <span className="muted small">{MODE_HINT[mode]}</span>
                    {progress?.done ? <span className="hadith-mode-done">أُتقن</span> : null}
                  </button>
                );
              })}
            </div>
          </>
        ) : null}
      </Sheet>

      <Sheet
        open={engineChoiceOpen}
        title="كيف تريد التتبّع؟"
        onClose={() => {
          setEngineChoiceOpen(false);
          setPendingChoice(null);
        }}
      >
        <p className="consent">
          يمكن للمتصفح الاستماع إلى صوتك عبر ميكروفون الجهاز للتعرّف على الكلمات محلياً في هذا
          التطبيق، أو يمكنك تتبّع الكلمات بنفسك. لا يُحفظ أي تسجيل صوتي.
        </p>
        <div className="hadith-mode-list">
          <button
            className="hadith-mode"
            onClick={() => {
              updateSettings({ speechConsent: true, speechEngine: 'browser' });
              if (pendingChoice) beginSession(pendingChoice.hadith, pendingChoice.mode, 'browser');
            }}
          >
            <strong><Mic size={16} aria-hidden /> استخدام الميكروفون</strong>
            <span className="muted small">التتبّع يتقدّم بما يسمعه المتصفح من كلمات فقط.</span>
          </button>
          <button
            className="hadith-mode"
            onClick={() => {
              updateSettings({ speechConsent: true, speechEngine: 'manual' });
              if (pendingChoice) beginSession(pendingChoice.hadith, pendingChoice.mode, 'manual');
            }}
          >
            <strong><Play size={16} aria-hidden /> تتبّع يدوي</strong>
            <span className="muted small">تضغط «الكلمة التالية» بنفسك بعد كل كلمة.</span>
          </button>
        </div>
      </Sheet>
    </div>
  );
}
