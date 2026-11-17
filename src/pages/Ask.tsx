import { useCallback, useEffect, useRef, useState } from 'react';
import {
  BookMarked,
  ExternalLink,
  Loader2,
  MessageCircle,
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

const STORAGE_KEY = 'tadabbur.ask.v1';
const MAX_STORED = 8;
const MAX_SHOWN = 8;

type TurnStatus = 'pending' | 'ready' | 'error';

interface Turn {
  id: string;
  question: string;
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

function gradeTone(grade: string): string {
  if (/صحيح/.test(grade) && !/ضعيف|لا يصح/.test(grade)) return 'is-sahih';
  if (/حسن/.test(grade) && !/ضعيف|لا يصح/.test(grade)) return 'is-hasan';
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

function leadText(answer: DorarAnswer): string {
  // Stored conversations keep only the first few hadiths, so the total the
  // worker reported is what the reader should see.
  const count = answer.total ?? answer.hadiths.length;
  if (count === 0) {
    return 'لم أجد حديثاً مطابقاً في الدرر السنية. جرّب صياغة أقصر أو كلمة أخرى، أو افتح البحث الكامل.';
  }
  if (answer.hadiths.every((hadith) => hadith.rank === 0)) {
    return `وجدت ${arabicNumber(count)} نتيجة، لكن خلاصة حكم المحدّثين عليها ضعيفة الإسناد. لا يصح الاعتماد عليها، راجع النتائج الكاملة والحكم بنصّه.`;
  }
  return `وجدت ${arabicNumber(count)} نتيجة في موسوعة الدرر السنية، مرتّبة بحسب درجة الحديث. الحكم المذكور هو نصّ الدرر، وليس فتوى.`;
}

function HadithCard({ hadith, index }: { hadith: DorarHadith; index: number }) {
  const meta: [string, string][] = [
    ['الراوي', hadith.narrator],
    ['المحدث', hadith.scholar],
    ['المصدر', hadith.source],
    ['الرقم', hadith.reference],
  ].filter(([, value]) => Boolean(value)) as [string, string][];

  return (
    <li className="ask-hadith">
      <div className="ask-hadith-head">
        <span className={`hadith-grade ${gradeTone(hadith.grade)}`}>
          {hadith.grade || 'حكم غير مذكور'}
        </span>
        <span className="ask-hadith-index" aria-hidden>
          {arabicNumber(index + 1)}
        </span>
      </div>
      <p className="hadith-text" dir="rtl">
        {hadith.text}
      </p>
      {meta.length ? (
        <dl className="ask-meta">
          {meta.map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
    </li>
  );
}

export function Ask() {
  const [turns, setTurns] = useState<Turn[]>(loadTurns);
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement | null>(null);
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

  useEffect(() => {
    if (!turns.length) return;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
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
        [...prev, { id, question, status: 'pending' as const }].slice(
          -MAX_STORED,
        ),
      );
      void run(id, question);
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
    <div className="stack ask-page">
      <header className="page-head">
        <div>
          <p className="eyebrow">من موسوعة الدرر السنية</p>
          <h1>اسأل الدرر</h1>
        </div>
        {turns.length ? (
          <button className="btn btn-ghost btn-sm" onClick={clear}>
            <Trash2 size={15} aria-hidden />
            مسح المحادثة
          </button>
        ) : (
          <span className="brand-mark" aria-label="تدبّر">
            تدبّر
          </span>
        )}
      </header>

      <section className="card ask-intro">
        <span className="ask-intro-icon">
          <BookMarked size={24} aria-hidden />
        </span>
        <div>
          <strong>اسأل عن حديث أو حكم، والجواب من الدرر</strong>
          <p className="muted small">
            يبحث التطبيق في موسوعة الدرر السنية ويعرض لك نصّ الحديث والراوي
            والمحدّث والمصدر وخلاصة الحكم كما ذكرها الموقع. الإجابات منقولة لا
            مُستنتجة، وليست فتوى شخصية.
          </p>
        </div>
      </section>

      <form
        className="ask-composer"
        onSubmit={(event) => {
          event.preventDefault();
          ask(input);
        }}
      >
        <label className="sr-only" htmlFor="ask-input">
          سؤالك للدرر السنية
        </label>
        <MessageCircle size={19} aria-hidden className="ask-composer-icon" />
        <input
          id="ask-input"
          type="text"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="مثال: ما حكم الغيبة؟"
          autoComplete="off"
          enterKeyHint="send"
          maxLength={300}
        />
        <button
          className="ask-send"
          type="submit"
          disabled={busy || input.trim().length < 2}
          aria-label="أرسل السؤال"
        >
          {busy ? (
            <Loader2 size={18} className="spin" aria-hidden />
          ) : (
            <Send size={18} aria-hidden />
          )}
        </button>
      </form>

      {turns.length === 0 ? (
        <section className="ask-empty" aria-label="أسئلة مقترحة">
          <p className="muted small">جرّب أحد هذه الأسئلة:</p>
          <div className="ask-suggestions">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                className="ask-suggestion"
                onClick={() => ask(suggestion)}
              >
                {suggestion}
              </button>
            ))}
          </div>
          <p className="muted small center ask-empty-hint">
            يُخزّن آخر {arabicNumber(MAX_STORED)} أسئلة على جهازك فقط. لا
            يُرسل السؤال إلى أي جهة غير خدمة البحث في الدرر.
          </p>
        </section>
      ) : (
        <div className="ask-thread">
          {turns.map((turn) => (
            <article className="ask-turn" key={turn.id}>
              <p className="ask-question">{turn.question}</p>

              {turn.status === 'pending' ? (
                <div className="ask-pending" aria-live="polite">
                  <Loader2 size={18} className="spin" aria-hidden />
                  <span>أبحث في الدرر السنية…</span>
                </div>
              ) : turn.status === 'error' ? (
                <div className="card ask-error" role="alert">
                  <p>{errorMessage(turn.error)}</p>
                  <div className="ask-error-actions">
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => retry(turn)}
                      disabled={busy}
                    >
                      <RefreshCw size={14} aria-hidden />
                      أعد المحاولة
                    </button>
                    <a
                      className="btn btn-ghost btn-sm"
                      href={dorarSearchUrl(dorarQuery(turn.question))}
                      target="_blank"
                      rel="noreferrer"
                    >
                      افتح الدرر
                      <ExternalLink size={13} aria-hidden />
                    </a>
                  </div>
                </div>
              ) : turn.answer ? (
                <div className="ask-answer">
                  <p className="ask-answer-lead">{leadText(turn.answer)}</p>

                  {turn.answer.hadiths.length ? (
                    <ol className="ask-results">
                      {turn.answer.hadiths
                        .slice(0, MAX_SHOWN)
                        .map((hadith, index) => (
                          <HadithCard
                            key={`${turn.id}-${index}`}
                            hadith={hadith}
                            index={index}
                          />
                        ))}
                    </ol>
                  ) : null}

                  <div className="ask-answer-actions">
                    <a
                      className="btn btn-secondary btn-sm"
                      href={turn.answer.moreUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      <ExternalLink size={14} aria-hidden />
                      كل النتائج في الدرر
                    </a>
                    {(turn.answer.total ?? turn.answer.hadiths.length) >
                    MAX_SHOWN ? (
                      <span className="muted small">
                        عُرض {arabicNumber(MAX_SHOWN)} من{' '}
                        {arabicNumber(
                          turn.answer.total ?? turn.answer.hadiths.length,
                        )}
                      </span>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </article>
          ))}
          <div ref={bottomRef} />
        </div>
      )}

      <p className="muted small center">
        المصدر: موسوعة الدرر السنية · الأحكام تُنقل بنصّها من الموقع، ويُرجع في
        النوازل إلى أهل العلم.
      </p>
    </div>
  );
}
