/**
 * تحويل صوت الميكروفون إلى WAV أحادي 16 كيلوهرتز.
 *
 * Gemini يقبل WAV مباشرة، والترميز يدوياً هنا أرخص من MediaRecorder: نحتاج
 * نوافذ متداخلة (كل 2.5 ثانية نافذة 6 ثوانٍ) حتى لا تُقطع الكلمات بين المقطعين،
 * وهو شيء لا يسمح به MediaRecorder لأنه ينتج حاوية واحدة متصلة.
 */

/** متوسط العيّنات لكل شريحة، يحوّل 48/44.1 كيلوهرتز إلى 16 كيلوهرتز. */
export function downsample(
  input: Float32Array,
  inputRate: number,
  outputRate = 16000,
): Float32Array {
  if (inputRate <= outputRate) return input.slice();
  const ratio = inputRate / outputRate;
  const length = Math.floor(input.length / ratio);
  const out = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(input.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += input[j];
    out[i] = end > start ? sum / (end - start) : 0;
  }
  return out;
}

function writeString(view: DataView, offset: number, text: string) {
  for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
}

/** ترويسة RIFF/WAVE قياسية، 16 بت أحادي. */
export function encodeWav(samples: Float32Array, sampleRate = 16000): ArrayBuffer {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  writeString(view, 0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeString(view, 8, 'WAVE');
  writeString(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeString(view, 36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let offset = 44;
  for (let i = 0; i < samples.length; i++) {
    const sample = Math.max(-1, Math.min(1, samples[i]));
    view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
    offset += 2;
  }
  return buffer;
}

/** Base64 على دفعات صغيرة: `String.fromCharCode(...bytes)` ينفجر على المقاطع الطويلة. */
export function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(i, i + chunk) as unknown as number[],
    );
  }
  return btoa(binary);
}

/** مستوى الصوت، لتفادي إرسال نافذة صامتة إلى Gemini وإهدار الحصة. */
export function rms(samples: Float32Array): number {
  if (!samples.length) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
