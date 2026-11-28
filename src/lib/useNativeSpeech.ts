import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { nextTokens } from './useSpeech';
import type { Speech, SpeechStatus } from './useSpeech';

type Listener = { remove: () => Promise<void> };

const MAX_FAILURES = 3;
/** Android sends `stopped` before the final transcript; give it a moment. */
const FINAL_GRACE_MS = 300;

/**
 * Capacitor wrapper around the platform speech recogniser.
 *
 * Each engine session owns a generation, a transcript and a token cursor.
 * Events from an older session are ignored, so a late Android final result can
 * never replay words the reader has already recited. No transcript is ever
 * invented: when the locale or permission is unavailable, the caller keeps its
 * manual word-by-word fallback.
 */
export function useNativeSpeech(
  onTokens: (tokens: string[]) => void,
  lang = 'ar-SA',
): Speech {
  const enabled = Capacitor.isNativePlatform();
  const [status, setStatus] = useState<SpeechStatus>(
    enabled ? 'idle' : 'unsupported',
  );
  const [heard, setHeard] = useState('');
  const statusRef = useRef<SpeechStatus>(enabled ? 'idle' : 'unsupported');
  const heardRef = useRef('');
  const activeRef = useRef(false);
  /** Bumped for every recogniser session, including restarts. */
  const generationRef = useRef(0);
  const consumedRef = useRef(0);
  const failuresRef = useRef(0);
  const listenersRef = useRef<Listener[]>([]);
  const restartTimer = useRef<number | null>(null);
  const onTokensRef = useRef(onTokens);
  onTokensRef.current = onTokens;
  // Restarts call the current callback without making `begin` self-referential.
  const beginRef = useRef<() => Promise<void>>(async () => {});

  const updateStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const clearRestart = useCallback(() => {
    if (restartTimer.current !== null) {
      window.clearTimeout(restartTimer.current);
      restartTimer.current = null;
    }
  }, []);

  const dropListeners = useCallback(async () => {
    const listeners = listenersRef.current;
    listenersRef.current = [];
    await Promise.all(
      listeners.map((listener) =>
        listener.remove().catch(() => {
          /* listener already gone */
        }),
      ),
    );
  }, []);

  /** Commit the held final word of one session, if that session is still current. */
  const flushFinal = useCallback((generation?: number) => {
    if (generation !== undefined && generationRef.current !== generation) return;
    if (!heardRef.current) return;
    const step = nextTokens(heardRef.current, false, consumedRef.current);
    if (!step) return;
    consumedRef.current = step.end;
    if (step.tokens.length) onTokensRef.current(step.tokens);
  }, []);

  /**
   * Find a locale the device can actually recognise. `ar-SA` is preferred but
   * a plain `ar` or another Arabic locale is better than a silent session.
   */
  const chooseLanguage = useCallback(async (): Promise<string | null> => {
    try {
      const { languages } = await SpeechRecognition.getSupportedLanguages();
      const list = Array.isArray(languages) ? languages.map(String) : [];
      if (list.length) {
        const exact = [lang, 'ar', 'ar-EG', 'ar-SA'].find((candidate) =>
          list.includes(candidate),
        );
        if (exact) return exact;
        const arabic = list.find((value) => /^ar([-_]|$)/i.test(value));
        return arabic ?? null;
      }
    } catch {
      /* Older Android versions do not expose the language list. */
    }
    try {
      const { available } = await SpeechRecognition.available();
      return available ? lang : null;
    } catch {
      // Let start() report the real platform error instead of guessing.
      return lang;
    }
  }, [lang]);

  const begin = useCallback(async () => {
    if (!enabled || !activeRef.current) return;
    const generation = ++generationRef.current;

    try {
      const effectiveLang = await chooseLanguage();
      if (!activeRef.current || generationRef.current !== generation) return;
      if (!effectiveLang) {
        activeRef.current = false;
        updateStatus('unsupported');
        return;
      }

      let permission = await SpeechRecognition.checkPermissions();
      if (permission.speechRecognition !== 'granted') {
        permission = await SpeechRecognition.requestPermissions();
      }
      if (!activeRef.current || generationRef.current !== generation) return;
      if (permission.speechRecognition !== 'granted') {
        activeRef.current = false;
        updateStatus('denied');
        return;
      }

      await dropListeners();
      if (!activeRef.current || generationRef.current !== generation) return;
      // A fresh results list starts at zero; stale heard text must not be
      // replayed into the new session.
      consumedRef.current = 0;
      heardRef.current = '';
      setHeard('');

      const partial = await SpeechRecognition.addListener(
        'partialResults',
        (data: { matches?: string[] }) => {
          if (!activeRef.current || generationRef.current !== generation) return;
          const transcript = (data.matches?.[0] ?? '').trim();
          if (!transcript) return;
          failuresRef.current = 0;
          if (transcript !== heardRef.current) {
            heardRef.current = transcript;
            setHeard(transcript);
          }
          // Partial results are revised as the reader speaks, so the last
          // token is held exactly as in the browser path.
          const step = nextTokens(transcript, true, consumedRef.current);
          if (!step) return;
          consumedRef.current = step.end;
          if (step.tokens.length) onTokensRef.current(step.tokens);
        },
      );
      listenersRef.current.push(partial);

      const state = await SpeechRecognition.addListener(
        'listeningState',
        (data: { status: 'started' | 'stopped' }) => {
          if (!activeRef.current || generationRef.current !== generation) return;
          if (data.status === 'stopped') {
            // The engine ends on silence. A late final result on Android may
            // still arrive, so flush after a short grace period, then restart.
            clearRestart();
            restartTimer.current = window.setTimeout(() => {
              restartTimer.current = null;
              flushFinal(generation);
              if (activeRef.current) void beginRef.current();
            }, FINAL_GRACE_MS);
          }
        },
      );
      listenersRef.current.push(state);

      updateStatus('starting');
      await SpeechRecognition.start({
        language: effectiveLang,
        partialResults: true,
        // Android ignores partial results when the system popup is shown.
        popup: false,
        maxResults: 5,
      });
      if (activeRef.current && generationRef.current === generation) {
        updateStatus('listening');
      }
    } catch (error) {
      if (!activeRef.current || generationRef.current !== generation) return;
      await dropListeners();
      if (!activeRef.current || generationRef.current !== generation) return;
      const message = String((error as Error)?.message ?? error ?? '').toLowerCase();
      if (/permission|denied|microphone|not determined|authoriz/.test(message)) {
        activeRef.current = false;
        updateStatus('denied');
        return;
      }
      failuresRef.current += 1;
      if (failuresRef.current >= MAX_FAILURES) {
        activeRef.current = false;
        updateStatus('error');
        return;
      }
      clearRestart();
      restartTimer.current = window.setTimeout(() => {
        restartTimer.current = null;
        if (activeRef.current) void beginRef.current();
      }, 350);
    }
  }, [
    chooseLanguage,
    clearRestart,
    dropListeners,
    enabled,
    flushFinal,
    updateStatus,
  ]);
  beginRef.current = begin;

  const start = useCallback(() => {
    if (!enabled) {
      updateStatus('unsupported');
      return;
    }
    if (activeRef.current) return;
    activeRef.current = true;
    failuresRef.current = 0;
    generationRef.current += 1;
    consumedRef.current = 0;
    heardRef.current = '';
    setHeard('');
    updateStatus('starting');
    void begin();
  }, [begin, enabled, updateStatus]);

  const stop = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    clearRestart();
    void dropListeners();
    void SpeechRecognition.stop().catch(() => {
      /* engine may already be stopped */
    });
    consumedRef.current = 0;
    heardRef.current = '';
    setHeard('');
    updateStatus('idle');
  }, [clearRestart, dropListeners, updateStatus]);

  useEffect(() => stop, [stop]);

  return {
    status,
    statusRef: statusRef as MutableRefObject<SpeechStatus>,
    heard,
    // An unsupported locale is discovered while starting, not at mount.
    supported: enabled && status !== 'unsupported',
    // Contextual biasing is a Chrome feature; platform engines have no
    // equivalent here, so the reader keeps its normal vocabulary.
    biasing: false,
    start,
    stop,
  };
}
