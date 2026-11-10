import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { initialVad, stepVad } from './vad';
import type { VadState } from './vad';

export type MicStatus = 'idle' | 'requesting' | 'live' | 'denied' | 'unsupported';

export interface Mic {
  status: MicStatus;
  statusRef: MutableRefObject<MicStatus>;
  /** Smoothed display level, 0..1. */
  level: number;
  levelRef: MutableRefObject<number>;
  /** True only while the VAD hears something above the noise floor. */
  speaking: boolean;
  speakingRef: MutableRefObject<boolean>;
  start: () => Promise<void>;
  stop: () => void;
}

/**
 * Microphone level meter with voice activity detection.
 *
 * It does not recognise speech and it never makes up a level: if the user
 * denies the microphone or the browser has no getUserMedia, the status stays
 * denied/unsupported and the level stays at zero. The demo detector must then
 * be advanced manually.
 */
export function useMic(): Mic {
  const [status, setStatus] = useState<MicStatus>('idle');
  const [level, setLevel] = useState(0);
  const [speaking, setSpeaking] = useState(false);
  const statusRef = useRef<MicStatus>('idle');
  const levelRef = useRef(0);
  const speakingRef = useRef(false);
  const speakingStateRef = useRef(false);
  const vadRef = useRef<VadState>({ ...initialVad });
  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastPush = useRef(0);

  const updateStatus = useCallback((next: MicStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const silence = useCallback(() => {
    levelRef.current = 0;
    speakingRef.current = false;
    speakingStateRef.current = false;
    vadRef.current = { ...initialVad };
    setLevel(0);
    setSpeaking(false);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      void ctxRef.current.close().catch(() => {});
    }
    ctxRef.current = null;
    silence();
    updateStatus('idle');
  }, [silence, updateStatus]);

  const start = useCallback(async () => {
    if (streamRef.current || statusRef.current === 'requesting') return;
    if (!navigator.mediaDevices?.getUserMedia) {
      updateStatus('unsupported');
      return;
    }

    silence();
    updateStatus('requesting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // Raw signal: noise suppression can hide the quiet parts we measure.
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      streamRef.current = stream;
      const Ctx = window.AudioContext || (window as any).webkitAudioContext;
      if (!Ctx) {
        stop();
        updateStatus('unsupported');
        return;
      }
      const ctx: AudioContext = new Ctx();
      ctxRef.current = ctx;
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      const buf = new Float32Array(analyser.fftSize);

      const loop = () => {
        analyser.getFloatTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
        const rms = Math.sqrt(sum / buf.length);
        const raw = Math.min(1, rms * 8);

        const now = performance.now();
        const vad = stepVad(vadRef.current, raw, now);
        vadRef.current = vad;
        speakingRef.current = vad.speaking;
        if (vad.speaking !== speakingStateRef.current) {
          speakingStateRef.current = vad.speaking;
          setSpeaking(vad.speaking);
        }

        // Smooth only the visual meter; the VAD reads the raw sample above.
        const shown = Math.max(raw, levelRef.current * 0.8);
        levelRef.current = shown;
        if (now - lastPush.current > 100) {
          lastPush.current = now;
          setLevel(shown);
        }
        rafRef.current = requestAnimationFrame(loop);
      };

      updateStatus('live');
      loop();
    } catch (err) {
      stop();
      const name = (err as DOMException | undefined)?.name;
      updateStatus(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'denied'
          : 'unsupported',
      );
    }
  }, [silence, stop, updateStatus]);

  useEffect(() => stop, [stop]);

  return {
    status,
    statusRef,
    level,
    levelRef,
    speaking,
    speakingRef,
    start,
    stop,
  };
}
