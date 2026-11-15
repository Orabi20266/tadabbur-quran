import { useCallback, useEffect, useRef, useState } from 'react';
import type { MutableRefObject } from 'react';
import { normalizeToken, splitTranscript } from './align';
import type { SpeechStatus } from './useSpeech';
import { GEMINI_PROXY } from './config';
import { downsample, encodeWav, rms, toBase64 } from './wav';

/**
 * محرّك تعرّف صوتي بواسطة Gemini، بديل لمحرّك المتصفح.
 *
 * محرّك المتصفح مدرَّب على العربية الفصحى الحديثة لا على التلاوة، فيكتب «قل»
 * مكان «قال» ويهمل التشكيل كلّياً. Gemini يسمع الصوت نفسه ويعيد الكلمات
 * بالحركات، فيستطيع TranscriptTracker بعدها كشف أخطاء الحركة والتجويد.
 *
 * الطريقة: التقاط PCM من الميكروفون، وتقطيعه نوافذ متداخلة (6 ثوانٍ كل 2.5
 * ثانية) حتى لا تُقطع الكلمة على حدود النافذة، ثم إرسال كل نافذة إلى Gemini
 * واستخراج الكلمات الجديدة فقط بعد مقارنة تداخل النافذتين.
 */

export interface RuleNote {
  word?: string;
  rule: string;
  detail?: string;
  severity?: 'low' | 'medium' | 'high';
}

export interface TranscribeResult {
  words: string[];
  confidence?: number;
  notes: RuleNote[];
}

export interface GeminiSpeechOptions {
  /** مفتاح Gemini يوضع في الإعدادات ويُخزَّن محلياً في المتصفح. */
  apiKey?: string;
  /** بديل للمفتاح: وسيط (مثل n8n) يحفظ المفتاح على الخادم. */
  endpoint?: string;
  model?: string;
  /** طول النافذة المُرسلة. */
  windowMs?: number;
  /** الفاصل بين نافذتين؛ أقل من طول النافذة لضمان التداخل. */
  hopMs?: number;
  /** ملاحظات التجويد التي يسمعها Gemini في النافذة الأخيرة. */
  onRuleNotes?: (notes: RuleNote[]) => void;
}

export interface GeminiSpeech {
  status: SpeechStatus;
  statusRef: MutableRefObject<SpeechStatus>;
  heard: string;
  supported: boolean;
  biasing: boolean;
  /** آخر خطأ شبكي/مفتاح، لعرضه للمستخدم بدل رسالة عامة. */
  lastError: string;
  start: () => void;
  stop: () => void;
}

const WORKLET_SOURCE = `
class PcmCapture extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length) this.port.postMessage(channel.slice(0));
    return true;
  }
}
registerProcessor('pcm-capture', PcmCapture);
`;

const SAMPLE_RATE = 16000;

const PROMPT = [
  'أنت محرّك تعرّف صوتي متخصص في تلاوة القرآن الكريم بالرسم العثماني.',
  'المطلوب: انسخ ما يُتلى حرفياً كما تسمعه، كلمة كلمة، مع التشكيل الكامل',
  '(فتحة، ضمة، كسرة، سكون، شدة، تنوين، مدّ).',
  'قواعد صارمة:',
  '1) لا تُصحّح الخطأ ولا تُكمل الآية من حفظك؛ اكتب ما سُمع فعلاً حتى لو كان خطأً.',
  '2) لا تُضِف كلمة لم تُنطق، ولا تحذف كلمة نُطقت.',
  '3) إن كان الصوت صامتاً أو غير مفهوم فأعِد words فارغة.',
  '4) في rule_notes سجّل أي خلل تجويد تسمعه (مدّ، غنّة، قلقلة، إخفاء، إدغام،',
  '   تفخيم/ترقيق، همس/جهر) مع الكلمة المعنية ودرجة الخطورة.',
  'أعِد JSON فقط.',
].join('\n');

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    words: { type: 'ARRAY', items: { type: 'STRING' } },
    confidence: { type: 'NUMBER' },
    rule_notes: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          word: { type: 'STRING' },
          rule: { type: 'STRING' },
          detail: { type: 'STRING' },
          severity: { type: 'STRING' },
        },
        required: ['rule'],
      },
    },
  },
  required: ['words'],
};

/** الكلمات الجديدة فقط: النوافذ متداخلة، فالبادئة تكرّر ما سُمع سابقاً. */
export function newWords(previous: string[], fresh: string[], maxOverlap = 12): string[] {
  if (!previous.length) return fresh;
  const limit = Math.min(previous.length, fresh.length, maxOverlap);
  for (let k = limit; k > 0; k--) {
    let same = true;
    for (let i = 0; i < k; i++) {
      if (
        normalizeToken(previous[previous.length - k + i]) !==
        normalizeToken(fresh[i])
      ) {
        same = false;
        break;
      }
    }
    if (same) return fresh.slice(k);
  }
  return fresh;
}

function cleanWords(words: string[]): string[] {
  const out: string[] = [];
  for (const word of words) {
    for (const token of splitTranscript(String(word))) out.push(token);
  }
  return out;
}

function notesOf(raw: unknown): RuleNote[] {
  if (!Array.isArray(raw)) return [];
  const notes: RuleNote[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const note = item as Record<string, unknown>;
    const rule = typeof note.rule === 'string' ? note.rule.trim() : '';
    if (!rule) continue;
    const severity =
      note.severity === 'low' || note.severity === 'medium' || note.severity === 'high'
        ? note.severity
        : undefined;
    notes.push({
      rule,
      detail: typeof note.detail === 'string' ? note.detail : undefined,
      word: typeof note.word === 'string' ? note.word : undefined,
      severity,
    });
  }
  return notes;
}

function parseResult(raw: string): TranscribeResult {
  const text = raw
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '')
    .trim();
  try {
    const parsed = JSON.parse(text) as {
      words?: unknown;
      confidence?: unknown;
      rule_notes?: unknown;
    };
    const words = Array.isArray(parsed.words)
      ? cleanWords(parsed.words.filter((w): w is string => typeof w === 'string'))
      : cleanWords(text.split(/\s+/).filter(Boolean));
    return {
      words,
      confidence:
        typeof parsed.confidence === 'number' ? parsed.confidence : undefined,
      notes: notesOf(parsed.rule_notes),
    };
  } catch {
    // ردّ غير JSON: نأخذ النص كما هو بدل إسقاط الجلسة.
    return { words: cleanWords(text.split(/\s+/).filter(Boolean)), notes: [] };
  }
}

async function transcribe(
  wav: ArrayBuffer,
  opts: GeminiSpeechOptions,
): Promise<TranscribeResult> {
  const audioBase64 = toBase64(wav);
  const key = opts.apiKey?.trim();
  // أولوية الاتصال: وسيط يختاره المستخدم، ثم مفتاحه الشخصي، ثم وسيط الموقع
  // العام الذي يحمل المفتاح على الخادم حتى لا يضيف الزائر شيئاً.
  const endpoint = opts.endpoint?.trim() || (key ? '' : GEMINI_PROXY);

  if (endpoint) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'transcribe',
        audioBase64,
        audioMime: 'audio/wav',
        prompt: PROMPT,
      }),
    });
    if (!response.ok) {
      throw new Error(`الوسيط أعاد ${response.status}`);
    }
    const data = (await response.json()) as {
      words?: unknown;
      report?: { words?: unknown; rule_notes?: unknown };
      rule_notes?: unknown;
    };
    const report = data.report ?? {};
    const words = Array.isArray(data.words) ? data.words : report.words;
    return {
      words: Array.isArray(words)
        ? cleanWords(words.filter((w): w is string => typeof w === 'string'))
        : [],
      notes: notesOf(data.rule_notes ?? report.rule_notes),
    };
  }

  if (!key) throw new Error('لا يوجد مفتاح Gemini ولا وسيط مهيّأ');

  const model = opts.model?.trim() || 'gemini-3.6-flash';
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model,
    )}:generateContent`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': key,
      },
      body: JSON.stringify({
        contents: [
          {
            role: 'user',
            parts: [
              { text: PROMPT },
              { inline_data: { mime_type: 'audio/wav', data: audioBase64 } },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          response_mime_type: 'application/json',
          response_schema: RESPONSE_SCHEMA,
        },
      }),
    },
  );

  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    let message = `Gemini أعاد ${response.status}`;
    try {
      const parsed = JSON.parse(detail) as { error?: { message?: string } };
      if (parsed.error?.message) message = parsed.error.message;
    } catch {
      /* نص غير JSON */
    }
    throw new Error(message);
  }

  const data = (await response.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] } }[];
  };
  const raw =
    data.candidates?.[0]?.content?.parts
      ?.map((part) => part.text ?? '')
      .filter(Boolean)
      .join('\n') ?? '';
  return parseResult(raw);
}

/** حلقة عيّنات دائرية بحجم ثوانٍ محدودة، بدل مصفوفة تكبر بلا نهاية. */
function createRing(capacity: number) {
  return { data: new Float32Array(capacity), len: 0 };
}

function pushRing(ring: { data: Float32Array; len: number }, chunk: Float32Array) {
  const data = ring.data;
  if (chunk.length >= data.length) {
    data.set(chunk.subarray(chunk.length - data.length));
    ring.len = data.length;
    return;
  }
  const overflow = ring.len + chunk.length - data.length;
  if (overflow > 0) {
    data.copyWithin(0, overflow, ring.len);
    ring.len -= overflow;
  }
  data.set(chunk, ring.len);
  ring.len += chunk.length;
}

function tail(ring: { data: Float32Array; len: number }, count: number): Float32Array {
  const n = Math.min(count, ring.len);
  return ring.data.slice(ring.len - n, ring.len);
}

export function useGeminiSpeech(
  onTokens: (tokens: string[]) => void,
  options: GeminiSpeechOptions = {},
): GeminiSpeech {
  const supported =
    typeof window !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof AudioContext !== 'undefined';

  const windowMs = options.windowMs ?? 6000;
  const hopMs = options.hopMs ?? 3500;

  const [status, setStatus] = useState<SpeechStatus>(
    supported ? 'idle' : 'unsupported',
  );
  const [heard, setHeard] = useState('');
  const [lastError, setLastError] = useState('');
  const statusRef = useRef<SpeechStatus>(supported ? 'idle' : 'unsupported');
  const activeRef = useRef(false);
  const generationRef = useRef(0);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const nodeRef = useRef<AudioWorkletNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const ringRef = useRef(createRing(SAMPLE_RATE * 12));
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);
  const committedRef = useRef<string[]>([]);
  const failuresRef = useRef(0);

  const onTokensRef = useRef(onTokens);
  onTokensRef.current = onTokens;
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const updateStatus = useCallback((next: SpeechStatus) => {
    statusRef.current = next;
    setStatus(next);
  }, []);

  const teardown = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    const node = nodeRef.current;
    nodeRef.current = null;
    if (node) {
      node.port.onmessage = null;
      try {
        node.disconnect();
      } catch {
        /* قطع مسبق */
      }
    }
    const processor = processorRef.current;
    processorRef.current = null;
    if (processor) {
      processor.onaudioprocess = null;
      try {
        processor.disconnect();
      } catch {
        /* قطع مسبق */
      }
    }
    const gain = gainRef.current;
    gainRef.current = null;
    if (gain) {
      try {
        gain.disconnect();
      } catch {
        /* قطع مسبق */
      }
    }
    const ctx = ctxRef.current;
    ctxRef.current = null;
    if (ctx) void ctx.close().catch(() => undefined);
    const stream = streamRef.current;
    streamRef.current = null;
    stream?.getTracks().forEach((track) => track.stop());
    ringRef.current = createRing(SAMPLE_RATE * 12);
    busyRef.current = false;
  }, []);

  const tick = useCallback(async () => {
    if (!activeRef.current || busyRef.current) return;
    const ctx = ctxRef.current;
    const ring = ringRef.current;
    const sourceRate = ctx?.sampleRate ?? SAMPLE_RATE;
    const needed = Math.round((windowMs / 1000) * sourceRate);
    if (ring.len < needed) return;

    const slice = tail(ring, needed);
    // نافذة صامتة: نُبقيها في الحلقة وننتظر الحركة التالية بدل إهدار طلب.
    if (rms(slice) < 0.004) return;

    const pcm = downsample(slice, sourceRate, SAMPLE_RATE);
    const wav = encodeWav(pcm, SAMPLE_RATE);
    const generation = generationRef.current;
    const hop = Math.round((hopMs / 1000) * sourceRate);
    // نُزيح بداية النافذة التالية قليلاً فقط كي تبقى الكلمة على الحدود.
    ring.len = Math.max(0, ring.len - (needed - hop));

    busyRef.current = true;
    try {
      const result = await transcribe(wav, optionsRef.current);
      if (!activeRef.current || generationRef.current !== generation) return;
      failuresRef.current = 0;
      setLastError('');
      if (result.notes.length) optionsRef.current.onRuleNotes?.(result.notes);
      if (!result.words.length) return;

      const fresh = newWords(committedRef.current, result.words);
      const merged = committedRef.current.concat(result.words).slice(-60);
      committedRef.current = merged;
      if (!fresh.length) return;
      setHeard(merged.slice(-14).join(' '));
      onTokensRef.current(fresh);
    } catch (error) {
      if (!activeRef.current) return;
      const message = error instanceof Error ? error.message : 'خطأ غير معروف';
      setLastError(message);
      // تجاوز الحصة (429) مؤقّت: لا يُسقط الجلسة، النافذة التالية تُرسل بعد
      // ثوانٍ بدل إيقاف الميكروفون وإجبار القارئ على اليدوي.
      const throttled = /429|RESOURCE_EXHAUSTED|quota/i.test(message);
      if (!throttled) {
        failuresRef.current += 1;
        if (failuresRef.current >= 4) {
          activeRef.current = false;
          teardown();
          updateStatus('error');
        }
      }
    } finally {
      busyRef.current = false;
    }
  }, [hopMs, teardown, updateStatus, windowMs]);

  const start = useCallback(async () => {
    if (!supported) {
      updateStatus('unsupported');
      return;
    }
    if (activeRef.current) return;
    activeRef.current = true;
    generationRef.current += 1;
    failuresRef.current = 0;
    committedRef.current = [];
    setHeard('');
    updateStatus('starting');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: true,
        },
      });
      if (!activeRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      const ctx = new AudioContext();
      ctxRef.current = ctx;
      await ctx.resume().catch(() => undefined);
      const source = ctx.createMediaStreamSource(stream);
      const gain = ctx.createGain();
      gain.gain.value = 0;
      gainRef.current = gain;

      const push = (channel: Float32Array) => {
        pushRing(ringRef.current, channel);
      };

      if (ctx.audioWorklet) {
        const url = URL.createObjectURL(
          new Blob([WORKLET_SOURCE], { type: 'application/javascript' }),
        );
        try {
          await ctx.audioWorklet.addModule(url);
        } finally {
          URL.revokeObjectURL(url);
        }
        const node = new AudioWorkletNode(ctx, 'pcm-capture', {
          numberOfInputs: 1,
          numberOfOutputs: 1,
          outputChannelCount: [1],
        });
        node.port.onmessage = (event: MessageEvent<Float32Array>) => push(event.data);
        source.connect(node);
        node.connect(gain);
        nodeRef.current = node;
      } else {
        // متصفحات بلا AudioWorklet (Safari قديم): ScriptProcessor بديل مقبول.
        const processor = ctx.createScriptProcessor(4096, 1, 1);
        processor.onaudioprocess = (event) => {
          push(new Float32Array(event.inputBuffer.getChannelData(0)));
        };
        source.connect(processor);
        processor.connect(gain);
        processorRef.current = processor;
      }

      gain.connect(ctx.destination);
      updateStatus('listening');
      timerRef.current = window.setInterval(() => {
        void tick();
      }, hopMs);
    } catch (error) {
      activeRef.current = false;
      teardown();
      const name = (error as { name?: string })?.name;
      updateStatus(name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'error');
      setLastError(error instanceof Error ? error.message : 'تعذّر تشغيل الميكروفون');
    }
  }, [hopMs, supported, teardown, tick, updateStatus]);

  const stop = useCallback(() => {
    activeRef.current = false;
    generationRef.current += 1;
    teardown();
    committedRef.current = [];
    setHeard('');
    updateStatus('idle');
  }, [teardown, updateStatus]);

  useEffect(() => stop, [stop]);

  return {
    status,
    statusRef,
    heard,
    supported,
    biasing: false,
    lastError,
    start: () => {
      void start();
    },
    stop,
  };
}
