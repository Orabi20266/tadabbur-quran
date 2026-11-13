import { CircleAlert } from 'lucide-react';
import { useApp, confidenceOf, highlightLevel, remainingToClear } from '../lib/store';
import { getSurah, arabicNumber, wordsOf } from '../lib/quran';
import { MistakesList } from './MistakesList';

interface WordHistoryPanelProps {
  wordKey: string;
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  /** Live session only: flag the word as recited with a wrong vowel. */
  onMarkHarakat?: () => void;
  harakatMarked?: boolean;
}

export function WordHistoryPanel({
  wordKey,
  onRemove,
  onRestore,
  onMarkHarakat,
  harakatMarked,
}: WordHistoryPanelProps) {
  const stat = useApp((s) => s.wordStats[wordKey]);
  const allMistakes = useApp((s) => s.mistakes);
  const [surah, ayah, index] = wordKey.split(':').map(Number);
  const word = wordsOf(surah, ayah)[index] ?? '';
  const ayahWords = wordsOf(surah, ayah);
  const mistakes = allMistakes.filter((m) => m.wordKey === wordKey).slice().reverse();
  const level = highlightLevel(stat);
  const remaining = remainingToClear(stat);
  const confidence = confidenceOf(stat);

  return (
    <div className="word-history">
      <div className="word-hero">
        <span className="word-hero-text" style={{ fontFamily: 'var(--font-quran)' }}>
          {word}
        </span>
        <span className="muted small">
          {getSurah(surah).name} · الآية {arabicNumber(ayah)}
        </span>
      </div>

      <p className="ayah-context" dir="rtl">
        {ayahWords.map((w, i) => (
          <span key={i} className={i === index ? 'ctx-word is-target' : 'ctx-word'}>
            {w}{' '}
          </span>
        ))}
      </p>

      {onMarkHarakat ? (
        <div className="harakat-action">
          <button
            className={`btn wide${harakatMarked ? ' btn-ghost' : ' btn-secondary'}`}
            onClick={onMarkHarakat}
            disabled={harakatMarked}
          >
            <CircleAlert size={16} aria-hidden />
            {harakatMarked ? 'الحركة مسجّلة على هذه الكلمة' : 'سجّل حركة خاطئة على هذه الكلمة'}
          </button>
          <small className="muted">
            {harakatMarked
              ? 'أعد تلاوة الكلمة بالحركة الصحيحة لتُزال من الأخطاء.'
              : 'استخدمها إذا قرأت الكلمة بحركة خاطئة. لا يتوقّف التتبّع.'}
          </small>
        </div>
      ) : null}

      <div className="stat-grid">
        <div className="stat">
          <strong>{arabicNumber(stat?.recited ?? 0)}</strong>
          <span>مرات التلاوة</span>
        </div>
        <div className="stat is-good">
          <strong>{arabicNumber(stat?.correct ?? 0)}</strong>
          <span>صحيحة</span>
        </div>
        <div className="stat is-bad">
          <strong>{arabicNumber(stat?.wrong ?? 0)}</strong>
          <span>خاطئة</span>
        </div>
        <div className="stat">
          <strong>{arabicNumber(confidence)}%</strong>
          <span>الثقة</span>
        </div>
      </div>

      <div className="confidence">
        <div className="confidence-track">
          <span style={{ width: `${confidence}%` }} />
        </div>
        {level === 'none' ? (
          !stat || stat.recited === 0 ? (
            <small className="muted">لم تُسجّل تلاوات لهذه الكلمة بعد.</small>
          ) : mistakes.length ? (
            <small className="muted">لا يوجد تظليل حالي على هذه الكلمة.</small>
          ) : (
            <small className="muted">تلاواتك لهذه الكلمة سليمة.</small>
          )
        ) : (
          <small className="muted">
            تحتاج {arabicNumber(remaining)} تلاوة صحيحة متتالية لإزالة التظليل (المستوى:{' '}
            {level === 'red'
              ? 'أحمر'
              : level === 'orange'
                ? 'برتقالي'
                : level === 'yellow'
                  ? 'أصفر'
                  : 'أخضر'}
            ).
          </small>
        )}
      </div>

      <h3 className="section-title">سجل هذه الكلمة</h3>
      <MistakesList mistakes={mistakes} onRemove={onRemove} onRestore={onRestore} />
    </div>
  );
}
