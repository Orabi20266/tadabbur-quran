import { describe, expect, it } from 'vitest';
import { normalizeArabic, wordsForRange, wordsOf } from './quran';
import { TranscriptTracker } from './tracker';
import type { ConfirmationRequest, TrackerMeta } from './tracker';
import type { DetectorWord, EventType } from './types';

interface Event {
  key: string;
  type: EventType;
  meta?: TrackerMeta;
}

function makeTracker(
  patch: {
    words?: DetectorWord[];
    dontProgressUntilFixed?: boolean;
    detectMistakes?: boolean;
    detectTashkeel?: boolean;
    confirmMistakes?: boolean;
  } = {},
) {
  const words = patch.words ?? wordsForRange(112, 1, 4);
  const texts = words.map(
    (w) => wordsOf(w.surah, w.ayah)[w.index] ?? '',
  );
  const normalized = texts.map((text) => normalizeArabic(text));
  const events: Event[] = [];
  let cursor = 0;
  let blocked = false;
  let done = false;
  let confirmation: ConfirmationRequest | null = null;

  const tracker = new TranscriptTracker({
    words,
    normalized,
    diacritized: texts,
    detectMistakes: patch.detectMistakes ?? true,
    detectTashkeel: patch.detectTashkeel ?? true,
    dontProgressUntilFixed: patch.dontProgressUntilFixed ?? false,
    confirmMistakes: patch.confirmMistakes ?? false,
    onConfirmation: (request) => {
      confirmation = request;
    },
    onEvent: (word, type, meta) => events.push({ key: word.key, type, meta }),
    onBlocked: (value) => {
      blocked = value;
    },
    onDone: () => {
      done = true;
    },
    onCursor: (value) => {
      cursor = value;
    },
  });

  return {
    tracker,
    events,
    cursor: () => cursor,
    blocked: () => blocked,
    done: () => done,
    confirmation: () => confirmation,
  };
}

const allWords = wordsForRange(112, 1, 4);
const spoken = allWords.map((w) =>
  normalizeArabic(wordsOf(w.surah, w.ayah)[w.index] ?? ''),
);

describe('TranscriptTracker', () => {
  it('does not move without tokens', () => {
    const h = makeTracker();
    expect(h.cursor()).toBe(0);
    expect(h.events).toHaveLength(0);
  });

  it('advances through correctly recited words', () => {
    const h = makeTracker();
    h.tracker.feed(spoken);
    expect(h.cursor()).toBe(allWords.length);
    expect(h.events).toHaveLength(allWords.length);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
    expect(h.done()).toBe(true);
  });

  it('ignores one unrecognised token but flags a repeated miss', () => {
    const h = makeTracker();
    // A single odd token is normally recogniser noise, not a recitation error.
    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(0);
    expect(h.cursor()).toBe(0);

    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('wrong');
    expect(h.events[0].meta?.recitedText).toBe('سيارة');
    expect(h.cursor()).toBe(0);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
    expect(h.cursor()).toBe(1);
  });

  it('holds a suspected mistake until the reader confirms it', () => {
    const h = makeTracker({ confirmMistakes: true });
    h.tracker.feed(['سيارة', 'سيارة']);
    expect(h.events).toHaveLength(0);
    expect(h.confirmation()?.heard).toBe('سيارة');
    expect(h.blocked()).toBe(true);

    // While the card is open, further recognition cannot move the cursor.
    h.tracker.feed([spoken[0]]);
    expect(h.cursor()).toBe(0);

    h.tracker.resolveConfirmation('wrong');
    expect(h.events.map((e) => e.type)).toEqual(['wrong']);
    expect(h.events[0].meta?.recitedText).toBe('سيارة');
    expect(h.confirmation()).toBeNull();
    expect(h.blocked()).toBe(false);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
  });

  it('accepts the reader saying the misheard word was correct', () => {
    const h = makeTracker({ confirmMistakes: true });
    h.tracker.feed(['سيارة', 'سيارة']);
    h.tracker.resolveConfirmation('correct');
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
    expect(h.cursor()).toBe(1);
    expect(h.confirmation()).toBeNull();
  });

  it('skips a misheard word without recording any mistake', () => {
    const h = makeTracker({ confirmMistakes: true });
    h.tracker.feed(['سيارة', 'سيارة']);
    h.tracker.resolveConfirmation('skip');
    expect(h.events).toHaveLength(0);
    expect(h.cursor()).toBe(1);
    expect(h.confirmation()).toBeNull();
  });

  it('forgets a stray token when the reader continues correctly', () => {
    const h = makeTracker();
    h.tracker.feed(['يعني']);
    expect(h.events).toHaveLength(0);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
    expect(h.cursor()).toBe(1);
  });

  it('joins a word the recogniser split in two', () => {
    const h = makeTracker({ words: wordsForRange(1, 1, 1) });
    // «الرَّحۡمَٰن» is sometimes emitted as two tokens: «الرح» + «من».
    h.tracker.feed(['بسم', 'الله', 'الرح', 'من', 'الرحيم']);
    expect(h.cursor()).toBe(4);
    expect(h.events.map((e) => e.type)).toEqual([
      'correct',
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('ignores breaths and hesitations without swallowing a real word', () => {
    const h = makeTracker({ words: wordsForRange(2, 5, 5) });
    h.tracker.feed([
      'اولايك',
      'اه',
      'عليا',
      'هم',
      'هدي',
      'من',
      'ربهم',
      'واولايك',
      'هم',
      'المفلحون',
    ]);
    // Both «اه» and the first «هم» are filler between words; the second «هم»
    // is the actual word of the ayah and must still be counted.
    expect(h.cursor()).toBe(8);
    expect(h.events).toHaveLength(8);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
  });

  it('forgives one odd token before the next correct word', () => {
    // A single unknown token followed by the next word is the recogniser
    // dropping or mangling one token, not proof that the reader erred.
    const h = makeTracker();
    h.tracker.feed(['سيارة', spoken[1]]);
    expect(h.events.map((e) => [e.key, e.type])).toEqual([
      [allWords[0].key, 'correct'],
      [allWords[1].key, 'correct'],
    ]);
    expect(h.cursor()).toBe(2);
  });

  it('flags two consecutive wrong words', () => {
    const h = makeTracker();
    h.tracker.feed(['سيارة', 'طائرة']);
    expect(h.events.map((e) => e.type)).toEqual(['wrong']);
    expect(h.cursor()).toBe(0);
  });

  it('does not re-count a flagged word when the reader moves past it', () => {
    const h = makeTracker();
    // Two unknown tokens confirm the first word is wrong and flag it.
    h.tracker.feed(['سيارة', 'طائرة']);
    h.tracker.feed([spoken[1]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
    expect(h.events.filter((e) => e.type === 'wrong')).toHaveLength(1);
    expect(h.cursor()).toBe(2);
  });

  it('flags harakat differences when the token is diacritized', () => {
    const h = makeTracker();
    h.tracker.feed(['قَلَ']);
    expect(h.events.map((e) => e.type)).toEqual(['tashkeel']);
    expect(h.cursor()).toBe(1);
  });

  it('accepts matching harakat', () => {
    const h = makeTracker();
    h.tracker.feed(['قُلۡ']);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
    expect(h.cursor()).toBe(1);
  });

  it('does not flag a partial diacritization from the recogniser', () => {
    const h = makeTracker();
    // «قُل» without the sukun is still the right vowel.
    h.tracker.feed(['قُل']);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
    expect(h.cursor()).toBe(1);
  });

  it('allows a new harakat mark after the word was recited correctly again', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    expect(h.tracker.markTashkeel()).not.toBeNull();
    h.tracker.feed([spoken[0], spoken[1]]);
    expect(h.events.slice(-2).map((e) => e.type)).toEqual(['correct', 'correct']);
    expect(h.tracker.markTashkeelAt(allWords[0].key)).not.toBeNull();
  });

  it('moves the cursor to a chosen word without recording anything', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 2));
    expect(h.tracker.seekTo(allWords[5].key)).toBe(true);
    expect(h.cursor()).toBe(5);
    expect(h.events).toHaveLength(2);
    h.tracker.feed([spoken[5]]);
    expect(h.cursor()).toBe(6);
    expect(h.events.map((e) => e.type)).toEqual([
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('does not guess harakat from undiacritized tokens', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('records a manual harakat mistake on the last recited word without moving', () => {
    const h = makeTracker();
    expect(h.tracker.markTashkeel()).toBeNull();
    h.tracker.feed([spoken[0]]);
    const word = h.tracker.markTashkeel();
    expect(word?.key).toBe(allWords[0].key);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'tashkeel']);
    expect(h.cursor()).toBe(1);
  });

  it('does not count the same harakat mark twice', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    expect(h.tracker.markTashkeel()).not.toBeNull();
    expect(h.tracker.markTashkeel()).toBeNull();
    expect(h.events.filter((e) => e.type === 'tashkeel')).toHaveLength(1);
  });

  it('marks any earlier recited word by key', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0], spoken[1]]);
    const word = h.tracker.markTashkeelAt(allWords[0].key);
    expect(word?.key).toBe(allWords[0].key);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct', 'tashkeel']);
    expect(h.cursor()).toBe(2);
  });

  it('refuses to mark a word that has not been recited yet', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    expect(h.tracker.markTashkeelAt(allWords[1].key)).toBeNull();
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('ignores a stuttered previous word', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0]]);
    h.tracker.feed([spoken[0]]);
    expect(h.events).toHaveLength(1);
    expect(h.cursor()).toBe(1);
  });

  it('marks skipped words and advances when hold is off', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[2]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'wrong', 'correct']);
    expect(h.cursor()).toBe(3);
  });

  it('holds on the first skipped word when hold is on', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed([spoken[2]]);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('wrong');
    expect(h.cursor()).toBe(0);
    expect(h.blocked()).toBe(true);

    h.tracker.feed([spoken[0]]);
    expect(h.events.map((e) => e.type)).toEqual(['wrong', 'correct']);
    expect(h.cursor()).toBe(1);
    expect(h.blocked()).toBe(false);
  });

  it('records skipped words as correct when mistake detection is off', () => {
    const h = makeTracker({ detectMistakes: false });
    h.tracker.feed([spoken[2]]);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct', 'correct']);
    expect(h.cursor()).toBe(3);
  });

  it('does not record errors when mistake detection is off', () => {
    const h = makeTracker({ detectMistakes: false });
    h.tracker.feed(['سيارة']);
    expect(h.events).toHaveLength(0);
    expect(h.cursor()).toBe(0);
  });

  it('advances exactly one word per manual step', () => {
    const h = makeTracker();
    h.tracker.step();
    expect(h.cursor()).toBe(1);
    expect(h.events).toHaveLength(1);
    h.tracker.step();
    expect(h.cursor()).toBe(2);
    expect(h.events).toHaveLength(2);
  });

  it('manual retry releases a hold and moves past the word', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed(['سيارة']);
    expect(h.blocked()).toBe(true);
    h.tracker.retry();
    expect(h.blocked()).toBe(false);
    expect(h.cursor()).toBe(1);
    // The single odd token was never recorded as a mistake, so retrying only
    // marks the word correct.
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('accepts a merged two-word token', () => {
    const h = makeTracker();
    h.tracker.feed([spoken[0] + spoken[1]]);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('does not rewind for a single earlier word', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6]]);
    expect(h.cursor()).toBe(10);
    expect(h.events).toHaveLength(10);
  });

  it('rewinds when two consecutive earlier words are recited', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6], spoken[7]]);
    expect(h.cursor()).toBe(8);
    expect(h.events.slice(-2).map((e) => [e.key, e.type])).toEqual([
      [allWords[6].key, 'correct'],
      [allWords[7].key, 'correct'],
    ]);
  });

  it('rewinds when the restart begins one word before the cursor', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[9], spoken[10]]);
    expect(h.cursor()).toBe(11);
    expect(h.events.slice(-2).map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('keeps the forward cursor when the reader continues after a stray word', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6]]);
    h.tracker.feed([spoken[10]]);
    expect(h.cursor()).toBe(11);
    expect(h.events).toHaveLength(11);
  });

  it('clears a hold when the reader restarts earlier', () => {
    const h = makeTracker({ dontProgressUntilFixed: true });
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[11]]);
    expect(h.blocked()).toBe(true);
    expect(h.cursor()).toBe(10);

    h.tracker.feed([spoken[6], spoken[7]]);
    expect(h.blocked()).toBe(false);
    expect(h.cursor()).toBe(8);

    h.tracker.feed(spoken.slice(8, 11));
    expect(h.cursor()).toBe(11);
  });

  it('rewinds with a merged token for the earlier words', () => {
    const h = makeTracker();
    h.tracker.feed(spoken.slice(0, 10));
    h.tracker.feed([spoken[6] + spoken[7], spoken[8]]);
    expect(h.cursor()).toBe(9);
    expect(h.events.slice(-3).map((e) => e.key)).toEqual([
      allWords[6].key,
      allWords[7].key,
      allWords[8].key,
    ]);
  });

  it('tracks Al-Fatiha from ordinary recogniser spelling', () => {
    const h = makeTracker({ words: wordsForRange(1, 1, 7) });
    // Modern-standard spelling and the confusions Chrome's ar-SA engine makes:
    // an added long alif, ص→س, ض→ظ, and qaf→kaf.
    h.tracker.feed([
      'بسم', 'الله', 'الرحمان', 'الرحيم',
      'الحمد', 'لله', 'رب', 'العالمين',
      'الرحمان', 'الرحيم',
      'مالك', 'يوم', 'الدين',
      'اياك', 'نعبد', 'واياك', 'نستعين',
      'اهدنا', 'السراط', 'المستقيم',
      'صراط', 'الذين', 'انعمت', 'عليهم', 'غير', 'المغضوب',
      'عليهم', 'ولا', 'الظالين',
    ]);
    expect(h.cursor()).toBe(29);
    expect(h.events).toHaveLength(29);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
    expect(h.done()).toBe(true);
  });

  it('tracks An-Naba 34 when ikhfa drops the tanween and the joined waw', () => {
    const h = makeTracker({ words: wordsForRange(78, 34, 34) });
    // The recogniser writes «كأساً دهاقاً» as «كأس دهاق»: no tanween, no و.
    h.tracker.feed(['كأس', 'دهاق']);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct']);
    expect(h.done()).toBe(true);
  });

  it('tracks An-Naba 34 when ikhfa writes the tanween as a noon', () => {
    const h = makeTracker({ words: wordsForRange(78, 34, 34) });
    h.tracker.feed(['كاسن', 'دهاقن']);
    expect(h.cursor()).toBe(2);
    expect(h.events.map((e) => e.type)).toEqual(['correct', 'correct']);
  });

  it('accepts an idgham noon the recogniser wrote as the next letter', () => {
    const h = makeTracker({ words: wordsForRange(78, 35, 35) });
    // «لَا يَسۡمَعُونَ فِيهَا لَغۡوٗا وَلَا كِذَّٰبٗا»
    h.tracker.feed(['لا', 'يسمعون', 'فيها', 'لغو', 'ولا', 'كذاب']);
    expect(h.cursor()).toBe(6);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
  });

  it('still flags a phrase the reader really skipped', () => {
    const h = makeTracker({ words: wordsForRange(1, 1, 7) });
    // «مَالِكِ يَوْمِ الدِّينِ» is omitted entirely: a jump of two words is real
    // evidence of a skipped passage, unlike a single dropped token.
    h.tracker.feed([
      'بسم', 'الله', 'الرحمن', 'الرحيم',
      'الحمد', 'لله', 'رب', 'العالمين',
      'الرحمن', 'الرحيم',
      'الدين',
    ]);
    expect(h.events.filter((e) => e.type === 'wrong').map((e) => e.key)).toEqual([
      '1:4:0',
      '1:4:1',
    ]);
    expect(h.cursor()).toBe(13);
  });
});

describe('opening before the first word', () => {
  it('swallows the basmalah and still tracks the surah opening', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 2) });
    h.tracker.feed(['بسم', 'الله', 'الرحمن', 'الرحيم']);
    expect(h.cursor()).toBe(0);
    expect(h.events).toHaveLength(0);
    h.tracker.feed(['الف', 'لام', 'ميم']);
    expect(h.cursor()).toBe(1);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('tolerates the isti\'adha before the basmalah', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 1) });
    h.tracker.feed([
      'اعوذ', 'بالله', 'من', 'الشيطان', 'الرجيم',
      'بسم', 'الله', 'الرحمن', 'الرحيم',
      'الف', 'لام', 'ميم',
    ]);
    expect(h.cursor()).toBe(1);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('tolerates the long isti\'adha and a dropped long vowel', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 1) });
    h.tracker.feed([
      'اعوذ', 'بالله', 'السميع', 'العليم', 'من', 'الشيطان', 'الرجيم',
      'باسم', 'الله', 'الرحمان', 'الرحيم',
      'الف', 'لام', 'ميم',
    ]);
    expect(h.cursor()).toBe(1);
    expect(h.events).toHaveLength(1);
    expect(h.events[0].type).toBe('correct');
  });

  it('does not swallow the basmalah when it is the ayah itself', () => {
    const h = makeTracker({ words: wordsForRange(1, 1, 2) });
    h.tracker.feed(['بسم', 'الله', 'الرحمن', 'الرحيم']);
    expect(h.cursor()).toBe(4);
    expect(h.events.every((e) => e.type === 'correct')).toBe(true);
  });

  it('does not swallow a first word the ayah really starts with', () => {
    // Al-Baqarah 255 opens with «الله»; a basmalah before it is still ignored.
    const h = makeTracker({ words: wordsForRange(2, 255, 255) });
    h.tracker.feed(['بسم', 'الله', 'الرحمن', 'الرحيم', 'الله', 'لا', 'اله']);
    expect(h.cursor()).toBe(3);
    expect(h.events.map((e) => e.type)).toEqual([
      'correct',
      'correct',
      'correct',
    ]);
  });

  it('falls back to alignment when the opening stops early', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 1) });
    h.tracker.feed(['بسم', 'الله', 'الف', 'لام', 'ميم']);
    expect(h.cursor()).toBe(1);
    expect(h.events.map((e) => e.type)).toEqual(['correct']);
  });

  it('swallows a repeated basmalah mid-session without a mistake', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 2) });
    h.tracker.feed(['الف', 'لام', 'ميم']);
    expect(h.cursor()).toBe(1);
    // After a pause the reader may say the basmalah again; it is not part of
    // the page and must not be counted as a mistake.
    h.tracker.feed(['بسم', 'الله', 'الرحمن', 'الرحيم']);
    expect(h.events.filter((e) => e.type === 'wrong')).toHaveLength(0);
    expect(h.cursor()).toBe(1);
  });
});

describe('recogniser biasing', () => {
  it('offers only the words still ahead, in recitation order', () => {
    const h = makeTracker({ words: wordsForRange(112, 1, 2) });
    expect(h.tracker.biasPhrases(3)).toEqual(['قل', 'هو', 'الله']);
    h.tracker.feed(['قل']);
    expect(h.tracker.biasPhrases(3)).toEqual(['هو', 'الله', 'احد']);
  });

  it('never lists a word the reader already passed', () => {
    const h = makeTracker({ words: wordsForRange(112, 1, 1) });
    h.tracker.feed(['قل', 'هو', 'الله', 'احد']);
    expect(h.tracker.biasPhrases(5)).toEqual([]);
  });

  it('spells a disconnected-letters opening the way it is said', () => {
    const h = makeTracker({ words: wordsForRange(2, 1, 1) });
    expect(h.tracker.biasPhrases(1)).toEqual([
      'ألف',
      'لام',
      'ميم',
      'الم',
    ]);
    const yasin = makeTracker({ words: wordsForRange(36, 1, 1) });
    expect(yasin.tracker.biasPhrases(1)[0]).toBe('ياسين');
  });
});
