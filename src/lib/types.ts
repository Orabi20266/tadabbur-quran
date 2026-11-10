export type Theme = 'light' | 'dark' | 'system';

export type EventType = 'correct' | 'wrong' | 'tashkeel' | 'peek';
export type WordStatus = 'neutral' | EventType;
export type SpeechEngine = 'browser' | 'manual';

export interface Settings {
  theme: Theme;
  fontSize: number;
  detectMistakes: boolean;
  detectTashkeel: boolean;
  hideAyahMarkers: boolean;
  highlightHistory: boolean;
  errorRate: number;
  paceMs: number;
  goalAyahs: number;
  /** Which tracker to use for a live session. */
  speechEngine: SpeechEngine;
  /** The reader has seen the browser speech disclosure and chosen an engine. */
  speechConsent: boolean;
}

export interface Mistake {
  id: string;
  sessionId: string | null;
  surah: number;
  ayah: number;
  wordIndex: number;
  wordKey: string;
  type: Exclude<EventType, 'correct'>;
  correctText: string;
  recitedText?: string;
  confidence?: number;
  at: number;
  removed: boolean;
}

export interface Session {
  id: string;
  surah: number;
  fromAyah: number;
  toAyah: number;
  startedAt: number;
  endedAt: number;
  hidden: boolean;
  wordsRevealed: number;
  ayahsRevealed: number;
  mistakes: number;
}

export interface WordStat {
  recited: number;
  correct: number;
  wrong: number;
  streak: number;
  lastAt: number;
}

export interface DailyStat {
  ayahs: number;
  sessions: number;
  minutes: number;
}

export interface Streak {
  current: number;
  longest: number;
  lastDay: string | null;
  days: string[];
}

export interface AppState {
  schema: 1;
  onboarded: boolean;
  settings: Settings;
  sessions: Session[];
  mistakes: Mistake[];
  wordStats: Record<string, WordStat>;
  marks: Record<string, number[]>;
  daily: Record<string, DailyStat>;
  streak: Streak;
  lastRead: { surah: number; ayah: number };
}

export interface DetectorWord {
  key: string;
  surah: number;
  ayah: number;
  index: number;
}

export interface WordEvent extends DetectorWord {
  type: EventType;
  at: number;
}
