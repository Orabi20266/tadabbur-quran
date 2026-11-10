import { describe, expect, it } from 'vitest';
import { initialVad, stepVad } from './vad';
import type { VadState } from './vad';

/** Run the VAD over a fixed level for a duration, 20 ms per sample. */
function hold(
  state: VadState,
  level: number,
  from: number,
  to: number,
  step = 20,
  opts = {},
): VadState {
  let next = state;
  for (let t = from; t <= to; t += step) {
    next = stepVad(next, level, t, opts);
  }
  return next;
}

describe('voice activity detection', () => {
  it('never speaks in pure silence', () => {
    const state = hold(initialVad, 0.001, 0, 3000);
    expect(state.speaking).toBe(false);
    expect(state.noise).toBeLessThan(0.01);
  });

  it('does not start below the minimum threshold', () => {
    const quiet = hold(initialVad, 0.001, 0, 600);
    const state = hold(quiet, 0.07, 620, 2000);
    expect(state.speaking).toBe(false);
  });

  it('starts when the voice crosses the threshold', () => {
    const quiet = hold(initialVad, 0.001, 0, 600);
    const state = stepVad(quiet, 0.4, 620);
    expect(state.speaking).toBe(true);
    expect(state.lastVoiceAt).toBe(620);
  });

  it('keeps speaking through short gaps between words', () => {
    const quiet = hold(initialVad, 0.001, 0, 600);
    const voice = stepVad(quiet, 0.4, 620);
    const gap = hold(voice, 0.01, 640, 900);
    expect(gap.speaking).toBe(true);
  });

  it('stops after a long silence', () => {
    const quiet = hold(initialVad, 0.001, 0, 600);
    const voice = stepVad(quiet, 0.4, 620);
    const silence = hold(voice, 0.01, 640, 1200);
    expect(silence.speaking).toBe(false);
  });

  it('adapts to steady room noise instead of treating it as speech', () => {
    const state = hold(initialVad, 0.12, 0, 4000);
    expect(state.speaking).toBe(false);
    expect(state.noise).toBeGreaterThan(0.1);
  });

  it('can hear a voice above an adapted noise floor', () => {
    const room = hold(initialVad, 0.12, 0, 3000);
    const voice = stepVad(room, 0.5, 3020);
    expect(voice.speaking).toBe(true);
  });

  it('ignores a loud sample while calibrating', () => {
    const state = stepVad(initialVad, 0.8, 0);
    expect(state.speaking).toBe(false);
  });
});
