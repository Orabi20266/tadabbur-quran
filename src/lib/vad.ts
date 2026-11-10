/**
 * Voice activity detection with hysteresis and an adaptive noise floor.
 *
 * Input is a normalised level (0..1, see useMic). The detector must never treat
 * room noise as recitation: it starts on a level clearly above the measured
 * floor, keeps speaking through short gaps between words, and only stops after
 * the level stays low for `holdMs`.
 */
export interface VadState {
  /** Slow estimate of the room noise, in the same 0..1 scale as level. */
  noise: number;
  speaking: boolean;
  /** Timestamp of the last sample that crossed the start threshold. */
  lastVoiceAt: number;
  /** Timestamp of the first sample; -1 until the first step. */
  startedAt: number;
}

export interface VadOptions {
  /** Minimum level that can start speech (before the noise margin). */
  start?: number;
  /** Minimum level that keeps speech alive. */
  stop?: number;
  /** How long the level may stay low before speech ends. */
  holdMs?: number;
  /** Ignore the first moments while the noise floor settles. */
  calibrationMs?: number;
}

export const initialVad: VadState = {
  noise: 0.02,
  speaking: false,
  lastVoiceAt: 0,
  startedAt: -1,
};

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n));

/**
 * Noise is capped while calibrating: a normal room can reach this level, while
 * recitation is well above it. The cap keeps a loud first word from raising the
 * threshold beyond the speaker's own voice.
 */
const CALIBRATION_CAP = 0.2;

export function stepVad(
  prev: VadState,
  level: number,
  now: number,
  opts: VadOptions = {},
): VadState {
  const holdMs = opts.holdMs ?? 380;
  const calibrationMs = opts.calibrationMs ?? 500;
  const startedAt = prev.startedAt < 0 ? now : prev.startedAt;
  const calibrating = now - startedAt < calibrationMs;

  let noise = prev.noise;
  if (calibrating) {
    noise += (Math.min(level, CALIBRATION_CAP) - noise) * 0.35;
  } else if (level < noise) {
    // Follow a quieter room immediately: a lower floor never hides speech.
    noise = level;
  } else if (!prev.speaking) {
    // While quiet, follow the room slowly enough not to chase a single word.
    noise += (level - noise) * 0.02;
  }

  const start = Math.max(opts.start ?? 0.09, noise * 1.8 + 0.03);
  const stop = Math.max(opts.stop ?? 0.05, start * 0.55);

  let speaking = prev.speaking;
  let lastVoiceAt = prev.lastVoiceAt;

  if (calibrating) {
    speaking = false;
  } else if (level >= start) {
    speaking = true;
    lastVoiceAt = now;
  } else if (speaking && level <= stop && now - lastVoiceAt > holdMs) {
    speaking = false;
  }

  return {
    noise: clamp(noise, 0.002, 0.5),
    speaking,
    lastVoiceAt,
    startedAt,
  };
}
