import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { Capacitor } from '@capacitor/core';
import { SpeechRecognition } from '@capacitor-community/speech-recognition';
import { nextTokens } from './useSpeech';
import type { Speech, SpeechStatus } from './useSpeech';

type Listener = { remove: () => Promise<void> };

const MAX_FAILURES = 3;

/**
 * Capacitor wrapper around the platform speech recogniser.
 *
 * The web hook is left untouched: on iOS/Android this adapter supplies the
 * same `Speech` contract, using the same token guard as the browser engine.
 * It never invents a transcript — when permission is denied or the platform
 * engine is unavailable the caller keeps its manual word-by-word fallback.
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
  const generationRef = useRef(0);
  const consumedRef = useRef(0);
  const failuresRef = useRef(0);
  const listenersRef = useRef<Listener[]>([]);
  const restartTimer = useRef<number | null>(null);
  const onTokensRef = useRef(onTokens);
  onTokensRef.current = onTokens;

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

  // Platform engines do not send a dedicated "final result" flag. Their last
  // partial result is followed by `listeningState: stopped`, so that is where
  // the held final token is committed before the engine restarts.
  const flushFinal = useCallback(() => {
    if (!heardRef.current) return;
    const step = nextTokens(heardRef.current, false, consumedRef.current);
    if (!step) return;
    consumedRef.current = step.end;
    if (step.tokens.length) onTokensRef.current(step.tokens);
  }, []);

  const begin = useCallback(
    async (generation: number) => {
      if (!enabled || !activeRef.current || generationRef.current !== generation) {
        return;
      }

      try {
        const { available } = await SpeechRecognition.available();
        if (!activeRef.current || generationRef.current !== generation) return;
        if (!available) {
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
        // Each engine session reports its own fresh results list.
        consumedRef.current = 0;

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
              // The platform engine ends on silence. Commit the final result,
              // then keep the session alive until the reader explicitly stops.
              flushFinal();
              clearRestart();
              restartTimer.current = window.setTimeout(() => {
                restartTimer.current = null;
                if (activeRef.current) void begin(generation);
              }, 350);
            }
          },
        );
        listenersRef.current.push(state);

        updateStatus('starting');
        await SpeechRecognition.start({
          language: lang,
          partialResults: true,
          // Android ignores partial results when the system popup is shown.
          popup: false,
          maxResults: 5,
        });
        if (activeRef.current && generationRef.current === generation) {
          updateStatus('listening');
        }
      } catch {
        if (activeRef.current && generationRef.current === generation) {
          failuresRef.current += 1;
          if (failuresRef.current >= MAX_FAILURES) {
            activeRef.current = false;
            updateStatus('error');
            return;
          }
          clearRestart();
          restartTimer.current = window.setTimeout(() => {
            restartTimer.current = null;
            if (activeRef.current) void begin(generation);
          }, 350);
        }
      }
    },
    [clearRestart, dropListeners, enabled, flushFinal, lang, updateStatus],
  );

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
    void begin(generationRef.current);
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
    supported: enabled,
    // Contextual biasing is a Chrome feature; platform engines have no
    // equivalent here, so the reader keeps its normal vocabulary.
    biasing: false,
    start,
    stop,
  };
}
