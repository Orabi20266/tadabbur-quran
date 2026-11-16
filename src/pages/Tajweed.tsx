import { useMemo, useState } from 'react';
import {
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  GraduationCap,
  RotateCcw,
  Sparkles,
  X,
} from 'lucide-react';
import { tajweedLessons } from '../data/tajweedLessons';
import type { Lesson, LessonQuestion } from '../lib/types';
import { arabicNumber } from '../lib/quran';

const STORAGE_KEY = 'tadabbur.tajweed.v1';

interface Stored {
  /** معرّفات الدروس التي أتمّ القارئ قراءتها. */
  read: number[];
  /** أفضل نتيجة في أسئلة كل درس. */
  best: Record<string, number>;
}

interface Quiz {
  lesson: Lesson;
  index: number;
  selected: number | null;
  score: number;
  finished: boolean;
}

function loadStored(): Stored {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { read: [], best: {} };
    const parsed = JSON.parse(raw) as Partial<Stored>;
    return {
      read: Array.isArray(parsed?.read) ? parsed.read : [],
      best: parsed?.best ?? {},
    };
  } catch {
    return { read: [], best: {} };
  }
}

function saveStored(next: Stored) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* التخزين قد يكون معطّلاً */
  }
}

function percentOf(score: number, total: number) {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

const optionLetters = ['أ', 'ب', 'ج', 'د'];

export function Tajweed() {
  const [stored, setStored] = useState<Stored>(loadStored);
  const [openId, setOpenId] = useState<number | null>(null);
  const [quiz, setQuiz] = useState<Quiz | null>(null);

  const lessons = useMemo(() => tajweedLessons, []);
  const lesson = openId === null ? null : lessons.find((item) => item.id === openId);
  const readCount = stored.read.filter((id) => lessons.some((item) => item.id === id)).length;
  const readPercent = percentOf(readCount, lessons.length);

  const markRead = (id: number) => {
    if (stored.read.includes(id)) return;
    const next = { ...stored, read: [...stored.read, id] };
    setStored(next);
    saveStored(next);
  };

  const unmarkRead = (id: number) => {
    const next = { ...stored, read: stored.read.filter((value) => value !== id) };
    setStored(next);
    saveStored(next);
  };

  const startQuiz = (target: Lesson) => {
    setQuiz({ lesson: target, index: 0, selected: null, score: 0, finished: false });
  };

  const answer = (choice: number) => {
    setQuiz((prev) => {
      if (!prev || prev.selected !== null) return prev;
      const current: LessonQuestion = prev.lesson.questions[prev.index];
      return {
        ...prev,
        selected: choice,
        score: prev.score + (choice === current.answer ? 1 : 0),
      };
    });
  };

  const nextQuestion = () => {
    if (!quiz) return;
    if (quiz.index + 1 < quiz.lesson.questions.length) {
      setQuiz({ ...quiz, index: quiz.index + 1, selected: null });
      return;
    }
    const percent = percentOf(quiz.score, quiz.lesson.questions.length);
    const key = String(quiz.lesson.id);
    if (percent > (stored.best[key] ?? 0)) {
      const next = { ...stored, best: { ...stored.best, [key]: percent } };
      setStored(next);
      saveStored(next);
    }
    setQuiz({ ...quiz, finished: true });
  };

  // ── نتيجة الأسئلة ─────────────────────────────────────────────
  if (quiz && quiz.finished) {
    const percent = percentOf(quiz.score, quiz.lesson.questions.length);
    return (
      <div className="stack">
        <header className="page-head">
          <div>
            <p className="eyebrow">{quiz.lesson.title}</p>
            <h1>انتهت الأسئلة</h1>
          </div>
          <span className="brand-mark" aria-label="تدبّر">
            تدبّر
          </span>
        </header>

        <section className="card result-card">
          <div className={`result-badge${percent >= 70 ? ' is-pass' : ''}`}>
            {percent >= 70 ? (
              <CheckCircle2 size={30} aria-hidden />
            ) : (
              <GraduationCap size={30} aria-hidden />
            )}
          </div>
          <strong className="result-score">{percent}%</strong>
          <p className="muted">
            أجبت عن {arabicNumber(quiz.score)} من{' '}
            {arabicNumber(quiz.lesson.questions.length)} إجابات صحيحة.
          </p>
          <div className="row center-row">
            <button className="btn btn-ghost" onClick={() => setQuiz(null)}>
              <ArrowRight size={17} aria-hidden /> رجوع للدرس
            </button>
            <button
              className="btn btn-primary"
              onClick={() => startQuiz(quiz.lesson)}
            >
              <RotateCcw size={17} aria-hidden /> إعادة الأسئلة
            </button>
          </div>
        </section>
      </div>
    );
  }

  // ── الأسئلة ───────────────────────────────────────────────────
  if (quiz) {
    const current = quiz.lesson.questions[quiz.index];
    const answered = quiz.selected !== null;
    return (
      <div className="stack">
        <header className="page-head">
          <button className="icon-btn" onClick={() => setQuiz(null)} aria-label="رجوع للدرس">
            <ArrowRight size={20} />
          </button>
          <div className="quiz-head-copy">
            <p className="eyebrow">
              {quiz.lesson.icon} {quiz.lesson.title}
            </p>
            <h1>
              السؤال {arabicNumber(quiz.index + 1)} من{' '}
              {arabicNumber(quiz.lesson.questions.length)}
            </h1>
          </div>
          <span className="quiz-score">{arabicNumber(quiz.score)} ✓</span>
        </header>

        <div className="quiz-progress" aria-hidden>
          <span
            style={{
              width: `${((quiz.index + (answered ? 1 : 0)) / quiz.lesson.questions.length) * 100}%`,
            }}
          />
        </div>

        <section className="card quiz-card">
          <h2 className="quiz-question">{current.q}</h2>
          <div className="quiz-options">
            {current.options.map((choice, index) => {
              const isCorrect = index === current.answer;
              const isPicked = index === quiz.selected;
              const state = !answered
                ? ''
                : isCorrect
                  ? ' is-correct'
                  : isPicked
                    ? ' is-wrong'
                    : ' is-dim';
              return (
                <button
                  key={index}
                  className={`quiz-option${state}`}
                  onClick={() => answer(index)}
                  disabled={answered}
                >
                  <span className="quiz-letter">{optionLetters[index] ?? index + 1}</span>
                  <span>{choice}</span>
                  {answered && isCorrect ? <Check size={18} aria-hidden /> : null}
                  {answered && isPicked && !isCorrect ? <X size={18} aria-hidden /> : null}
                </button>
              );
            })}
          </div>

          {answered ? (
            <div
              className={`quiz-feedback${quiz.selected === current.answer ? ' is-good' : ' is-bad'}`}
              role="status"
            >
              <strong>
                {quiz.selected === current.answer
                  ? 'إجابة صحيحة'
                  : `الإجابة الصحيحة: ${current.options[current.answer]}`}
              </strong>
              <p>{current.explanation}</p>
            </div>
          ) : null}

          <button className="btn btn-primary wide" onClick={nextQuestion} disabled={!answered}>
            {quiz.index + 1 >= quiz.lesson.questions.length ? 'عرض النتيجة' : 'السؤال التالي'}
          </button>
        </section>
      </div>
    );
  }

  // ── الدرس ────────────────────────────────────────────────────
  if (lesson) {
    const isRead = stored.read.includes(lesson.id);
    return (
      <div className="stack">
        <header className="page-head">
          <button
            className="icon-btn"
            onClick={() => setOpenId(null)}
            aria-label="رجوع للدروس"
          >
            <ArrowRight size={20} />
          </button>
          <div className="quiz-head-copy">
            <p className="eyebrow">{lesson.icon} الدرس</p>
            <h1>{lesson.title}</h1>
          </div>
          <span className="brand-mark" aria-label="تدبّر">
            تدبّر
          </span>
        </header>

        <p className="muted small lesson-lead">{lesson.desc}</p>

        {lesson.sections.map((section, index) => (
          <section key={section.heading} className="card lesson-section">
            <h2 className="lesson-heading">
              <span className="lesson-number" aria-hidden>
                {arabicNumber(index + 1)}
              </span>
              {section.heading}
            </h2>
            <p className="lesson-body">{section.body}</p>

            {section.bullets?.length ? (
              <ul className="lesson-bullets">
                {section.bullets.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            ) : null}

            {section.examples?.length ? (
              <div className="lesson-examples">
                {section.examples.map((example) => (
                  <figure key={example.text} className="lesson-example">
                    <span className="lesson-rule">{example.rule}</span>
                    <p className="lesson-example-text" dir="rtl" lang="ar">
                      {example.text}
                    </p>
                    {example.note ? (
                      <figcaption className="muted small">{example.note}</figcaption>
                    ) : null}
                  </figure>
                ))}
              </div>
            ) : null}
          </section>
        ))}

        <section className="card lesson-actions">
          <div className="lesson-actions-copy">
            <strong>
              {arabicNumber(lesson.questions.length)} أسئلة تأكيد على هذا الدرس
            </strong>
            <p className="muted small">
              الأسئلة للتثبيت لا للامتحان: تُصحَّح إجابتك فوراً مع التعليل.
            </p>
          </div>
          <div className="row center-row">
            <button className="btn btn-primary" onClick={() => startQuiz(lesson)}>
              <Sparkles size={17} aria-hidden /> اختبر نفسك
            </button>
            {isRead ? (
              <button className="btn btn-ghost" onClick={() => unmarkRead(lesson.id)}>
                <CheckCircle2 size={17} aria-hidden /> تمّت القراءة
              </button>
            ) : (
              <button className="btn btn-secondary" onClick={() => markRead(lesson.id)}>
                <Check size={17} aria-hidden /> علّم كمقروء
              </button>
            )}
          </div>
          {stored.best[String(lesson.id)] !== undefined ? (
            <p className="muted small">
              أفضل نتيجة سابقة: {arabicNumber(stored.best[String(lesson.id)] ?? 0)}%
            </p>
          ) : null}
        </section>
      </div>
    );
  }

  // ── قائمة الدروس ─────────────────────────────────────────────
  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">تعلّم · افهم · أتقن</p>
          <h1>أحكام التجويد</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card tajweed-intro">
        <span className="tajweed-intro-icon">
          <BookOpen size={26} aria-hidden />
        </span>
        <div className="tajweed-intro-copy">
          <strong>
            {arabicNumber(lessons.length)} دروس · شرح منسّق وأمثلة قرآنية
          </strong>
          <p className="muted small">
            كل درس يشرح الحكم بلغة مبسّطة، ويعرض أمثلة من المصحف، وينتهي بثلاثة
            أسئلة تأكيد. اضغط الدرس لقراءته.
          </p>
          <div className="lesson-progress" aria-hidden>
            <span style={{ width: `${readPercent}%` }} />
          </div>
          <p className="muted small">
            أتممت {arabicNumber(readCount)} من {arabicNumber(lessons.length)} دروس
          </p>
        </div>
      </section>

      <div className="tajweed-levels">
        {lessons.map((item, index) => {
          const isRead = stored.read.includes(item.id);
          const score = stored.best[String(item.id)];
          return (
            <button
              key={item.id}
              className={`card tajweed-level${isRead ? ' is-read' : ''}`}
              onClick={() => setOpenId(item.id)}
            >
              <span className="tajweed-level-icon" aria-hidden>
                {isRead ? <CheckCircle2 size={26} /> : item.icon}
              </span>
              <span className="tajweed-level-copy">
                <small className="muted">الدرس {arabicNumber(index + 1)}</small>
                <strong>{item.title}</strong>
                <span className="muted small">{item.desc}</span>
                <span className="tajweed-level-meta">
                  {arabicNumber(item.sections.length)} فقرات ·{' '}
                  {arabicNumber(item.questions.length)} أسئلة
                  {score !== undefined ? (
                    <span className={`quiz-best${score >= 70 ? ' is-pass' : ''}`}>
                      أفضل نتيجة {arabicNumber(score)}%
                    </span>
                  ) : null}
                </span>
              </span>
            </button>
          );
        })}
      </div>

      <p className="muted small">
        المنهج مستند إلى قسم التجويد في موقع surahquran.com/Tajweed، والصياغة
        والأمثلة كُتبت لهذا التطبيق.
      </p>
    </div>
  );
}
