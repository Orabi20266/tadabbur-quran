import { describe, expect, it } from 'vitest';
import { newWords } from './geminiSpeech';
import { downsample, encodeWav, rms, toBase64 } from './wav';

describe('newWords', () => {
  it('returns everything when nothing was heard before', () => {
    expect(newWords([], ['بسم', 'الله'])).toEqual(['بسم', 'الله']);
  });

  it('drops the overlapping prefix of a sliding window', () => {
    // النافذة الجديدة تبدأ داخل النافذة السابقة: «رب» و«العالمين» مكرّرتان.
    expect(newWords(['الحمد', 'لله', 'رب'], ['لله', 'رب', 'العالمين'])).toEqual([
      'العالمين',
    ]);
  });

  it('ignores diacritics while comparing the overlap', () => {
    expect(newWords(['الْحَمْدُ', 'لِلَّهِ'], ['الحمد', 'لله', 'رب'])).toEqual(['رب']);
  });

  it('keeps the whole window when it does not overlap', () => {
    expect(newWords(['قل'], ['هو', 'الله'])).toEqual(['هو', 'الله']);
  });

  it('never reports the same word twice when the window repeats', () => {
    expect(newWords(['قل', 'هو', 'الله'], ['قل', 'هو', 'الله'])).toEqual([]);
  });
});

describe('wav', () => {
  it('halves the sample count when halving the rate', () => {
    const input = new Float32Array(3200).fill(0.5);
    expect(downsample(input, 32000, 16000)).toHaveLength(1600);
  });

  it('writes a mono 16-bit RIFF header', () => {
    const buffer = encodeWav(new Float32Array(100), 16000);
    const view = new DataView(buffer);
    const tag = (offset: number, length: number) =>
      String.fromCharCode(
        ...Array.from({ length }, (_, i) => view.getUint8(offset + i)),
      );
    expect(tag(0, 4)).toBe('RIFF');
    expect(tag(8, 4)).toBe('WAVE');
    expect(tag(36, 4)).toBe('data');
    expect(view.getUint16(22, true)).toBe(1); // mono
    expect(view.getUint32(24, true)).toBe(16000);
    expect(buffer.byteLength).toBe(44 + 200);
  });

  it('base64 round-trips the header', () => {
    const buffer = encodeWav(new Float32Array(10), 16000);
    expect(atob(toBase64(buffer)).slice(0, 4)).toBe('RIFF');
  });

  it('reports silence as near-zero energy', () => {
    expect(rms(new Float32Array(64))).toBe(0);
    expect(rms(new Float32Array(64).fill(0.5))).toBeCloseTo(0.5);
  });
});
