import { useMemo, useState } from 'react';
import {
  ArrowRight,
  Check,
  GraduationCap,
  RotateCcw,
  Star,
  Trophy,
  X,
} from 'lucide-react';
import { tajweedLevels } from '../data/tajweed';
import type { TajweedLevel, TajweedQuestion } from '../data/tajweed';
import { arabicNumber } from '../lib/quran';

const STORAGE_KEY = 'tadabbur.tajweed.v1';
const ROUND_SIZE = 5;

interface PreparedQuestion extends TajweedQuestion {
  /** Shuffled options with the correct answer re-indexed. */
  choices: string[];
  correct: number;
}

interface Round {
  level: TajweedLevel;
  questions: PreparedQuestion[];
  index: number;
  selected: number | null;
  score: number;
  finished: boolean;
}

interface Stored {
  best: Record<string, number>;
}

function shuffle<T>(list: T[]): T[] {
  const out = [...list];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function prepare(question: TajweedQuestion): PreparedQuestion {
  const correctText = question.options[question.answer];
  const choices = shuffle(question.options);
  return { ...question, choices, correct: choices.indexOf(correctText) };
}

function loadBest(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Stored;
    return parsed?.best ?? {};
  } catch {
    return {};
  }
}

function saveBest(best: Record<string, number>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ best }));
  } catch {
    /* التخزين قد يكون معطّلاً */
  }
}

function percentOf(score: number, total: number) {
  return total > 0 ? Math.round((score / total) * 100) : 0;
}

const optionLetters = ['أ', 'ب', 'ج', 'د'];

export function Tajweed() {
  const [best, setBest] = useState<Record<string, number>>(loadBest);
  const [round, setRound] = useState<Round | null>(null);

  const levels = useMemo(() => tajweedLevels, []);

  const startLevel = (level: TajweedLevel) => {
    const picked = shuffle(level.questions).slice(0, ROUND_SIZE);
    setRound({
      level,
      questions: picked.map(prepare),
      index: 0,
      selected: null,
      score: 0,
      finished: false,
    });
  };

  const answer = (choice: number) => {
    setRound((prev) => {
      if (!prev || prev.selected !== null) return prev;
      const current = prev.questions[prev.index];
      return {
        ...prev,
        selected: choice,
        score: prev.score + (choice === current.correct ? 1 : 0),
      };
    });
  };

  const next = () => {
    if (!round) return;
    if (round.index + 1 < round.questions.length) {
      setRound({ ...round, index: round.index + 1, selected: null });
      return;
    }
    const percent = percentOf(round.score, round.questions.length);
    setRound({ ...round, finished: true });
    const key = String(round.level.id);
    if (percent > (best[key] ?? 0)) {
      const updated = { ...best, [key]: percent };
      setBest(updated);
      saveBest(updated);
    }
  };

  const closeRound = () => setRound(null);

  if (round && round.finished) {
    const percent = percentOf(round.score, round.questions.length);
    const stars = percent >= 90 ? 3 : percent >= 75 ? 2 : percent >= 50 ? 1 : 0;
    return (
      <div className="stack">
        <header className="page-head">
          <div>
            <p className="eyebrow">{round.level.title}</p>
            <h1>نتيجة الجولة</h1>
          </div>
          <span className="brand-mark" aria-label="تدبّر">
            تدبّر
          </span>
        </header>

        <section className="card result-card">
          <div className={`result-badge${percent >= 70 ? ' is-pass' : ''}`}>
            {percent >= 70 ? <Trophy size={30} aria-hidden /> : <Star size={30} aria-hidden />}
          </div>
          <strong className="result-score">{percent}%</strong>
          <p className="muted">
            أجبت عن {arabicNumber(round.score)} من {arabicNumber(round.questions.length)}{' '}
            أسئلة بشكل صحيح.
          </p>
          <div className="result-stars" aria-hidden>
            {[0, 1, 2].map((i) => (
              <Star key={i} size={22} className={i < stars ? 'on' : ''} />
            ))}
          </div>
          <div className="row center-row">
            <button className="btn btn-ghost" onClick={closeRound}>
              <ArrowRight size={17} aria-hidden /> كل المراحل
            </button>
            <button className="btn btn-primary" onClick={() => startLevel(round.level)}>
              <RotateCcw size={17} aria-hidden /> جولة أخرى
            </button>
          </div>
        </section>
      </div>
    );
  }

  if (round) {
    const current = round.questions[round.index];
    const selected = round.selected;
    const answered = selected !== null;

    return (
      <div className="stack">
        <header className="page-head">
          <button className="icon-btn" onClick={closeRound} aria-label="العودة للمراحل">
            <ArrowRight size={20} />
          </button>
          <div className="quiz-head-copy">
            <p className="eyebrow">{round.level.icon} {round.level.title}</p>
            <h1>
              السؤال {arabicNumber(round.index + 1)} من {arabicNumber(round.questions.length)}
            </h1>
          </div>
          <span className="quiz-score">{arabicNumber(round.score)} ✓</span>
        </header>

        <div className="quiz-progress" aria-hidden>
          <span
            style={{
              width: `${((round.index + (answered ? 1 : 0)) / round.questions.length) * 100}%`,
            }}
          />
        </div>

        <section className="card quiz-card">
          <h2 className="quiz-question">{current.q}</h2>
          <div className="quiz-options">
            {current.choices.map((choice, index) => {
              const isCorrect = index === current.correct;
              const isPicked = index === selected;
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
              className={`quiz-feedback${selected === current.correct ? ' is-good' : ' is-bad'}`}
              role="status"
            >
              <strong>
                {selected === current.correct ? 'إجابة صحيحة' : 'الإجابة الصحيحة:'}{' '}
                {selected === current.correct ? null : current.choices[current.correct]}
              </strong>
              <p>{current.explanation}</p>
            </div>
          ) : null}

          <button className="btn btn-primary wide" onClick={next} disabled={!answered}>
            {round.index + 1 >= round.questions.length ? 'عرض النتيجة' : 'السؤال التالي'}
          </button>
        </section>
      </div>
    );
  }

  return (
    <div className="stack">
      <header className="page-head">
        <div>
          <p className="eyebrow">تعلّم · اختبر · أتقن</p>
          <h1>أحكام التجويد</h1>
        </div>
        <span className="brand-mark" aria-label="تدبّر">
          تدبّر
        </span>
      </header>

      <section className="card tajweed-intro">
        <span className="tajweed-intro-icon">
          <GraduationCap size={26} aria-hidden />
        </span>
        <div>
          <strong>{arabicNumber(tajweedLevels.length)} مراحل · أسئلة اختيار من متعدد</strong>
          <p className="muted small">
            أسئلة مستوحاة من لعبة أحكام التجويد، مع شرح الإجابة الصحيحة. كل جولة
            خمسة أسئلة، وتُخلط الخيارات في كل مرة.
          </p>
        </div>
      </section>

      <div className="tajweed-levels">
        {levels.map((level, index) => {
          const score = best[String(level.id)];
          return (
            <button
              key={level.id}
              className="card tajweed-level"
              onClick={() => startLevel(level)}
            >
              <span className="tajweed-level-icon" aria-hidden>
                {level.icon}
              </span>
              <span className="tajweed-level-copy">
                <small className="muted">المرحلة {arabicNumber(index + 1)}</small>
                <strong>{level.title}</strong>
                <span className="muted small">{level.desc}</span>
                <span className="tajweed-level-meta">
                  {arabicNumber(level.questions.length)} سؤالاً
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
    </div>
  );
}
