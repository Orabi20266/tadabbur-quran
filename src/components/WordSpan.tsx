import type { WordStatus } from '../lib/types';
import type { HighlightLevel as Level } from '../lib/store';

export interface WordSpanProps {
  text: string;
  status: WordStatus;
  hidden: boolean;
  history: Level;
  interactive?: boolean;
  active?: boolean;
  /** The word the reader is expected to recite next. */
  current?: boolean;
  onOpen?: () => void;
}

export function WordSpan({
  text,
  status,
  hidden,
  history,
  interactive,
  active,
  current,
  onOpen,
}: WordSpanProps) {
  const canOpen = Boolean(interactive && !hidden);
  const classes = ['word'];
  if (status !== 'neutral') classes.push(`is-${status}`);
  if (hidden) classes.push('is-hidden');
  if (history !== 'none') classes.push(`history-${history}`);
  if (canOpen) classes.push('is-interactive');
  if (active) classes.push('is-active');
  if (current) classes.push('is-current');

  return (
    <span
      className={classes.join(' ')}
      role={canOpen ? 'button' : undefined}
      tabIndex={canOpen ? 0 : undefined}
      aria-label={
        hidden ? 'كلمة مخفية' : canOpen ? `كلمة ${text}، اعرض سجلها` : undefined
      }
      aria-hidden={hidden || undefined}
      onClick={canOpen ? onOpen : undefined}
      onKeyDown={
        canOpen
          ? (e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                onOpen?.();
              }
            }
          : undefined
      }
    >
      {text}
    </span>
  );
}
