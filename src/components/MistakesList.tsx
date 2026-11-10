import { Check, RotateCcw, Undo2 } from 'lucide-react';
import type { Mistake } from '../lib/types';
import { getSurah, arabicNumber, wordsOf } from '../lib/quran';

export const mistakeLabel: Record<Mistake['type'], string> = {
  wrong: 'خطأ في الكلمة',
  tashkeel: 'خطأ في التشكيل',
  peek: 'نظرة خاطفة',
};

export function mistakeWord(m: Mistake): string {
  return wordsOf(m.surah, m.ayah)[m.wordIndex] ?? m.correctText;
}

export function timeLabel(at: number): string {
  return new Intl.DateTimeFormat('ar-u-nu-arab', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(at));
}

interface MistakesListProps {
  mistakes: Mistake[];
  onRemove: (id: string) => void;
  onRestore: (id: string) => void;
  onOpenWord?: (m: Mistake) => void;
}

export function MistakesList({ mistakes, onRemove, onRestore, onOpenWord }: MistakesListProps) {
  const active = mistakes.filter((m) => !m.removed);
  const removed = mistakes.filter((m) => m.removed);

  if (!mistakes.length) {
    return (
      <div className="empty">
        <Check size={26} aria-hidden />
        <p>لا أخطاء في هذه الجلسة. تلاوة موفقة.</p>
      </div>
    );
  }

  const item = (m: Mistake) => (
    <li key={m.id} className={`mistake-item${m.removed ? ' is-removed' : ''}`}>
      <button
        type="button"
        className="mistake-main"
        onClick={() => onOpenWord?.(m)}
        aria-label={`${mistakeLabel[m.type]} في ${m.correctText}`}
      >
        <span className={`dot dot-${m.type}`} aria-hidden />
        <span className="mistake-text">
          <strong>{mistakeWord(m)}</strong>
          <small>
            {mistakeLabel[m.type]} · {getSurah(m.surah).name} {arabicNumber(m.ayah)} ·{' '}
            {timeLabel(m.at)}
          </small>
        </span>
      </button>
      {m.removed ? (
        <button
          type="button"
          className="icon-btn"
          onClick={() => onRestore(m.id)}
          aria-label="إرجاع الخطأ"
          title="إرجاع"
        >
          <Undo2 size={17} />
        </button>
      ) : (
        <button
          type="button"
          className="icon-btn"
          onClick={() => onRemove(m.id)}
          aria-label="إزالة الخطأ"
          title="إزالة (علم خاطئ)"
        >
          <RotateCcw size={17} />
        </button>
      )}
    </li>
  );

  return (
    <div className="mistakes-list">
      {active.length ? (
        <ul className="clean">{active.map(item)}</ul>
      ) : (
        <p className="muted small">كل الأخطاء أُزيلت من هذه القائمة.</p>
      )}
      {removed.length ? (
        <details className="removed-group">
          <summary>الأخطاء المُزالة ({removed.length})</summary>
          <ul className="clean">{removed.map(item)}</ul>
        </details>
      ) : null}
    </div>
  );
}
