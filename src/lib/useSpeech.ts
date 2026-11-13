import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { splitTranscript } from './align';

export type SpeechStatus =
  | 'idle'
  | 'starting'
  | 'listening'
  | 'denied'
  | 'unsupported'
  | 'error';

export interface Speech {
  status: SpeechStatus;
  statusRef: MutableRefObject<SpeechStatus>;
  /** Latest transcript, useful as "heard" feedback in the reader. */
  heard: string;
  supported: boolean;
  start: () => void;
  stop: () => void;
}

interface Recognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onstart: (() => void) | null;
  onresult: ((event: SpeechResultEvent) => void) | null;
  onerror: ((event: SpeechErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

interface SpeechAlternative {
  transcript: string;
  confidence?: number;
}

interface SpeechResult {
  0: SpeechAlternative;
  isFinal: boolean;
  length: number;
}

interface SpeechResultEvent {
  results: { length: number; [index: number]: SpeechResult };
  resultIndex: number;
}

interface SpeechErrorEvent {
  error: string;
  message?: string;
}

type RecognizerCtor = new () => Recognizer;

/** Bare joining particles the recogniser sometimes splits off a word. */
const JOINING_PARTICLE = new Set(['\u0648', '\u0641', '\u0628', '\u0644', '\u0643']);

/** Join a split «و الله» back into «والله» before the tracker sees it. */
export function mergeSplitParticles(tokens: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (JOINING_PARTICLE.has(token) && i + 1 < tokens.length) {
      out.push(token + tokens[i + 1]);
      i += 1;
    } else {
      out.push(token);
    }
  }
  return out;
}

function recognizerCtor(): RecognizerCtor | null {
  if (typeof window === 'undefined') return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognizerCtor;
    webkitSpeechRecognition?: RecognizerCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/**
 * Browser speech recognition with automatic restart.
 *
 * The browser engine may be cloud-backed; the reader gets an explicit choice
 * before a live session. When it is missing or denied, the caller falls back to
 * manual word-by-word tracking. No fake levels or fake transcripts are ever
 * produced here.
 */
export function useSpeech(
  onTokens: (tokens: string[]) => void,
  lang = 'ar-SA',
): Speech {
  const supported = recognizerCtor() !== null;
  const [status, setStatus] = useState<SpeechStatus>(
    supported ? 'idle' : 'unsupported',
  );
  const [heard, setHeard] = useState('');
  const statusRef = useRef<SpeechStatus>(supported ? 'idle' : 'unsupported');
  const heardRef = useRef('');
  const activeRef = useRef(false);
  /** Bumped on every start/stop so handlers from an old recogniser are ignored. */
  const generationRef = useRef(0);
  const recRef = useRef<Recognizer | null>(null);
  const restartTimer = useRef<number | null>(null);
  const failuresRef = useRef(0);
  const consumedRef = useRef(0);
  const onTokensRef = useRef(onTokens);
  onTokensRef.current = onTokens;

  const updateStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearRestart = useCallback(() => {
    if (restartTimer.current) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  }, []);

  const begin = useCallback(() => {
    const Ctor = recognizerCtor();
    if (!Ctor || !activeRef.current) return;

    const generation = generationRef.current + 1;
    generationRef.current = generation;
    // Every recogniser session starts a fresh results list.
    consumedRef.current = 0;
    const rec = new Ctor();
    recRef.current = rec;
    rec.lang = lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      if (!activeRef.current || generationRef.current !== generation) return;
      updateStatus('listening');
    };

    rec.onresult = (event) => {
      if (generationRef.current !== generation) return;
      failuresRef.current = 0;
      const parts: string[] = [];
      let hasInterim = false;
      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        const transcript = result[0]?.transcript ?? '';
        if (transcript) parts.push(transcript);
        if (!result.isFinal) hasInterim = true;
      }

      const transcript = parts.join(' ').trim();
      if (transcript && transcript !== heardRef.current) {
        heardRef.current = transcript;
        setHeard(transcript);
      }

      const tokens = splitTranscript(transcript);
      // Never replay tokens from an older/shorter results list: replaying would
      // move the cursor over words the reader has not repeated. If the engine
      // revises a transcript down, move the mark down with it instead of
      // blocking every later token.
      if (tokens.length < consumedRef.current) {
        consumedRef.current = tokens.length;
        return;
      }
      const consumed = consumedRef.current;
      // The last interim token may still change; wait for more context/final.
      const stable = hasInterim ? Math.max(0, tokens.length - 1) : tokens.length;
      // A bare «و» at the end may be the first half of «والله»; hold it until
      // the next token arrives instead of feeding it as a one-letter word.
      let end = stable;
      while (end > consumed && JOINING_PARTICLE.has(tokens[end - 1])) end -= 1;
      if (end > consumed) {
        const fresh = mergeSplitParticles(tokens.slice(consumed, end));
        consumedRef.current = end;
        if (fresh.length) onTokensRef.current(fresh);
      }
    };

    rec.onerror = (event) => {
      if (generationRef.current !== generation) return;
      const error = event.error;
      if (error === 'no-speech' || error === 'aborted') return;

      if (error === 'not-allowed' || error === 'service-not-allowed') {
        activeRef.current = false;
        updateStatus('denied');
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        return;
      }

      if (error === 'audio-capture' || error === 'language-not-supported') {
        activeRef.current = false;
        updateStatus('unsupported');
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
        return;
      }

      // Network and similar errors: retry a couple of times before giving up.
      failuresRef.current += 1;
      if (failuresRef.current >= 3) {
        activeRef.current = false;
        updateStatus('error');
        try {
          rec.abort();
        } catch {
          /* already stopped */
        }
      }
    };

    rec.onend = () => {
      if (generationRef.current !== generation) return;
      recRef.current = null;
      if (!activeRef.current) return;
      clearRestart();
      restartTimer.current = window.setTimeout(() => {
        restartTimer.current = null;
        if (activeRef.current) begin();
      }, 350);
    };

    try {
      updateStatus('starting');
      rec.start();
    } catch {
      if (generationRef.current !== generation) return;
      failuresRef.current += 1;
      if (failuresRef.current >= 3) {
        activeRef.current = false;
        updateStatus('error');
      } else if (activeRef.current) {
        clearRestart();
        restartTimer.current = window.setTimeout(() => {
          restartTimer.current = null;
          if (activeRef.current) begin();
        }, 350);
      }
    }
  }, [clearRestart, lang, updateStatus]);

  const start = useCallback(() => {
    if (!recognizerCtor()) {
      updateStatus('unsupported');
      return;
    }
    if (activeRef.current) return;
    activeRef.current = true;
    failuresRef.current = 0;
    consumedRef.current = 0;
    heardRef.current = '';
    setHeard('');
    updateStatus('starting');
    begin();
  }, [begin, updateStatus]);

  const stop = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    clearRestart();
    const rec = recRef.current;
    recRef.current = null;
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
    consumedRef.current = 0;
    heardRef.current = '';
    setHeard('');
    updateStatus('idle');
  }, [clearRestart, updateStatus]);

  useEffect(() => stop, [stop]);

  return { status, statusRef, heard, supported, start, stop };
}
