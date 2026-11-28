import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  Download,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { arabicNumber } from '../lib/quran';
import { askIslamqa, IslamqaError, islamqaSearchUrl } from '../lib/islamqa';
import type { IslamqaAnswer, IslamqaAnswerSet } from '../lib/islamqa';
import { collectResults } from '../lib/dorar';
import type { DorarAnswer, DorarHadith, DorarItem } from '../lib/dorar';
import { getCachedAnswer, offlineAnswers } from '../lib/dorarOffline';
import type { CachedDorar } from '../lib/dorarOffline';
import {
  countLine,
  DISCLAIMER,
  DORAR_DISCLAIMER,
  dorarCountLine,
  missingFor,
  NO_ANSWER,
  NO_AUTHENTIC,
  NOT_FOUND,
  openingFor,
  PARTIAL,
  seedFor,
  WELCOME,
} from '../lib/chatLines';

const STORAGE_KEY = 'tadabbur.ask.v3';
/** محادثات الإصدارات القديمة كانت من مصدر آخر، فلا تُعرض هنا. */
const LEGACY_KEYS = ['tadabbur.ask.v2', 'tadabbur.ask.v1'];
const MAX_STORED = 8;
/** ما يُحفظ من كل جواب في localStorage. */
const MAX_KEPT = 6;
/** ما يُعرض قبل «عرض المزيد». */
const FIRST_VIEW = 3;

type TurnStatus = 'pending' | 'ready' | 'error';

interface Turn {
  id: string;
  question: string;
  /** وقت السؤال، لعرضه في فقاعة المحادثة. */
  at: number;
  status: TurnStatus;
  /** البحث الجديد يأتي من IslamQA وحده. */
  answer?: IslamqaAnswerSet;
  /** الإجابات القديمة المحفوظة من الدرر تبقى قابلة للقراءة دون اتصال. */
  dorar?: DorarAnswer;
  /** الإجابة جاءت من المحفوظات لا من الشبكة. */
  cached?: boolean;
  error?: string;
}

interface Stored {
  turns: Turn[];
}

const SUGGESTIONS = [
  'فضل الصلاة على النبي',
  'حكم الغيبة',
  'بر الوالدين',
  'حكم الربا',
  'أذكار الصباح',
  'تفسير آية الكرسي',
];

const ERROR_TEXT: Record<string, string> = {
  'not-configured':
    'لم يُضبط بعد رابط وسيط IslamQA. راجع إعدادات النشر في ملف .env.example.',
  'upstream-blocked':
    'تعذّر الوصول إلى موقع IslamQA الآن. أعد المحاولة بعد لحظات، أو افتح البحث في الموقع.',
  'bad-response': 'وصل ردّ غير مفهوم من خدمة البحث. أعد المحاولة.',
  network: 'تعذّر الاتصال بخدمة البحث. تحقّق من اتصالك ثم أعد المحاولة.',
  timeout: 'تأخّر البحث أكثر من المتوقع. أعد المحاولة بعد لحظات.',
  'query-too-short': 'اكتب سؤالاً أوضح بكلمتين على الأقل.',
};

function errorMessage(code: string | undefined): string {
  return (
    (code ? ERROR_TEXT[code] : undefined) ??
    'تعذّر إحضار النتائج الآن. أعد المحاولة أو افتح البحث في موقع IslamQA.'
  );
}

/** وقت الفقاعة بصيغة ٢٤ ساعة وبأرقام عربية. */
function clock(at: number): string {
  const date = new Date(at);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return arabicNumber(`${hours}:${minutes}`);
}

function gradeTone(grade: string): string {
  if (/صحيح/.test(grade) && !/ضعيف|ضعف|لا يصح/.test(grade)) return 'is-sahih';
  if (/حسن/.test(grade) && !/ضعيف|ضعف|لا يصح/.test(grade)) return 'is-hasan';
  return '';
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isAnswer(value: unknown): value is IslamqaAnswer {
  if (!value || typeof value !== 'object') return false;
  const item = value as Partial<IslamqaAnswer>;
  return (
    typeof item.id === 'number' &&
    Number.isSafeInteger(item.id) &&
    item.id > 0 &&
    typeof item.title === 'string'
  );
}

/** لا تُقبل محادثة محفوظة إلا إن كانت نتائجها من IslamQA. */
function normalizeAnswer(answer: unknown): IslamqaAnswerSet | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const record = answer as Partial<IslamqaAnswerSet>;
  if (!Array.isArray(record.answers)) return undefined;
  const answers = record.answers.filter(isAnswer).slice(0, MAX_KEPT);
  return {
    query: typeof record.query === 'string' ? record.query : '',
    answers,
    total: typeof record.total === 'number' ? record.total : answers.length,
    fetchedAt: typeof record.fetchedAt === 'number' ? record.fetchedAt : Date.now(),
  };
}

function isDorarAnswer(value: unknown): value is DorarAnswer {
  return Boolean(value && typeof value === 'object' && Array.isArray((value as DorarAnswer).sources));
}

function loadTurns(): Turn[] {
  try {
    // مصدر الجواب تغيّر؛ لا نخلط نتائج قديمة من موقع آخر بهذه المحادثة.
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(parsed.turns)) return [];
    return parsed.turns
      .map((turn): Turn | null => {
        if (!turn || typeof turn.id !== 'string' || typeof turn.question !== 'string') {
          return null;
        }
        if (turn.status !== 'ready' && turn.status !== 'error') return null;
        const answer = normalizeAnswer(turn.answer);
        const dorar = isDorarAnswer(turn.dorar) ? turn.dorar : undefined;
        if (turn.status === 'ready' && !answer && !dorar) return null;
        return {
          id: turn.id,
          question: turn.question,
          at: typeof turn.at === 'number' ? turn.at : Date.now(),
          status: turn.status,
          answer,
          dorar,
          cached: turn.cached === true,
          error: turn.error,
        };
      })
      .filter((turn): turn is Turn => turn !== null)
      .slice(-MAX_STORED);
  } catch {
    return [];
  }
}

function saveTurns(turns: Turn[]) {
  try {
    const slim = turns
      .filter((turn) => turn.status !== 'pending')
      .slice(-MAX_STORED)
      .map((turn) => {
        const saved: Turn = { ...turn };
        if (saved.answer) {
          saved.answer = { ...saved.answer, answers: saved.answer.answers.slice(0, MAX_KEPT) };
        }
        if (saved.dorar) {
          saved.dorar = {
            ...saved.dorar,
            hadiths: saved.dorar.hadiths.slice(0, MAX_KEPT),
            sources: saved.dorar.sources.map((source) => ({
              ...source,
              hadiths: source.hadiths.slice(0, MAX_KEPT),
              items: source.items.slice(0, MAX_KEPT),
            })),
          };
        }
        return saved;
      });
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns: slim }));
  } catch {
    /* التخزين قد يكون معطّلاً أو ممتلئاً */
  }
}

function hadithMeta(hadith: DorarHadith): string {
  return [
    ['الراوي', hadith.narrator],
    ['المحدث', hadith.scholar],
    ['المصدر', hadith.source],
    ['الرقم', hadith.reference],
  ]
    .filter(([, value]) => Boolean(value))
    .map(([label, value]) => `${label}: ${value}`)
    .join(' · ');
}

function Typing() {
  return (
    <span className="chat-typing" role="status" aria-label="أبحث في IslamQA">
      <span />
      <span />
      <span />
    </span>
  );
}

function HadithCard({
  hadith,
  copyKey,
  copied,
  onCopy,
}: {
  hadith: DorarHadith;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
}) {
  const meta = hadithMeta(hadith);
  return (
    <li className="chat-msg is-in chat-hadith">
      <div className="chat-hadith-head">
        <span className={`hadith-grade ${gradeTone(hadith.grade)}`}>
          {hadith.grade || 'حسن'}
        </span>
        <button
          className="chat-mini"
          type="button"
          onClick={() => onCopy(copyKey, hadith.text)}
          aria-label="نسخ نص الحديث"
        >
          {copied === copyKey ? (
            <Check size={13} aria-hidden />
          ) : (
            <Copy size={13} aria-hidden />
          )}
          {copied === copyKey ? 'نُسخ' : 'نسخ'}
        </button>
      </div>
      <p className="hadith-text" dir="rtl">
        {hadith.text}
      </p>
      {meta ? <p className="chat-hadith-meta">{meta}</p> : null}
    </li>
  );
}

function ExcerptCard({
  item,
  expanded,
  onToggle,
}: {
  item: DorarItem;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`chat-msg is-in chat-item${expanded ? ' is-open' : ''}`}>
      <button
        className="chat-item-body"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`chat-item-text${expanded ? '' : ' is-clamped'}`}>
          {item.text}
        </span>
        {item.meta ? <span className="chat-item-meta">{item.meta}</span> : null}
      </button>
      <div className="chat-item-foot">
        <a className="chat-mini" href={item.url} target="_blank" rel="noreferrer">
          في الدرر
          <ExternalLink size={12} aria-hidden />
        </a>
        <button
          className="chat-mini"
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? 'أقلّ' : 'توسيع'}
          <ChevronDown
            size={13}
            aria-hidden
            className={expanded ? 'is-flipped' : undefined}
          />
        </button>
      </div>
    </li>
  );
}

function AnswerCard({
  answer,
  copyKey,
  copied,
  onCopy,
  expanded,
  onToggle,
}: {
  answer: IslamqaAnswer;
  copyKey: string;
  copied: string | null;
  onCopy: (key: string, text: string) => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <li className={`chat-msg is-in chat-item${expanded ? ' is-open' : ''}`}>
      <div className="chat-item-head">
        <span className="chat-source-badge">الإسلام سؤال وجواب</span>
        <button
          className="chat-mini"
          type="button"
          onClick={() =>
            onCopy(
              copyKey,
              [
                answer.title,
                answer.question ? `السؤال: ${answer.question}` : '',
                `الجواب:\n${answer.body}`,
                answer.url,
              ]
                .filter(Boolean)
                .join('\n\n'),
            )
          }
          aria-label="نسخ الجواب"
        >
          {copied === copyKey ? (
            <Check size={13} aria-hidden />
          ) : (
            <Copy size={13} aria-hidden />
          )}
          {copied === copyKey ? 'نُسخ' : 'نسخ'}
        </button>
      </div>
      <h3 className="chat-answer-title" dir="rtl">
        {answer.title}
      </h3>
      {answer.question ? (
        <p className="chat-answer-question" dir="rtl">
          {answer.question}
        </p>
      ) : null}
      <button
        className="chat-item-body"
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
      >
        <span className={`chat-item-text${expanded ? '' : ' is-clamped'}`}>
          {answer.body}
        </span>
      </button>
      <div className="chat-item-foot">
        <a className="chat-mini" href={answer.url} target="_blank" rel="noreferrer">
          اقرأ الجواب كاملاً في الموقع
          <ExternalLink size={12} aria-hidden />
        </a>
        <button
          className="chat-mini"
          type="button"
          onClick={onToggle}
          aria-expanded={expanded}
        >
          {expanded ? 'أقلّ' : 'توسيع'}
          <ChevronDown
            size={13}
            aria-hidden
            className={expanded ? 'is-flipped' : undefined}
          />
        </button>
      </div>
    </li>
  );
}

interface TurnViewProps {
  turn: Turn;
  seed: number;
  copied: string | null;
  expanded: boolean;
  openItems: Set<string>;
  onCopy: (key: string, text: string) => void;
  onToggleTurn: () => void;
  onToggleItem: (key: string) => void;
}

/** إجابة محفوظة قديمة من الدرر: تُعرض كما حُفظت، ولا تُبحث بها من جديد. */
function DorarTurn({
  turn,
  seed,
  copied,
  expanded,
  openItems,
  onCopy,
  onToggleTurn,
  onToggleItem,
}: TurnViewProps & { turn: Turn & { dorar: DorarAnswer } }) {
  const answer = turn.dorar;
  const collected = collectResults(answer, 6, 6);
  const entries: Array<
    { kind: 'hadith'; hadith: DorarHadith } | { kind: 'excerpt'; item: DorarItem }
  > = [
    ...collected.hadiths.map((hadith) => ({ kind: 'hadith' as const, hadith })),
    ...collected.excerpts.map((item) => ({ kind: 'excerpt' as const, item })),
  ];
  const total = entries.length;
  const visible = expanded ? entries : entries.slice(0, FIRST_VIEW);
  const hidden = total - visible.length;

  if (!total) {
    return (
      <div className="chat-msg is-in is-no-answer">
        <p className="chat-greeting">{NO_ANSWER}</p>
        <p className="chat-note">{missingFor(seed)}</p>
        <p className="chat-note">{NOT_FOUND}</p>
        <div className="chat-foot-actions">
          <a
            className="chat-action"
            href={answer.moreUrl}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden />
            البحث في الدرر
          </a>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="chat-msg is-in">
        <p className="chat-greeting">{openingFor(seed)}</p>
        <p>{dorarCountLine(answer.query, total)}</p>
        {turn.cached ? (
          <p className="chat-note">من المحفوظات على جهازك — قد لا تكون هذه أحدث نتيجة.</p>
        ) : null}
        {!collected.hadiths.length && collected.skippedWeak ? (
          <p className="chat-warning">{NO_AUTHENTIC}</p>
        ) : null}
        {answer.partial ? <p className="chat-note">{PARTIAL}</p> : null}
        <span className="chat-meta">
          <time>{clock(turn.at)}</time>
        </span>
      </div>

      <ol className="chat-results">
        {visible.map((entry) =>
          entry.kind === 'hadith' ? (
            <HadithCard
              key={`${turn.id}|h|${entry.hadith.text.slice(0, 24)}`}
              hadith={entry.hadith}
              copyKey={`${turn.id}|h|${entry.hadith.text.slice(0, 24)}`}
              copied={copied}
              onCopy={onCopy}
            />
          ) : (
            <ExcerptCard
              key={`${turn.id}|e|${entry.item.url}`}
              item={entry.item}
              expanded={openItems.has(`${turn.id}|e|${entry.item.url}`)}
              onToggle={() => onToggleItem(`${turn.id}|e|${entry.item.url}`)}
            />
          ),
        )}
      </ol>

      <div className="chat-list-foot">
        {hidden > 0 || expanded ? (
          <button className="chat-action" type="button" onClick={onToggleTurn}>
            <ChevronDown
              size={14}
              aria-hidden
              className={expanded ? 'is-flipped' : undefined}
            />
            {expanded ? 'أقلّ' : `عرض المزيد (${arabicNumber(hidden)})`}
          </button>
        ) : null}
        <a
          className="chat-action"
          href={answer.moreUrl}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} aria-hidden />
          كل النتائج في الدرر
        </a>
      </div>

      <div className="chat-msg is-in is-foot">
        <p className="chat-note">{DORAR_DISCLAIMER}</p>
        <span className="chat-meta">
          <time>{clock(turn.at)}</time>
        </span>
      </div>
    </>
  );
}

function IslamqaTurn({
  turn,
  seed,
  copied,
  expanded,
  openItems,
  onCopy,
  onToggleTurn,
  onToggleItem,
}: TurnViewProps & { turn: Turn & { answer: IslamqaAnswerSet } }) {
  const answer = turn.answer;
  const entries = answer.answers;
  const total = entries.length;
  const visible = expanded ? entries : entries.slice(0, FIRST_VIEW);
  const hidden = total - visible.length;

  if (!total) {
    return (
      <div className="chat-msg is-in is-no-answer">
        <p className="chat-greeting">{NO_ANSWER}</p>
        <p className="chat-note">{missingFor(seed)}</p>
        <p className="chat-note">{NOT_FOUND}</p>
        <div className="chat-foot-actions">
          <a
            className="chat-action"
            href={islamqaSearchUrl(answer.query || turn.question)}
            target="_blank"
            rel="noreferrer"
          >
            <ExternalLink size={14} aria-hidden />
            البحث في الموقع
          </a>
        </div>
        <span className="chat-meta">
          <time>{clock(turn.at)}</time>
        </span>
      </div>
    );
  }

  return (
    <>
      <div className="chat-msg is-in">
        <p className="chat-greeting">{openingFor(seed)}</p>
        <p>{countLine(answer.query, total)}</p>
        {turn.cached ? (
          <p className="chat-note">من المحفوظات على جهازك — قد لا تكون هذه أحدث نتيجة.</p>
        ) : null}
        <span className="chat-meta">
          <time>{clock(turn.at)}</time>
        </span>
      </div>

      <ol className="chat-results">
        {visible.map((item) => {
          const key = `${turn.id}|${item.id}`;
          return (
            <AnswerCard
              key={key}
              answer={item}
              copyKey={key}
              copied={copied}
              onCopy={onCopy}
              expanded={openItems.has(key)}
              onToggle={() => onToggleItem(key)}
            />
          );
        })}
      </ol>

      <div className="chat-list-foot">
        {hidden > 0 || expanded ? (
          <button className="chat-action" type="button" onClick={onToggleTurn}>
            <ChevronDown
              size={14}
              aria-hidden
              className={expanded ? 'is-flipped' : undefined}
            />
            {expanded ? 'أقلّ' : `عرض المزيد (${arabicNumber(hidden)})`}
          </button>
        ) : null}
        <a
          className="chat-action"
          href={islamqaSearchUrl(turn.question)}
          target="_blank"
          rel="noreferrer"
        >
          <ExternalLink size={14} aria-hidden />
          كل النتائج في الموقع
        </a>
      </div>

      <div className="chat-msg is-in is-foot">
        <p className="chat-note">{DISCLAIMER}</p>
        <span className="chat-meta">
          <time>{clock(turn.at)}</time>
        </span>
      </div>
    </>
  );
}

export function Ask() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [saved, setSaved] = useState<CachedDorar[]>(offlineAnswers);
  const [input, setInput] = useState('');
  const [openTurns, setOpenTurns] = useState<Set<string>>(new Set());
  const [openItems, setOpenItems] = useState<Set<string>>(new Set());
  const [copied, setCopied] = useState<string | null>(null);
  const wallRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    saveTurns(turns);
  }, [turns]);

  const busy = turns.some((turn) => turn.status === 'pending');

  // المحادثة تُفتح على آخر رسالة، كما في تطبيقات الدردشة.
  useEffect(() => {
    const wall = wallRef.current;
    if (!wall) return;
    wall.scrollTop = wall.scrollHeight;
  }, [turns, openTurns, openItems]);

  const run = useCallback(async (id: string, question: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 45000);
    try {
      const answer = await askIslamqa(question, controller.signal);
      if (!mountedRef.current) return;
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? { ...turn, status: 'ready', answer, dorar: undefined, cached: false, error: undefined }
            : turn,
        ),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      // البحث الجديد IslamQA فقط؛ المحفوظات القديمة تُعرض عند تعذّر الاتصال.
      const cached = getCachedAnswer(question);
      if (cached) {
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === id
              ? { ...turn, status: 'ready', answer: undefined, dorar: cached, cached: true, error: undefined }
              : turn,
          ),
        );
        return;
      }
      const code =
        (error as Error).name === 'AbortError'
          ? 'timeout'
          : error instanceof IslamqaError
            ? error.code
            : 'network';
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id ? { ...turn, status: 'error', error: code } : turn,
        ),
      );
    } finally {
      window.clearTimeout(timer);
    }
  }, []);

  const ask = useCallback(
    (raw: string) => {
      const question = raw.trim();
      if (!question || busy) return;
      const id = newId();
      setInput('');
      setTurns((prev) =>
        [
          ...prev,
          { id, question, at: Date.now(), status: 'pending' as const },
        ].slice(-MAX_STORED),
      );
      void run(id, question);
      inputRef.current?.focus();
    },
    [busy, run],
  );

  const retry = useCallback(
    (turn: Turn) => {
      if (busy) return;
      setTurns((prev) =>
        prev.map((item) =>
          item.id === turn.id
            ? { ...item, status: 'pending', error: undefined }
            : item,
        ),
      );
      void run(turn.id, turn.question);
    },
    [busy, run],
  );

  const openCached = useCallback(
    (entry: CachedDorar) => {
      if (busy) return;
      const id = newId();
      setInput('');
      setTurns((prev) =>
        [
          ...prev,
          {
            id,
            question: entry.query,
            at: Date.now(),
            status: 'ready' as const,
            dorar: entry.answer,
            cached: true,
          },
        ].slice(-MAX_STORED),
      );
      inputRef.current?.focus();
    },
    [busy],
  );

  const clear = useCallback(() => {
    setTurns([]);
    setInput('');
    setOpenTurns(new Set());
    setOpenItems(new Set());
  }, []);

  const toggleTurn = useCallback((key: string) => {
    setOpenTurns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleItem = useCallback((key: string) => {
    setOpenItems((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const copyText = useCallback((key: string, text: string) => {
    const done = () => {
      setCopied(key);
      window.setTimeout(
        () => setCopied((current) => (current === key ? null : current)),
        1600,
      );
    };
    if (navigator.clipboard?.writeText) {
      void navigator.clipboard.writeText(text).then(done, () => {});
    }
  }, []);

  const scopeLabel = useMemo(
    () => (turns.some((turn) => turn.status === 'pending') ? 'يبحث…' : 'متصل'),
    [turns],
  );

  return (
    <div className="chat">
      <header className="chat-head">
        <span className="chat-avatar" aria-hidden>
          <BookMarked size={20} />
        </span>
        <span className="chat-id">
          <strong>الإسلام سؤال وجواب</strong>
          <small>islamqa.info · {scopeLabel}</small>
        </span>
        <span className="chat-head-actions">
          <a
            className="chat-icon-btn"
            href="https://islamqa.info/ar"
            target="_blank"
            rel="noreferrer"
            aria-label="فتح موقع الإسلام سؤال وجواب"
          >
            <ExternalLink size={17} />
          </a>
          {turns.length ? (
            <button
              className="chat-icon-btn"
              type="button"
              onClick={clear}
              aria-label="مسح المحادثة"
            >
              <Trash2 size={17} />
            </button>
          ) : null}
        </span>
      </header>

      <div className="chat-wall" ref={wallRef}>
        <p className="chat-day" aria-hidden>
          اليوم
        </p>
        {saved.length ? (
          <div className="chat-offline-bar">
            <span className="chat-offline-title">
              <Download size={14} aria-hidden /> محفوظ للقراءة دون إنترنت
            </span>
            <span className="chat-offline-chips">
              {saved.slice(0, 6).map((entry) => (
                <button
                  key={entry.query}
                  className="chat-offline-chip"
                  type="button"
                  onClick={() => openCached(entry)}
                  disabled={busy}
                  title={`إجابة محفوظة من الدرر: ${entry.query}`}
                >
                  {entry.query}
                </button>
              ))}
            </span>
            <span className="chat-offline-note">
              {arabicNumber(saved.length)} إجابة
            </span>
          </div>
        ) : null}
        <p className="chat-notice">
          الجواب منقول حرفياً من موقع IslamQA، ولا نضيف إليه رأياً. والمحفوظات
          القديمة من الدرر تبقى على جهازك.
        </p>

        {turns.length === 0 ? (
          <>
            <div className="chat-msg is-in">
              <p>{WELCOME}</p>
            </div>
            <div className="chat-suggestions">
              <p className="chat-suggestions-title">جرّب أحد هذه الأسئلة:</p>
              <div className="chat-chips">
                {SUGGESTIONS.map((suggestion) => (
                  <button
                    key={suggestion}
                    className="chat-chip"
                    type="button"
                    onClick={() => ask(suggestion)}
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            </div>
          </>
        ) : null}

        {turns.map((turn) => {
          const seed = seedFor(turn.id);
          const viewProps: TurnViewProps = {
            turn,
            seed,
            copied,
            expanded: openTurns.has(turn.id),
            openItems,
            onCopy: copyText,
            onToggleTurn: () => toggleTurn(turn.id),
            onToggleItem: toggleItem,
          };

          return (
            <div className="chat-turn" key={turn.id}>
              <div className="chat-msg is-out">
                <p>{turn.question}</p>
                <span className="chat-meta">
                  <time>{clock(turn.at)}</time>
                  <CheckCheck size={13} aria-hidden />
                </span>
              </div>

              {turn.status === 'pending' ? (
                <div className="chat-msg is-in is-typing">
                  <Typing />
                </div>
              ) : turn.status === 'error' ? (
                <div className="chat-msg is-in is-error" role="alert">
                  <p>{errorMessage(turn.error)}</p>
                  <div className="chat-error-actions">
                    <button
                      className="chat-action"
                      type="button"
                      onClick={() => retry(turn)}
                      disabled={busy}
                    >
                      <RefreshCw size={14} aria-hidden />
                      أعد المحاولة
                    </button>
                    <a
                      className="chat-action"
                      href={islamqaSearchUrl(turn.question)}
                      target="_blank"
                      rel="noreferrer"
                    >
                      افتح الموقع
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  </div>
                  <span className="chat-meta">
                    <time>{clock(turn.at)}</time>
                  </span>
                </div>
              ) : turn.dorar ? (
                <DorarTurn {...viewProps} turn={{ ...turn, dorar: turn.dorar }} />
              ) : turn.answer ? (
                <IslamqaTurn {...viewProps} turn={{ ...turn, answer: turn.answer }} />
              ) : (
                <div className="chat-msg is-in is-no-answer">
                  <p className="chat-greeting">{NO_ANSWER}</p>
                  <p className="chat-note">{missingFor(seed)}</p>
                  <p className="chat-note">{NOT_FOUND}</p>
                </div>
              )}
            </div>
          );
        })}
      </div>

      <form
        className="chat-composer"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <label className="sr-only" htmlFor="chat-input">
          سؤالك للإسلام سؤال وجواب
        </label>
        <div className="chat-field">
          <input
            id="chat-input"
            ref={inputRef}
            type="text"
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="اكتب سؤالك…"
            autoComplete="off"
            enterKeyHint="send"
            maxLength={300}
          />
          <button
            className="chat-send"
            type="submit"
            disabled={busy || input.trim().length < 2}
            aria-label="أرسل السؤال"
          >
            {busy ? (
              <Loader2 size={19} className="spin" aria-hidden />
            ) : (
              <Send size={19} aria-hidden />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
