import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ArrowRight,
  ChevronLeft,
  ChevronsLeft,
  CircleAlert,
  Eye,
  EyeOff,
  Keyboard,
  ListChecks,
  Mic,
  MicOff,
  Pause,
  Play,
  Settings2,
  SkipForward,
  Sparkles,
  Square,
  Crosshair,
} from 'lucide-react';
import {
  endSession,
  getState,
  highlightLevel,
  recordEvent,
  removeMistake,
  restoreMistake,
  setLastRead,
  todayKey,
  uid,
  updateSettings,
  useApp,
} from '../lib/store';
import {
  arabicNumber,
  getSurah,
  normalizeArabic,
  surahs,
  wordKey,
  wordsForRange,
  wordsOf,
} from '../lib/quran';
import type {
  DetectorWord,
  EventType,
  Session,
  SpeechEngine,
  WordStatus,
} from '../lib/types';
import { TranscriptTracker } from '../lib/tracker';
import type { TrackerMeta } from '../lib/tracker';
import { playMistakeSound, primeMistakeSound } from '../lib/sound';
import { muqattaahAt, spokenHint } from '../lib/muqattaat';
import { useSpeech } from '../lib/useSpeech';
import { useGeminiSpeech } from '../lib/geminiSpeech';
import { hasSharedSpeech } from '../lib/config';
import type { RuleNote } from '../lib/geminiSpeech';
import { Sheet } from '../components/Sheet';
import { WordSpan } from '../components/WordSpan';
import { WordHistoryPanel } from '../components/WordHistoryPanel';
import { MistakesList } from '../components/MistakesList';

const PAGE = 5;

interface Summary {
  words: number;
  ayahs: number;
  errors: number;
  minutes: number;
  sessionId: string;
}

export function Reader() {
  const { surah: surahParam } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const surah = Math.min(114, Math.max(1, Number(surahParam) || 1));
  const sData = getSurah(surah);
  const ayahParam = Math.min(
    sData.total_verses,
    Math.max(1, Number(searchParams.get('ayah')) || 1),
  );

  const settings = useApp((s) => s.settings);
  const wordStats = useApp((s) => s.wordStats);
  const allMistakes = useApp((s) => s.mistakes);

  const [phase, setPhase] = useState<'read' | 'live'>('read');
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [lastSessionId, setLastSessionId] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [paused, setPaused] = useState(false);
  const [statuses, setStatuses] = useState<Record<string, WordStatus>>({});
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [errors, setErrors] = useState(0);
  const [blockedWord, setBlockedWord] = useState<DetectorWord | null>(null);
  const [cursor, setCursor] = useState(0);
  const [mistakesOpen, setMistakesOpen] = useState(false);
  const [historyWord, setHistoryWord] = useState<string | null>(null);
  /** A hidden word chosen as a new tracking anchor; never shows its text. */
  const [seekWord, setSeekWord] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [engine, setEngine] = useState<SpeechEngine>(settings.speechEngine);
  const [startOpen, setStartOpen] = useState(false);
  const [startAyah, setStartAyah] = useState(ayahParam);
  const [sessionStart, setSessionStart] = useState<number | null>(null);

  // A live session can begin at any ayah the reader picks. The page follows
  // that ayah, so nothing before it is displayed, tracked or counted.
  const from =
    phase === 'live' && sessionStart !== null ? sessionStart : ayahParam;
  const to = Math.min(sData.total_verses, from + PAGE - 1);

  // The sheet may only flag words the reader has already passed; a word still
  // waiting at the cursor has not been recited yet.
  const historyPosition = useMemo(() => {
    if (!historyWord) return -1;
    return wordsForRange(surah, from, to).findIndex((w) => w.key === historyWord);
  }, [historyWord, surah, from, to]);

  const trackerRef = useRef<TranscriptTracker | null>(null);
  const pausedRef = useRef(false);
  /**
   * Tokens heard while the tracker is between pages. The reader recites through
   * the page boundary without pausing, so anything heard in the moment before
   * the next page's tracker exists waits here instead of being dropped.
   */
  const pendingTokensRef = useRef<string[]>([]);
  const handleTokens = useCallback((tokens: string[]) => {
    if (pausedRef.current) return;
    for (const token of tokens) {
      const tracker = trackerRef.current;
      if (!tracker || tracker.isDone()) pendingTokensRef.current.push(token);
      else tracker.feed([token]);
    }
  }, []);
  const [ruleNotes, setRuleNotes] = useState<RuleNote[]>([]);
  const browserSpeech = useSpeech(handleTokens, 'ar-SA', {
    // The reader's position decides which words steer the engine; nothing here
    // can reveal or advance a word on its own.
    phrases: () => trackerRef.current?.biasPhrases(8) ?? [],
  });
  /**
   * Gemini hears the recitation itself instead of asking the browser engine to
   * guess Arabic, so harakat and tajweed can be judged. It runs only when the
   * reader picked it; both hooks stay mounted because hooks cannot be
   * conditional.
   */
  const onRuleNotes = useCallback((notes: RuleNote[]) => {
    setRuleNotes((prev) => [...notes, ...prev].slice(0, 6));
  }, []);
  const geminiSpeech = useGeminiSpeech(handleTokens, {
    apiKey: settings.geminiKey,
    endpoint: settings.geminiEndpoint,
    model: settings.geminiModel,
    onRuleNotes,
  });
  const activeSpeech = engine === 'gemini' ? geminiSpeech : browserSpeech;
  const speechStatus = activeSpeech.status;
  const heard = activeSpeech.heard;
  const speechSupported = activeSpeech.supported;
  const speechBiasing = activeSpeech.biasing;
  const startSpeech = activeSpeech.start;
  const stopSpeech = activeSpeech.stop;

  const engineRef = useRef<SpeechEngine>(settings.speechEngine);
  const sessionIdRef = useRef<string | null>(null);
  /** The ayah the session began at, kept across page advances. */
  const sessionStartRef = useRef(ayahParam);
  /**
   * Set while the tracker is being rebuilt for the next page, so the effect
   * cleanup does not stop the microphone the reader is still speaking into.
   */
  const pageAdvanceRef = useRef(false);
  const startedAtRef = useRef(0);
  const errorsRef = useRef(0);
  const wordsRef = useRef(0);
  const ayahsRef = useRef(0);
  const statusesRef = useRef<Record<string, WordStatus>>({});
  const revealedRef = useRef<Record<string, boolean>>({});
  const ayahCountRef = useRef<Record<number, number>>({});
  const doneSetRef = useRef<Set<number>>(new Set());
  const toastTimer = useRef<number | null>(null);
  const autoStarted = useRef(false);
  const eventRef = useRef<
    (w: DetectorWord, t: EventType, meta?: TrackerMeta) => void
  >(() => {});
  const doneRef = useRef<() => void>(() => {});
  const finishRef = useRef<() => void>(() => {});
  const viewRef = useRef({ surah, from, to, hidden });
  viewRef.current = { surah, from, to, hidden };

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    if (toastTimer.current) window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => setToast(null), 2600);
  }, []);

  useEffect(() => {
    if (phase === 'read') setLastRead(surah, ayahParam);
  }, [phase, surah, ayahParam]);

  const goAyah = (n: number) => {
    if (phase === 'live') return;
    const next = Math.min(sData.total_verses, Math.max(1, n));
    const params = new URLSearchParams(searchParams);
    params.set('ayah', String(next));
    params.delete('session');
    setSearchParams(params, { replace: true });
  };

  const startSession = useCallback(
    (requested?: SpeechEngine, requestedStart?: number) => {
      if (sessionIdRef.current) return;
      const startAt = Math.min(
        sData.total_verses,
        Math.max(1, requestedStart ?? ayahParam),
      );
      const chosen = requested ?? settings.speechEngine;
      // First live session: the reader chooses where to begin and how to be
      // tracked. Speech recognition may process audio in the cloud.
      if (!requested && !settings.speechConsent) {
        setStartAyah(startAt);
        setStartOpen(true);
        return;
      }
      if (requested) {
        updateSettings({ speechEngine: requested, speechConsent: true });
      }
      if (
        chosen === 'gemini' &&
        !settings.geminiKey.trim() &&
        !settings.geminiEndpoint.trim() &&
        !hasSharedSpeech
      ) {
        showToast('أضف مفتاح Gemini في الإعدادات أولاً');
        setStartOpen(true);
        return;
      }
      // Unlock audio while we are still inside the user's gesture.
      primeMistakeSound();
      engineRef.current = chosen;
      setEngine(chosen);
      setStartOpen(false);
      stopSpeech();

      // The session owns its starting ayah. Everything before it is outside the
      // word list, so it can never be marked as a skipped word or a mistake.
      setSessionStart(startAt);
      sessionStartRef.current = startAt;
      if (startAt !== ayahParam || searchParams.has('session')) {
        const params = new URLSearchParams(searchParams);
        params.set('ayah', String(startAt));
        // The link's one-shot auto-start is consumed; a reload should not
        // reopen the start sheet.
        params.delete('session');
        setSearchParams(params, { replace: true });
      }

      const id = uid();
      sessionIdRef.current = id;
      setSessionId(id);
      startedAtRef.current = Date.now();
      errorsRef.current = 0;
      wordsRef.current = 0;
      ayahsRef.current = 0;
      revealedRef.current = {};
      ayahCountRef.current = {};
      doneSetRef.current = new Set();
      pendingTokensRef.current = [];
      setErrors(0);
      statusesRef.current = {};
      setStatuses({});
      setRevealed({});
      setSummary(null);
      setBlockedWord(null);
      setCursor(0);
      pausedRef.current = false;
      setPaused(false);
      setHidden(true);
      setLastSessionId(null);
      setPhase('live');
    },
    [
      ayahParam,
      sData.total_verses,
      searchParams,
      setSearchParams,
      settings.speechConsent,
      settings.speechEngine,
      stopSpeech,
    ],
  );

  const finishSession = useCallback(() => {
    const id = sessionIdRef.current;
    if (!id) return;
    trackerRef.current = null;
    pendingTokensRef.current = [];
    stopSpeech();
    pausedRef.current = false;
    const endedAt = Date.now();
    const session: Session = {
      id,
      surah,
      fromAyah: sessionStartRef.current,
      toAyah: to,
      startedAt: startedAtRef.current,
      endedAt,
      hidden,
      wordsRevealed: wordsRef.current,
      ayahsRevealed: ayahsRef.current,
      mistakes: errorsRef.current,
    };
    endSession(session);
    setLastSessionId(id);
    setSummary({
      words: wordsRef.current,
      ayahs: ayahsRef.current,
      errors: errorsRef.current,
      minutes: Math.max(1, Math.round((endedAt - startedAtRef.current) / 60000)),
      sessionId: id,
    });
    sessionIdRef.current = null;
    setSessionId(null);
    setPhase('read');
    setPaused(false);
    setBlockedWord(null);
    setCursor(0);
  }, [hidden, stopSpeech, surah, to]);

  finishRef.current = finishSession;

  const lastWordRef = useRef<DetectorWord | null>(null);

  const onDetectorEvent = useCallback(
    (word: DetectorWord, type: EventType, meta?: TrackerMeta) => {
      const text = wordsOf(word.surah, word.ayah)[word.index] ?? '';
      const prior = statusesRef.current[word.key] ?? 'neutral';
      // Tapping «حركة» twice must not count the same word twice.
      if (type === 'tashkeel' && prior === 'tashkeel') return;
      statusesRef.current = { ...statusesRef.current, [word.key]: type };
      setStatuses(statusesRef.current);

      if (type === 'wrong' || type === 'tashkeel') playMistakeSound();

      // A word recited with a wrong vowel still counts as recited: it moves the
      // session forward, it just also records a mistake.
      const countedType = type === 'correct' || type === 'tashkeel';
      const firstCounted = countedType && !revealedRef.current[word.key];

      if (countedType) {
        if (firstCounted) {
          revealedRef.current[word.key] = true;
          wordsRef.current += 1;
          const seen = (ayahCountRef.current[word.ayah] ?? 0) + 1;
          ayahCountRef.current[word.ayah] = seen;
          if (
            seen === wordsOf(word.surah, word.ayah).length &&
            !doneSetRef.current.has(word.ayah)
          ) {
            doneSetRef.current.add(word.ayah);
            ayahsRef.current = doneSetRef.current.size;
            showToast(`أتممت الآية ${arabicNumber(word.ayah)}`);
          }
        }
        setRevealed((prev) => (prev[word.key] ? prev : { ...prev, [word.key]: true }));
      }
      // Correcting a wrong word to "harakat only" is not a second mistake, so
      // the counter must not move when the word was already flagged.
      if (type !== 'correct' && prior !== 'wrong' && prior !== 'tashkeel') {
        errorsRef.current += 1;
        setErrors(errorsRef.current);
      }

      // A word that is re-recited correctly resolves its active session
      // mistake(s), so it must stop counting as an error too.
      const resolved =
        type === 'correct'
          ? getState().mistakes.filter(
              (m) =>
                !m.removed &&
                m.sessionId === sessionIdRef.current &&
                m.wordKey === word.key,
            ).length
          : 0;

      recordEvent({
        sessionId: sessionIdRef.current,
        surah: word.surah,
        ayah: word.ayah,
        wordIndex: word.index,
        wordKey: word.key,
        type,
        correctText: text,
        recitedText: meta?.recitedText,
        confidence: meta?.confidence,
      });

      if (resolved > 0) {
        errorsRef.current = Math.max(0, errorsRef.current - resolved);
        setErrors(errorsRef.current);
      }
    },
    [showToast],
  );

  doneRef.current = () => {
    if (!sessionIdRef.current) return;
    const view = viewRef.current;
    // Finishing a page continues on the next one instead of ending the session.
    // The reader stays in memorisation mode and the new page is hidden as well;
    // if they stop reciting, nothing advances on its own and the session stays
    // open until they end it or leave. Reciting past the last page ends it.
    if (view.to < sData.total_verses) {
      const next = view.to + 1;
      pageAdvanceRef.current = true;
      setSessionStart(next);
      setCursor(0);
      const params = new URLSearchParams(searchParams);
      params.set('ayah', String(next));
      params.delete('session');
      setSearchParams(params, { replace: true });
      showToast(`انتهت الصفحة — تابع من الآية ${arabicNumber(next)}`);
      return;
    }
    finishRef.current();
  };

  // Tracker lifecycle for the live session. The cursor advances only when the
  // recogniser reports a word; time and silence never move it.
  useEffect(() => {
    if (phase !== 'live' || !sessionId) return;
    const words = wordsForRange(surah, from, to);
    const normalized = words.map((w) =>
      normalizeArabic(wordsOf(w.surah, w.ayah)[w.index] ?? ''),
    );
    const diacritized = words.map(
      (w) => wordsOf(w.surah, w.ayah)[w.index] ?? '',
    );
    const tracker = new TranscriptTracker({
      words,
      normalized,
      diacritized,
      detectMistakes: settings.detectMistakes,
      detectTashkeel: settings.detectTashkeel,
      // Mistakes are shown in red and announced with a tone; they never halt
      // the session or hold the cursor.
      dontProgressUntilFixed: false,
      onEvent: (w, t, meta) => eventRef.current(w, t, meta),
      onBlocked: (b) => setBlockedWord(b ? lastWordRef.current : null),
      onDone: () => doneRef.current(),
      onCursor: (i) => setCursor(i),
    });
    trackerRef.current = tracker;
    // A reader who recites through the page boundary already produced the first
    // tokens of this page while the previous tracker was finished; give them to
    // the new tracker now.
    if (pendingTokensRef.current.length) {
      const queued = pendingTokensRef.current;
      pendingTokensRef.current = [];
      tracker.feed(queued);
    }
    if (import.meta.env.DEV) {
      // Test hook for local verification only; stripped from production builds.
      (window as unknown as { __tadabbur?: TranscriptTracker }).__tadabbur =
        tracker;
    }
    if (engineRef.current !== 'manual' && !pausedRef.current) startSpeech();
    return () => {
      trackerRef.current = null;
      if (import.meta.env.DEV) {
        delete (window as unknown as { __tadabbur?: TranscriptTracker }).__tadabbur;
      }
      // A page advance replaces the tracker but not the recitation: keep the
      // microphone running so the reader continues without a gap.
      if (!pageAdvanceRef.current) stopSpeech();
      pageAdvanceRef.current = false;
    };
    // Session options are captured when the session starts on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, sessionId, from]);

  const wrappedEvent = useCallback(
    (w: DetectorWord, t: EventType, meta?: TrackerMeta) => {
      lastWordRef.current = w;
      onDetectorEvent(w, t, meta);
    },
    [onDetectorEvent],
  );
  eventRef.current = wrappedEvent;

  // Auto-start when arriving from the dashboard CTA.
  useEffect(() => {
    if (searchParams.get('session') === '1' && !autoStarted.current) {
      autoStarted.current = true;
      // The reader still chooses where to begin; the sheet opens on the ayah
      // carried by the link and can be changed before anything is tracked.
      setStartAyah(ayahParam);
      setStartOpen(true);
    }
  }, [ayahParam, searchParams]);

  useEffect(
    () => () => {
      trackerRef.current = null;
      stopSpeech();
      if (toastTimer.current) window.clearTimeout(toastTimer.current);
      // Leaving mid-session: keep the work instead of dropping it silently.
      const id = sessionIdRef.current;
      if (id && wordsRef.current > 0) {
        const view = viewRef.current;
        sessionIdRef.current = null;
        endSession({
          id,
          surah: view.surah,
          fromAyah: sessionStartRef.current,
          toAyah: view.to,
          startedAt: startedAtRef.current,
          endedAt: Date.now(),
          hidden: view.hidden,
          wordsRevealed: wordsRef.current,
          ayahsRevealed: ayahsRef.current,
          mistakes: errorsRef.current,
        });
      }
    },
    [],
  );

  const togglePause = () => {
    if (phase !== 'live') return;
    if (paused) {
      pausedRef.current = false;
      setPaused(false);
      if (engineRef.current !== 'manual') startSpeech();
    } else {
      pausedRef.current = true;
      setPaused(true);
      stopSpeech();
    }
  };

  const peekNext = () => {
    if (phase !== 'live' || !sessionId) return;
    const flat = wordsForRange(surah, from, to);
    const position = trackerRef.current?.getCursor() ?? 0;
    let target: DetectorWord | undefined = flat[position];
    if (!target || revealed[target.key]) {
      target = flat.find((w) => !revealed[w.key]);
    }
    if (!target) return;
    peekWord(target);
  };

  const peekWord = (target: DetectorWord) => {
    const text = wordsOf(target.surah, target.ayah)[target.index] ?? '';
    statusesRef.current = { ...statusesRef.current, [target.key]: 'peek' };
    setStatuses(statusesRef.current);
    setRevealed((prev) => ({ ...prev, [target.key]: true }));
    errorsRef.current += 1;
    setErrors(errorsRef.current);
    recordEvent({
      sessionId: sessionIdRef.current,
      surah: target.surah,
      ayah: target.ayah,
      wordIndex: target.index,
      wordKey: target.key,
      type: 'peek',
      correctText: text,
    });
    showToast('نظرة خاطفة — تُحتسب في سجلك');
  };

  const peekAyah = () => {
    if (phase !== 'live') return;
    const current = lastWordRef.current?.ayah ?? from;
    wordsOf(surah, current).forEach((_, i) => {
      const key = wordKey(surah, current, i);
      if (revealed[key]) return;
      peekWord({ key, surah, ayah: current, index: i });
    });
  };

  const retryWord = () => {
    trackerRef.current?.retry();
    setBlockedWord(null);
  };

  const stepWord = () => {
    if (phase !== 'live' || paused || blockedWord) return;
    trackerRef.current?.step();
  };

  const markTashkeel = () => {
    if (phase !== 'live' || paused || blockedWord) return;
    const word = trackerRef.current?.markTashkeel() ?? null;
    if (!word) {
      showToast(
        cursor === 0
          ? 'لم تُقرأ كلمة بعد — اقرأ ثم سجّل حركة الكلمة'
          : 'الحركة مسجّلة على هذه الكلمة بالفعل',
      );
      return;
    }
    const text = wordsOf(word.surah, word.ayah)[word.index] ?? '';
    showToast(`حركة خاطئة على «${text}» — أعد تلاوتها صحيحة لتصحيحها`);
  };

  const markTashkeelWord = (key: string) => {
    if (phase !== 'live' || paused) return;
    const word = trackerRef.current?.markTashkeelAt(key) ?? null;
    if (!word) return;
    const text = wordsOf(word.surah, word.ayah)[word.index] ?? '';
    showToast(`حركة خاطئة على «${text}» — أعد تلاوتها صحيحة لتصحيحها`);
  };

  const resyncFrom = (key: string) => {
    if (phase !== 'live' || paused) return;
    if (!trackerRef.current?.seekTo(key)) return;
    setHistoryWord(null);
    setSeekWord(null);
    showToast('أعدنا المزامنة — تابع التلاوة من هذه الكلمة');
  };

  const openWord = (key: string, isHidden: boolean) => {
    if (isHidden) setSeekWord(key);
    else setHistoryWord(key);
  };

  const retryMic = () => {
    startSpeech();
  };

  const switchToManual = () => {
    engineRef.current = 'manual';
    setEngine('manual');
    updateSettings({ speechEngine: 'manual', speechConsent: true });
    stopSpeech();
  };

  const chooseEngine = (choice: SpeechEngine) => {
    const startAt = Math.min(
      sData.total_verses,
      Math.max(1, startAyah || ayahParam),
    );
    startSession(choice, startAt);
  };

  const openStart = () => {
    setStartAyah(from);
    setStartOpen(true);
  };

  const flatWords = useMemo(
    () => wordsForRange(surah, from, to),
    [surah, from, to],
  );
  const currentKey = phase === 'live' ? flatWords[cursor]?.key : undefined;
  const currentWord = phase === 'live' ? flatWords[cursor] : undefined;
  const lettersWord = currentWord
    ? muqattaahAt(currentWord.surah, currentWord.ayah, currentWord.index)
    : null;

  const closeHistory = () => setHistoryWord(null);

  const scopeMistakes = useMemo(() => {
    if (mistakesOpen) {
      const scope = sessionId ?? lastSessionId;
      if (scope) return allMistakes.filter((m) => m.sessionId === scope);
      return allMistakes;
    }
    if (summary) return allMistakes.filter((m) => m.sessionId === summary.sessionId);
    return [];
  }, [allMistakes, mistakesOpen, sessionId, lastSessionId, summary]);

  const today = todayKey();
  const todaySessions = useApp((s) => s.sessions).filter(
    (s) => new Date(s.startedAt).toISOString().slice(0, 10) === today,
  );

  const ayahs = [];
  for (let a = from; a <= to; a++) ayahs.push(a);

  const manualMode = engine === 'manual';
  const speechUnavailable =
    speechStatus === 'denied' ||
    speechStatus === 'unsupported' ||
    speechStatus === 'error';
  const micOff = !manualMode && speechUnavailable;

  let statusLabel: string;
  if (paused) statusLabel = 'متوقفة مؤقتاً';
  else if (manualMode) statusLabel = 'تتبّع يدوي — كلمة بعد كلمة';
  else if (speechStatus === 'starting' || speechStatus === 'idle')
    statusLabel = 'جارٍ تشغيل التعرّف الصوتي…';
  else if (speechStatus === 'listening') statusLabel = 'تستمع إلى تلاوتك…';
  else if (speechStatus === 'denied')
    statusLabel = 'إذن الميكروفون مرفوض — التقدّم يدوي';
  else if (speechStatus === 'unsupported')
    statusLabel = 'التعرّف الصوتي غير متاح — التقدّم يدوي';
  else statusLabel = 'تعذّر التعرّف الصوتي — التقدّم يدوي';

  const stepDisabled =
    paused ||
    !!blockedWord ||
    (!manualMode && (speechStatus === 'starting' || speechStatus === 'listening'));

  return (
    <div className="reader-shell">
      <header className="reader-head">
        <button className="icon-btn" onClick={() => navigate('/')} aria-label="رجوع">
          <ArrowRight size={20} />
        </button>
        <button className="reader-title" onClick={() => setNavOpen(true)}>
          <strong>{sData.name}</strong>
          <small className="muted">
            {phase === 'live'
              ? `جلسة حفظ · الآيات ${arabicNumber(from)}–${arabicNumber(to)}`
              : `الآيات ${arabicNumber(from)}–${arabicNumber(to)}`}
          </small>
        </button>
        <Link className="icon-btn" to="/settings" aria-label="الإعدادات">
          <Settings2 size={20} />
        </Link>
      </header>

      {phase === 'live' ? (
        <div
          className={`session-strip${micOff ? ' is-mic-off' : ''}${
            manualMode ? ' is-manual' : ''
          }`}
        >
          <span
            className={`live-dot${paused || manualMode ? ' is-paused' : ''}${
              micOff ? ' is-off' : ''
            }`}
            aria-hidden
          />
          <span>{statusLabel}</span>
          <span className="engine-badge">
            {manualMode
              ? 'يدوي'
              : engine === 'gemini'
                ? 'Gemini'
                : 'تعرّف المتصفح'}
          </span>
          <span className="spacer" />
          {settings.detectTashkeel ? (
            <button
              className="chip-btn"
              onClick={markTashkeel}
              disabled={paused || cursor === 0}
              aria-label="تسجيل حركة خاطئة على آخر كلمة قرأتها"
              title="سجّل حركة خاطئة على آخر كلمة قرأتها — لا يتوقّف التتبّع"
            >
              <CircleAlert size={14} aria-hidden />
              حركة
            </button>
          ) : null}
          <span className="mono">{arabicNumber(errors)} خطأ</span>
        </div>
      ) : (
        <div className="page-nav">
          <button
            className="icon-btn"
            onClick={() => goAyah(from - PAGE)}
            disabled={from <= 1}
            aria-label="الآيات السابقة"
          >
            <ChevronLeft size={20} style={{ transform: 'scaleX(-1)' }} />
          </button>
          <div className="page-dots" aria-hidden>
            {Array.from({ length: Math.min(sData.total_verses, 7) }).map((_, i) => {
              const target = Math.max(1, Math.min(sData.total_verses, from - 6 + i));
              return (
                <span key={i} className={target >= from && target <= to ? 'on' : ''} />
              );
            })}
          </div>
          <button
            className="icon-btn"
            onClick={() => goAyah(to + 1)}
            disabled={to >= sData.total_verses}
            aria-label="الآيات التالية"
          >
            <ChevronLeft size={20} />
          </button>
        </div>
      )}

      {phase === 'live' && !manualMode && heard ? (
        <div className="heard-line" dir="rtl">
          <span className="muted small">سمعنا:</span>
          <span>{heard}</span>
        </div>
      ) : null}

      {phase === 'live' && !manualMode && ruleNotes.length ? (
        <div className="rule-notes" dir="rtl">
          <span className="muted small">أحكام:</span>
          {ruleNotes.map((note, index) => (
            <span
              key={`${note.rule}-${note.word ?? ''}-${index}`}
              className={`rule-chip is-${note.severity ?? 'medium'}`}
              title={note.detail ?? ''}
            >
              {note.rule}
              {note.word ? ` — ${note.word}` : ''}
            </span>
          ))}
        </div>
      ) : null}

      {phase === 'live' && lettersWord ? (
        <div className="letters-hint" dir="rtl">
          <Sparkles size={14} aria-hidden />
          <span>
            الحروف المقطّعة — تُقرأ: <strong>{spokenHint(lettersWord)}</strong>
          </span>
        </div>
      ) : null}

      {phase === 'live' && manualMode ? (
        <div className="mode-banner">
          <Keyboard size={17} aria-hidden />
          <span>
            التتبّع اليدوي: اضغط «الكلمة التالية» بعد كل كلمة تقرؤها. لا يتقدّم
            التتبّع من تلقاء نفسه.
          </span>
        </div>
      ) : null}

      {phase === 'live' && micOff ? (
        <div className="mic-banner" role="alert">
          <MicOff size={17} aria-hidden />
          <span>
            {speechStatus === 'denied'
              ? 'لم نتمكن من الوصول إلى الميكروفون — لن يتقدّم التتبّع من تلقاء نفسه.'
              : speechStatus === 'unsupported'
                ? 'التعرّف الصوتي غير متاح في هذا المتصفح — لن يتقدّم التتبّع من تلقاء نفسه.'
                : 'تعذّر التعرّف الصوتي الآن — لن يتقدّم التتبّع من تلقاء نفسه.'}{' '}
            يمكنك المتابعة بالتتبّع اليدوي: كلمة واحدة لكل ضغطة.
          </span>
          <div className="banner-actions">
            <button className="btn btn-sm btn-secondary" onClick={retryMic}>
              إعادة المحاولة
            </button>
            <button className="btn btn-sm btn-primary" onClick={switchToManual}>
              التتبّع اليدوي
            </button>
          </div>
        </div>
      ) : null}

      {blockedWord ? (
        <div className="block-banner" role="alert">
          <span>
            توقّفنا عند كلمة «{wordsOf(blockedWord.surah, blockedWord.ayah)[blockedWord.index]}»
            — أعد تلاوتها ثم تابع.
          </span>
          <button className="btn btn-sm btn-primary" onClick={retryWord}>
            أعدت تلاوتها
          </button>
        </div>
      ) : null}

      <main className="mushaf-wrap">
        <article
          className={`mushaf${hidden && phase === 'live' ? ' is-hidden-mode' : ''}`}
          style={{ fontSize: `${settings.fontSize}px` }}
          aria-label={`سورة ${sData.name}`}
        >
          {surah !== 1 && surah !== 9 ? (
            <p className="bismillah">بِسْمِ ٱللَّهِ ٱلرَّحْمَٰنِ ٱلرَّحِيمِ</p>
          ) : null}

          {ayahs.map((a) => (
            <div className="ayah" id={`ayah-${a}`} key={a}>
              {wordsOf(surah, a).map((w, i) => {
                const key = wordKey(surah, a, i);
                const status = statuses[key] ?? 'neutral';
                const hist = settings.highlightHistory
                  ? highlightLevel(wordStats[key])
                  : 'none';
                const isHidden =
                  phase === 'live' &&
                  hidden &&
                  !revealed[key] &&
                  status !== 'wrong' &&
                  status !== 'tashkeel';
                return (
                  <Fragment key={key}>
                    <WordSpan
                      text={w}
                      status={status}
                      hidden={isHidden}
                      history={hist}
                      active={lastWordRef.current?.key === key}
                      current={currentKey === key}
                      interactive
                      seekable={phase === 'live' && !paused}
                      onOpen={() => openWord(key, isHidden)}
                    />{' '}
                  </Fragment>
                );
              })}
              {settings.hideAyahMarkers && phase === 'live' ? null : (
                <span className="ayah-marker" aria-label={`الآية ${a}`}>
                  {arabicNumber(a)}
                </span>
              )}
            </div>
          ))}
        </article>

        <div className="mushaf-foot">
          <span className="muted small">
            {phase === 'live' && hidden
              ? 'الآيات مخفية — الأخطاء تظهر بالأحمر والحركات بالكهرماني'
              : 'اضغط أي كلمة لعرض سجلها'}
          </span>
          {phase === 'live' ? (
            <button className="link-btn" onClick={() => setHidden((h) => !h)}>
              {hidden ? <Eye size={15} /> : <EyeOff size={15} />}
              {hidden ? 'أظهر الآيات' : 'أخفِ الآيات'}
            </button>
          ) : null}
        </div>
      </main>

      <footer className={`reader-bar${phase === 'live' ? ' is-live' : ''}`}>
        {phase === 'read' ? (
          <>
            <button
              className="icon-btn"
              onClick={() => {
                setLastSessionId(null);
                setMistakesOpen(true);
              }}
              aria-label="سجل الأخطاء"
            >
              <ListChecks size={21} />
            </button>
            <button className="mic-btn" onClick={openStart}>
              <Mic size={26} aria-hidden />
              <span>تلاوة من الذاكرة</span>
            </button>
            <button
              className={`icon-btn${hidden ? ' is-on' : ''}`}
              onClick={() => setHidden((h) => !h)}
              aria-label={hidden ? 'إظهار الآيات' : 'إخفاء الآيات'}
            >
              {hidden ? <Eye size={21} /> : <EyeOff size={21} />}
            </button>
          </>
        ) : (
          <>
            <button
              className="icon-btn"
              onClick={() => setMistakesOpen(true)}
              aria-label={`الأخطاء ${errors}`}
            >
              <span className="counter">{arabicNumber(errors)}</span>
            </button>
            <button
              className="icon-btn"
              onClick={stepWord}
              disabled={stepDisabled}
              aria-label="الكلمة التالية يدوياً"
              title="الكلمة التالية يدوياً"
            >
              <SkipForward size={21} />
            </button>
            <button className="icon-btn" onClick={peekNext} aria-label="اكشف الكلمة التالية">
              <ChevronLeft size={22} />
            </button>
            <button className="icon-btn" onClick={peekAyah} aria-label="اكشف بقية الآية">
              <ChevronsLeft size={22} />
            </button>
            <button
              className="mic-btn is-live"
              onClick={togglePause}
              aria-label={paused ? 'متابعة' : 'إيقاف مؤقت'}
            >
              {paused ? <Play size={26} /> : <Pause size={26} />}
              <span>{paused ? 'متابعة' : 'إيقاف'}</span>
            </button>
            <button className="icon-btn danger" onClick={() => finishRef.current()} aria-label="إنهاء الجلسة">
              <Square size={19} />
            </button>
          </>
        )}
      </footer>

      {toast ? (
        <div className="toast" role="status">
          <Sparkles size={16} /> {toast}
        </div>
      ) : null}

      <Sheet
        open={startOpen}
        title="بدء جلسة حفظ"
        onClose={() => setStartOpen(false)}
      >
        <div className="consent">
          <div className="start-ayah">
            <span className="range-copy">
              <strong>ابدأ من الآية</strong>
              <small className="muted">لن تُعدّ الآيات قبلها أخطاءً</small>
            </span>
            <input
              type="number"
              inputMode="numeric"
              min={1}
              max={sData.total_verses}
              value={startAyah || ''}
              onChange={(e) =>
                setStartAyah(e.target.value === '' ? 0 : Number(e.target.value))
              }
              aria-label="آية بداية الجلسة"
            />
          </div>
          <p className="muted small">
            تبدأ الجلسة من الآية{' '}
            {arabicNumber(Math.min(sData.total_verses, Math.max(1, startAyah || ayahParam)))} إلى{' '}
            {arabicNumber(
              Math.min(
                sData.total_verses,
                Math.max(1, startAyah || ayahParam) + PAGE - 1,
              ),
            )}
            . الآيات قبل آية البداية لا تُحتسب أخطاءً.
          </p>

          {!settings.speechConsent ? (
            hasSharedSpeech ? (
              <p>
                التتبّع الصوتي يستخدم Gemini لسماع تلاوتك وإعادة كلماتها مشكَّلة،
                فيُكشف خطأ الحركة وأحكام التجويد. تُرسل مقاطع قصيرة من صوتك إلى
                Google عند التلاوة فقط؛{' '}
                <strong>تدبّر لا يسجّل صوتك ولا يخزّنه</strong>، ولا يحفظ إلا
                الكلمات التي تعرّف عليها.
              </p>
            ) : (
              <p>
                التتبّع الصوتي يستخدم محرّك التعرّف في متصفحك. قد يعالج المتصفح
                الصوت في خدمة سحابية تابعة لمزوّده؛{' '}
                <strong>تدبّر لا يسجّل صوتك ولا يخزّنه</strong>، ولا يحفظ إلا
                الكلمات التي تعرّف عليها.
              </p>
            )
          ) : null}
          <p className="muted small">
            لا يتقدّم التتبّع بالمؤقّت أو الصمت: كل كلمة تُفتح فقط عندما يسمعها
            المحرّك. وإن تعذّر الميكروفون، تضغط «الكلمة التالية» بعد كل كلمة.
          </p>
          <p className="muted small">
            محرّك المتصفح عامّ وليس مدرّباً على التلاوة، وقد يخطئ في موضعه. إن
            حدث ذلك فاضغط الكلمة التي وصلت إليها ثم «تابع التتبّع من هذه الكلمة»،
            ولا يُحتسب ذلك خطأً.
          </p>
          {speechBiasing ? (
            <p className="muted small">
              محرّكك يقبل توجيه السماع، فنمرّر إليه كلمات الآية القادمة فقط
              ليتعرّف على الألفاظ القرآنية النادرة قبل أن يخمّنها. التوجيه لا
              يفتح كلمة ولا يحرّك المؤشّر.
            </p>
          ) : null}

          <button
            className="btn btn-primary wide"
            onClick={() => chooseEngine(hasSharedSpeech ? 'gemini' : 'browser')}
            disabled={hasSharedSpeech ? false : !speechSupported}
          >
            {hasSharedSpeech ? (
              <Sparkles size={18} aria-hidden />
            ) : (
              <Mic size={18} aria-hidden />
            )}{' '}
            ابدأ بالتعرّف الصوتي{hasSharedSpeech ? ' — Gemini' : ''}
          </button>
          {hasSharedSpeech && speechSupported ? (
            <button
              className="btn btn-secondary wide"
              onClick={() => chooseEngine('browser')}
            >
              <Mic size={18} aria-hidden /> استخدام تعرّف المتصفح بدلاً منه
            </button>
          ) : null}
          {!speechSupported && !hasSharedSpeech ? (
            <p className="muted small center">
              هذا المتصفح لا يوفّر التعرّف الصوتي، لذا سيعمل التتبّع اليدوي فقط.
            </p>
          ) : null}
          <button
            className="btn btn-secondary wide"
            onClick={() => chooseEngine('manual')}
          >
            <Keyboard size={18} aria-hidden /> ابدأ بالتتبّع اليدوي
          </button>
          <p className="muted small center">
            يمكنك تغيير طريقة التتبّع لاحقاً من الإعدادات أو أثناء الجلسة.
          </p>
        </div>
      </Sheet>

      <Sheet
        open={mistakesOpen}
        title={sessionId || lastSessionId ? 'أخطاء الجلسة' : 'سجل الأخطاء'}
        onClose={() => setMistakesOpen(false)}
      >
        <MistakesList
          mistakes={scopeMistakes}
          onRemove={removeMistake}
          onRestore={restoreMistake}
          onOpenWord={(m) => {
            setMistakesOpen(false);
            setHistoryWord(m.wordKey);
          }}
        />
      </Sheet>

      <Sheet
        open={!!historyWord}
        title="سجل الكلمة"
        onClose={closeHistory}
      >
        {historyWord ? (
          <WordHistoryPanel
            wordKey={historyWord}
            onRemove={removeMistake}
            onRestore={restoreMistake}
            onMarkHarakat={
              phase === 'live' &&
              !paused &&
              historyPosition >= 0 &&
              historyPosition < cursor
                ? () => markTashkeelWord(historyWord)
                : undefined
            }
            harakatMarked={statuses[historyWord] === 'tashkeel'}
            onResync={
              phase === 'live' && !paused
                ? () => resyncFrom(historyWord)
                : undefined
            }
          />
        ) : null}
      </Sheet>

      <Sheet
        open={!!seekWord}
        title="إعادة المزامنة"
        onClose={() => setSeekWord(null)}
      >
        {seekWord ? (() => {
          const [, a, i] = seekWord.split(':').map(Number);
          return (
            <div className="seek-panel">
              <p className="center">
                الكلمة {arabicNumber(i + 1)} في الآية {arabicNumber(a)} — مخفية،
                لن نكشف نصّها.
              </p>
              <button
                className="btn wide btn-primary"
                onClick={() => resyncFrom(seekWord)}
              >
                <Crosshair size={16} aria-hidden /> تابع التتبّع من هذه الكلمة
              </button>
              <p className="muted small center">
                ينتقل المؤشّر إلى هنا دون تسجيل خطأ ودون تغيير عدّاد الأخطاء، ثم
                تابع التلاوة بصوتك.
              </p>
            </div>
          );
        })() : null}
      </Sheet>

      <Sheet open={navOpen} title="انتقل إلى" onClose={() => setNavOpen(false)}>
        <div className="nav-form">
          <label>
            السورة
            <select
              value={surah}
              onChange={(e) => navigate(`/read/${e.target.value}?ayah=1`)}
            >
              {surahs.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.id}. {s.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            الآية
            <input
              type="number"
              min={1}
              max={sData.total_verses}
              value={from}
              onChange={(e) => goAyah(Number(e.target.value) || 1)}
            />
          </label>
        </div>
        <p className="muted small">اختر السورة ثم الآية. يمكنك أيضاً استخدام صفحة الحفظ.</p>
      </Sheet>

      <Sheet
        open={!!summary}
        title="خلاصة الجلسة"
        onClose={() => setSummary(null)}
        footer={
          <div className="row">
            <button className="btn btn-ghost" onClick={() => setSummary(null)}>
              تم
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                setSummary(null);
                openStart();
              }}
            >
              جلسة أخرى
            </button>
          </div>
        }
      >
        {summary ? (
          <div className="summary">
            <div className="stat-grid">
              <div className="stat">
                <strong>{arabicNumber(summary.ayahs)}</strong>
                <span>آية أُتمّت</span>
              </div>
              <div className="stat">
                <strong>{arabicNumber(summary.words)}</strong>
                <span>كلمة صحيحة</span>
              </div>
              <div className="stat is-bad">
                <strong>{arabicNumber(summary.errors)}</strong>
                <span>خطأ</span>
              </div>
              <div className="stat">
                <strong>{arabicNumber(summary.minutes)}</strong>
                <span>دقيقة</span>
              </div>
            </div>
            <button
              className="btn btn-secondary wide"
              onClick={() => {
                setMistakesOpen(true);
                setSummary(null);
              }}
            >
              راجع أخطاء هذه الجلسة
            </button>
            <p className="muted small center">
              اليوم: {todaySessions.length} جلسة · سلسلة {getState().streak.current} يوم
            </p>
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
