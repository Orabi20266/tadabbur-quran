/**
 * Short audible alert for a tracked mistake.
 *
 * The context is created lazily and resumed from a user gesture (starting a
 * session) so browsers allow playback. Every call is best-effort: audio must
 * never break tracking, and a missing/blocked context is ignored.
 */

type AudioContextCtor = typeof AudioContext;

let ctx: AudioContext | null = null;
let lastPlayedAt = 0;

function context(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  if (ctx) return ctx;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: AudioContextCtor })
      .webkitAudioContext;
  if (!Ctor) return null;
  try {
    ctx = new Ctor();
  } catch {
    return null;
  }
  return ctx;
}

/** Call from a user gesture so later alerts are allowed to play. */
export function primeMistakeSound(): void {
  const ac = context();
  if (ac && ac.state === 'suspended') {
    void ac.resume().catch(() => {});
  }
}

/** Descending two-step tone, throttled so a burst of errors is one alert. */
export function playMistakeSound(): void {
  const now = Date.now();
  if (now - lastPlayedAt < 500) return;

  const ac = context();
  if (!ac) return;
  lastPlayedAt = now;
  if (ac.state === 'suspended') void ac.resume().catch(() => {});

  const t = ac.currentTime;
  const gain = ac.createGain();
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.012);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.34);
  gain.connect(ac.destination);

  const osc = ac.createOscillator();
  osc.type = 'triangle';
  osc.frequency.setValueAtTime(440, t);
  osc.frequency.exponentialRampToValueAtTime(300, t + 0.22);
  osc.connect(gain);
  osc.start(t);
  osc.stop(t + 0.36);
}
