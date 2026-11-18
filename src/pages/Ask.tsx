import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookMarked,
  Check,
  CheckCheck,
  ChevronDown,
  Copy,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { arabicNumber } from '../lib/quran';
import {
  askDorar,
  collectResults,
  dorarQuery,
  dorarSearchUrl,
  DorarError,
} from '../lib/dorar';
import type { DorarAnswer, DorarHadith, DorarItem } from '../lib/dorar';
import {
  countLine,
  DISCLAIMER,
  missingFor,
  NO_AUTHENTIC,
  NOT_FOUND,
  openingFor,
  PARTIAL,
  seedFor,
  WELCOME,
} from '../lib/chatLines';

const STORAGE_KEY = 'tadabbur.ask.v2';
const LEGACY_KEY = 'tadabbur.ask.v1';
const MAX_STORED = 8;
/** ما يُحفظ من كل جواب في localStorage. */
const MAX_KEPT = 12;
/** ما يُعرض قبل «عرض المزيد». الجواب يبدأ قصيراً. */
const FIRST_VIEW = 3;

type TurnStatus = 'pending' | 'ready' | 'error';

interface Turn {
  id: string;
  question: string;
  /** وقت السؤال، لعرضه في فقاعة المحادثة. */
  at: number;
  status: TurnStatus;
  answer?: DorarAnswer;
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
  'upstream-blocked':
    'تعذّر الوصول إلى الدرر السنية الآن. قد يحمي الموقع بحثه مؤقتاً؛ أعد المحاولة بعد لحظات أو افتح البحث مباشرة.',
  'upstream-unreachable':
    'خدمة الدرر لا تستجيب الآن. تحقّق من اتصالك ثم أعد المحاولة.',
  'upstream-invalid': 'وصل ردّ غير مفهوم من خدمة الدرر. أعد المحاولة.',
  'upstream-shape': 'تغيّرت صيغة نتيجة الدرر. أعد المحاولة لاحقاً.',
  network: 'تعذّر الاتصال بخدمة البحث. تحقّق من اتصالك ثم أعد المحاولة.',
  timeout: 'تأخّر البحث أكثر من المتوقع. أعد المحاولة بعد لحظات.',
  'query-too-short': 'اكتب سؤالاً أوضح بكلمتين على الأقل.',
  'invalid-response': 'وصل ردّ غير مفهوم من الخدمة. أعد المحاولة.',
};

function errorMessage(code: string | undefined): string {
  return (
    (code ? ERROR_TEXT[code] : undefined) ??
    'تعذّر إحضار النتائج الآن. أعد المحاولة أو افتح البحث في الدرر مباشرة.'
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

/**
 * يقبل المحادثة المحفوظة بأي إصدار سابق: ما دام الجواب فيه `sources` فهو
 * صالح، وما كان بالصيغة القديمة (الحديث وحده) يُحوَّل إليها.
 */
function normalizeAnswer(answer: unknown): DorarAnswer | undefined {
  if (!answer || typeof answer !== 'object') return undefined;
  const record = answer as Partial<DorarAnswer> & {
    hadiths?: DorarHadith[];
    total?: number;
    moreUrl?: string;
  };
  if (Array.isArray(record.sources)) return record as DorarAnswer;
  if (!Array.isArray(record.hadiths)) return undefined;
  const total = typeof record.total === 'number' ? record.total : record.hadiths.length;
  const moreUrl = record.moreUrl ?? dorarSearchUrl(record.query ?? '');
  return {
    query: record.query ?? '',
    hadiths: record.hadiths,
    total,
    moreUrl,
    partial: false,
    sources: [
      {
        source: 'hadith',
        label: 'الموسوعة الحديثية',
        short: 'الحديث',
        ok: true,
        total,
        moreUrl,
        hadiths: record.hadiths,
        items: [],
      },
    ],
  };
}

function loadTurns(): Turn[] {
  try {
    const key = localStorage.getItem(STORAGE_KEY) ? STORAGE_KEY : LEGACY_KEY;
    const raw = localStorage.getItem(key);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(parsed.turns)) return [];
    const turns = parsed.turns
      .map((turn): Turn | null => {
        if (!turn || typeof turn.id !== 'string' || typeof turn.question !== 'string') {
          return null;
        }
        if (turn.status !== 'ready' && turn.status !== 'error') return null;
        const answer = normalizeAnswer(turn.answer);
        if (turn.status === 'ready' && !answer) return null;
        return {
          id: turn.id,
          question: turn.question,
          at: typeof turn.at === 'number' ? turn.at : Date.now(),
          status: turn.status,
          answer,
          error: turn.error,
        };
      })
      .filter((turn): turn is Turn => turn !== null)
      .slice(-MAX_STORED);
    if (key === LEGACY_KEY) localStorage.removeItem(LEGACY_KEY);
    return turns;
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
        if (!turn.answer) return turn;
        return {
          ...turn,
          answer: {
            ...turn.answer,
            hadiths: turn.answer.hadiths.slice(0, MAX_KEPT),
            sources: turn.answer.sources.map((result) => ({
              ...result,
              hadiths: result.hadiths.slice(0, MAX_KEPT),
              items: result.items.slice(0, MAX_KEPT),
            })),
          },
        };
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
    <span className="chat-typing" role="status" aria-label="أبحث في الدرر">
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

export function Ask() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
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
    const timer = window.setTimeout(() => controller.abort(), 75000);
    try {
      const answer = await askDorar(question, undefined, controller.signal);
      if (!mountedRef.current) return;
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === id
            ? { ...turn, status: 'ready', answer, error: undefined }
            : turn,
        ),
      );
    } catch (error) {
      if (!mountedRef.current) return;
      const code =
        (error as Error).name === 'AbortError'
          ? 'timeout'
          : error instanceof DorarError
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

  const copyHadith = useCallback((key: string, text: string) => {
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
    () => (turns.some((turn) => turn.status === 'pending') ? 'يكتب…' : 'متصل'),
    [turns],
  );

  return (
    <div className="chat">
      <header className="chat-head">
        <span className="chat-avatar" aria-hidden>
          <BookMarked size={20} />
        </span>
        <span className="chat-id">
          <strong>الدرر السنية</strong>
          <small>موسوعات الدرر · {scopeLabel}</small>
        </span>
        <span className="chat-head-actions">
          <a
            className="chat-icon-btn"
            href="https://dorar.net"
            target="_blank"
            rel="noreferrer"
            aria-label="فتح موقع الدرر السنية"
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
        <p className="chat-notice">
          النتائج من موسوعات الدرر السنية، ويُقدَّم الصحيح والحسن.
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
          const answer = turn.answer;
          const collected = answer ? collectResults(answer, 6, 6) : null;
          const entries: Array<
            { kind: 'hadith'; hadith: DorarHadith } | { kind: 'excerpt'; item: DorarItem }
          > = [
            ...(collected?.hadiths ?? []).map((hadith) => ({
              kind: 'hadith' as const,
              hadith,
            })),
            ...(collected?.excerpts ?? []).map((item) => ({
              kind: 'excerpt' as const,
              item,
            })),
          ];
          const total = entries.length;
          const expanded = openTurns.has(turn.id);
          const visible = expanded ? entries : entries.slice(0, FIRST_VIEW);
          const hidden = total - visible.length;

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
                      href={dorarSearchUrl(dorarQuery(turn.question))}
                      target="_blank"
                      rel="noreferrer"
                    >
                      افتح الدرر
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  </div>
                  <span className="chat-meta">
                    <time>{clock(turn.at)}</time>
                  </span>
                </div>
              ) : answer && total > 0 ? (
                <>
                  <div className="chat-msg is-in">
                    <p className="chat-greeting">{openingFor(seed)}</p>
                    <p>{countLine(answer.query, total)}</p>
                    {!collected?.hadiths.length && collected?.skippedWeak ? (
                      <p className="chat-warning">{NO_AUTHENTIC}</p>
                    ) : null}
                    {answer.partial ? (
                      <p className="chat-note">{PARTIAL}</p>
                    ) : null}
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
                          onCopy={copyHadith}
                        />
                      ) : (
                        <ExcerptCard
                          key={`${turn.id}|${entry.item.url}`}
                          item={entry.item}
                          expanded={openItems.has(`${turn.id}|${entry.item.url}`)}
                          onToggle={() =>
                            toggleItem(`${turn.id}|${entry.item.url}`)
                          }
                        />
                      ),
                    )}
                  </ol>

                  <div className="chat-list-foot">
                    {hidden > 0 || expanded ? (
                      <button
                        className="chat-action"
                        type="button"
                        onClick={() => toggleTurn(turn.id)}
                      >
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
                    <p className="chat-note">{DISCLAIMER}</p>
                    <span className="chat-meta">
                      <time>{clock(turn.at)}</time>
                    </span>
                  </div>
                </>
              ) : answer ? (
                <div className="chat-msg is-in">
                  <p className="chat-greeting">{missingFor(seed)}</p>
                  <p>{NOT_FOUND}</p>
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
                  <span className="chat-meta">
                    <time>{clock(turn.at)}</time>
                  </span>
                </div>
              ) : null}
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
          سؤالك للدرر السنية
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
