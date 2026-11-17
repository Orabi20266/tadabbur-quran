import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  CheckCheck,
  ExternalLink,
  Loader2,
  RefreshCw,
  Send,
  Trash2,
} from 'lucide-react';
import { arabicNumber } from '../lib/quran';
import {
  askDorar,
  dorarQuery,
  dorarSearchUrl,
  DorarError,
} from '../lib/dorar';
import type { DorarAnswer, DorarHadith } from '../lib/dorar';
import {
  countLine,
  DISCLAIMER,
  missingFor,
  NOT_FOUND,
  openingFor,
  seedFor,
  weakFor,
  WELCOME,
} from '../lib/chatLines';

const STORAGE_KEY = 'tadabbur.ask.v1';
const MAX_STORED = 8;
const MAX_SHOWN = 8;

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
  'فضل قراءة القرآن',
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

function loadTurns(): Turn[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (!Array.isArray(parsed.turns)) return [];
    return parsed.turns
      .filter(
        (turn): turn is Turn =>
          Boolean(turn) &&
          typeof turn.id === 'string' &&
          typeof turn.question === 'string' &&
          (turn.status === 'ready' || turn.status === 'error'),
      )
      .map((turn) => ({
        ...turn,
        at: typeof turn.at === 'number' ? turn.at : Date.now(),
      }))
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
      .map((turn) => ({
        ...turn,
        answer: turn.answer
          ? { ...turn.answer, hadiths: turn.answer.hadiths.slice(0, MAX_SHOWN) }
          : undefined,
      }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ turns: slim }));
  } catch {
    /* التخزين قد يكون معطّلاً أو ممتلئاً */
  }
}

function newId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
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

function HadithBubble({
  hadith,
  index,
}: {
  hadith: DorarHadith;
  index: number;
}) {
  const meta = hadithMeta(hadith);
  return (
    <li className="chat-msg is-in chat-hadith">
      <div className="chat-hadith-head">
        <span className={`hadith-grade ${gradeTone(hadith.grade)}`}>
          {hadith.grade || 'حكم غير مذكور'}
        </span>
        <span className="chat-hadith-index" aria-hidden>
          {arabicNumber(index + 1)}
        </span>
      </div>
      <p className="hadith-text" dir="rtl">
        {hadith.text}
      </p>
      {meta ? <p className="chat-hadith-meta">{meta}</p> : null}
    </li>
  );
}

export function Ask() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState('');
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
  }, [turns]);

  const run = useCallback(async (id: string, question: string) => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 75000);
    try {
      const answer = await askDorar(question, controller.signal);
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
  }, []);

  return (
    <div className="chat">
      <header className="chat-head">
        <span className="chat-avatar" aria-hidden>
          <BookMarked size={20} />
        </span>
        <span className="chat-id">
          <strong>الدرر السنية</strong>
          <small>{busy ? 'يكتب…' : 'موسوعة الحديث · متصل'}</small>
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
          الرسائل تُنقل من موسوعة الدرر السنية، والحكم بنصّه لا استنتاجاً.
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
              ) : turn.answer ? (
                turn.answer.hadiths.length ? (
                  <>
                    <div className="chat-msg is-in">
                      <p className="chat-greeting">{openingFor(seed)}</p>
                      <p>
                        {countLine(
                          turn.answer.query,
                          turn.answer.total ?? turn.answer.hadiths.length,
                        )}
                      </p>
                      {turn.answer.hadiths.every(
                        (hadith) => hadith.rank === 0,
                      ) ? (
                        <p className="chat-warning">{weakFor(seed)}</p>
                      ) : null}
                      <span className="chat-meta">
                        <time>{clock(turn.at)}</time>
                      </span>
                    </div>

                    <ol className="chat-results">
                      {turn.answer.hadiths
                        .slice(0, MAX_SHOWN)
                        .map((hadith, index) => (
                          <HadithBubble
                            key={`${turn.id}-${index}`}
                            hadith={hadith}
                            index={index}
                          />
                        ))}
                    </ol>

                    <div className="chat-msg is-in is-foot">
                      <p className="chat-note">{DISCLAIMER}</p>
                      <div className="chat-foot-actions">
                        <a
                          className="chat-action"
                          href={turn.answer.moreUrl}
                          target="_blank"
                          rel="noreferrer"
                        >
                          <ExternalLink size={14} aria-hidden />
                          كل النتائج في الدرر
                        </a>
                        {(turn.answer.total ?? turn.answer.hadiths.length) >
                        MAX_SHOWN ? (
                          <span className="chat-shown">
                            عُرض {arabicNumber(MAX_SHOWN)} من{' '}
                            {arabicNumber(
                              turn.answer.total ?? turn.answer.hadiths.length,
                            )}
                          </span>
                        ) : null}
                      </div>
                      <span className="chat-meta">
                        <time>{clock(turn.at)}</time>
                      </span>
                    </div>
                  </>
                ) : (
                  <div className="chat-msg is-in">
                    <p className="chat-greeting">{missingFor(seed)}</p>
                    <p>{NOT_FOUND}</p>
                    <div className="chat-foot-actions">
                      <a
                        className="chat-action"
                        href={turn.answer.moreUrl}
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
                )
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
