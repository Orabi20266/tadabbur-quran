import { useSyncExternalStore } from 'react';
import type {
  AppState,
  DailyStat,
  EventType,
  Mistake,
  Session,
  Settings,
  WordStat,
} from './types';

export const STORAGE_KEY = 'tadabbur.v1';

export const defaultSettings: Settings = {
  theme: 'system',
  fontSize: 30,
  detectMistakes: true,
  detectTashkeel: true,
  dontProgressUntilFixed: false,
  hideAyahMarkers: false,
  highlightHistory: true,
  showForHiddenWords: false,
  errorRate: 0.12,
  paceMs: 850,
  goalAyahs: 5,
  speechEngine: 'browser',
  speechConsent: false,
};

const defaultState: AppState = {
  schema: 1,
  onboarded: false,
  settings: defaultSettings,
  sessions: [],
  mistakes: [],
  wordStats: {},
  marks: {},
  daily: {},
  streak: { current: 0, longest: 0, lastDay: null, days: [] },
  lastRead: { surah: 67, ayah: 1 },
};

function load(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultState;
    const parsed = JSON.parse(raw) as Partial<AppState>;
    return {
      ...defaultState,
      ...parsed,
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      streak: { ...defaultState.streak, ...(parsed.streak ?? {}) },
      lastRead: { ...defaultState.lastRead, ...(parsed.lastRead ?? {}) },
    };
  } catch {
    return defaultState;
  }
}

let state: AppState = load();
const listeners = new Set<() => void>();

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    /* quota or private mode: keep the in-memory state */
  }
}

function emit() {
  listeners.forEach((fn) => fn());
}

export function getState(): AppState {
  return state;
}

export function setState(next: AppState) {
  state = next;
  persist();
  emit();
}

export function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useApp<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(
    subscribe,
    () => selector(state),
    () => selector(state),
  );
}

export function todayKey(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate(),
  ).padStart(2, '0')}`;
}

function dayOffset(key: string, offset: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return todayKey(new Date(y, m - 1, d + offset));
}

export function uid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export interface RecordEventArgs {
  sessionId: string | null;
  surah: number;
  ayah: number;
  wordIndex: number;
  wordKey: string;
  type: EventType;
  correctText: string;
  recitedText?: string;
  confidence?: number;
}

/** Record one detector event: update word stats and, for errors, store a mistake. */
export function recordEvent(args: RecordEventArgs): Mistake | null {
  const at = Date.now();
  const prev = state.wordStats[args.wordKey];
  const stat: WordStat = prev ?? { recited: 0, correct: 0, wrong: 0, streak: 0, lastAt: at };
  const isCorrect = args.type === 'correct';
  const nextStat: WordStat = {
    ...stat,
    recited: stat.recited + 1,
    correct: stat.correct + (isCorrect ? 1 : 0),
    wrong: stat.wrong + (isCorrect ? 0 : 1),
    streak: isCorrect ? stat.streak + 1 : 0,
    lastAt: at,
  };

  let mistake: Mistake | null = null;
  if (args.type !== 'correct') {
    mistake = {
      id: uid(),
      sessionId: args.sessionId,
      surah: args.surah,
      ayah: args.ayah,
      wordIndex: args.wordIndex,
      wordKey: args.wordKey,
      type: args.type,
      correctText: args.correctText,
      recitedText: args.recitedText,
      confidence: args.confidence,
      at,
      removed: false,
    };
  }

  let mistakes = state.mistakes;
  if (mistake) {
    mistakes = [...mistakes, mistake].slice(-5000);
  } else if (isCorrect && args.sessionId) {
    // Re-reciting a word correctly in the same session resolves its active
    // mistake. It stays in wordStats (and can be restored from word history).
    mistakes = mistakes.map((m) =>
      !m.removed && m.sessionId === args.sessionId && m.wordKey === args.wordKey
        ? { ...m, removed: true }
        : m,
    );
  }

  setState({
    ...state,
    wordStats: { ...state.wordStats, [args.wordKey]: nextStat },
    mistakes,
  });
  return mistake;
}

export function removeMistake(id: string) {
  const target = state.mistakes.find((m) => m.id === id);
  if (!target || target.removed) return;
  setState({
    ...state,
    mistakes: state.mistakes.map((m) =>
      m.id === id ? { ...m, removed: true } : m,
    ),
  });
}

export function restoreMistake(id: string) {
  setState({
    ...state,
    mistakes: state.mistakes.map((m) =>
      m.id === id ? { ...m, removed: false } : m,
    ),
  });
}

export interface EndSessionInput extends Omit<Session, 'id'> {
  id: string;
}

export function endSession(session: Session) {
  const day = todayKey();
  const prevDaily: DailyStat = state.daily[day] ?? { ayahs: 0, sessions: 0, minutes: 0 };
  const minutes = Math.max(1, Math.round((session.endedAt - session.startedAt) / 60000));
  const daily: DailyStat = {
    ayahs: prevDaily.ayahs + session.ayahsRevealed,
    sessions: prevDaily.sessions + 1,
    minutes: prevDaily.minutes + minutes,
  };

  const streak = { ...state.streak, days: [...state.streak.days] };
  if (streak.lastDay !== day) {
    streak.current =
      streak.lastDay === dayOffset(day, -1) ? streak.current + 1 : 1;
    streak.longest = Math.max(streak.longest, streak.current);
    streak.lastDay = day;
    if (!streak.days.includes(day)) streak.days = [...streak.days, day].slice(-400);
  }

  setState({
    ...state,
    sessions: [...state.sessions, session].slice(-500),
    daily: { ...state.daily, [day]: daily },
    streak,
    lastRead: { surah: session.surah, ayah: session.toAyah },
  });
}

export function toggleMark(surah: number, ayah: number) {
  const key = String(surah);
  const list = state.marks[key] ?? [];
  const next = list.includes(ayah)
    ? list.filter((a) => a !== ayah)
    : [...list, ayah].sort((a, b) => a - b);
  const marks = { ...state.marks };
  if (next.length) marks[key] = next;
  else delete marks[key];
  setState({ ...state, marks });
}

export function markRange(surah: number, from: number, to: number, mark: boolean) {
  const key = String(surah);
  const set = new Set(state.marks[key] ?? []);
  for (let a = from; a <= to; a++) {
    if (mark) set.add(a);
    else set.delete(a);
  }
  const next = [...set].sort((a, b) => a - b);
  const marks = { ...state.marks };
  if (next.length) marks[key] = next;
  else delete marks[key];
  setState({ ...state, marks });
}

export function updateSettings(patch: Partial<Settings>) {
  setState({ ...state, settings: { ...state.settings, ...patch } });
}

export function setOnboarded(onboarded: boolean) {
  setState({ ...state, onboarded });
}

export function setLastRead(surah: number, ayah: number) {
  setState({ ...state, lastRead: { surah, ayah } });
}

export function resetAll() {
  setState({ ...defaultState });
}

export function exportState(): string {
  return JSON.stringify(state, null, 2);
}

export function importState(json: string): boolean {
  try {
    const parsed = JSON.parse(json) as Partial<AppState>;
    if (!parsed || parsed.schema !== 1) return false;
    setState({
      ...defaultState,
      ...parsed,
      settings: { ...defaultSettings, ...(parsed.settings ?? {}) },
      streak: { ...defaultState.streak, ...(parsed.streak ?? {}) },
      lastRead: { ...defaultState.lastRead, ...(parsed.lastRead ?? {}) },
    });
    return true;
  } catch {
    return false;
  }
}

export type HighlightLevel = 'none' | 'green' | 'yellow' | 'orange' | 'red';

export function highlightLevel(stat?: WordStat): HighlightLevel {
  if (!stat || stat.wrong === 0) return 'none';
  if (stat.streak >= 3) return 'none';
  if (stat.wrong >= 4) return 'red';
  if (stat.wrong === 3) return 'orange';
  if (stat.wrong === 2) return 'yellow';
  return 'green';
}

export function confidenceOf(stat?: WordStat): number {
  if (!stat || stat.recited === 0) return 0;
  return Math.round((stat.correct / stat.recited) * 100);
}

export function remainingToClear(stat?: WordStat): number {
  if (!stat || highlightLevel(stat) === 'none') return 0;
  return Math.max(0, 3 - stat.streak);
}

export function memorizedCount(marks: Record<string, number[]>): number {
  return Object.values(marks).reduce((n, list) => n + list.length, 0);
}
