/**
 * The disconnected letters (الحروف المقطّعة) that open 29 surahs.
 *
 * The mushaf writes them as one word — «الٓمٓ», «كٓهيعٓصٓ», «يسٓ» — but a reader
 * says the *names* of the letters: «ألف لام ميم», «كاف ها يا عين صاد», «ياسين».
 * A recogniser transcribes what it hears, so the tracker would see three or five
 * tokens where the mushaf has one word and never advance. This module knows the
 * word at each position and turns the spoken letter names back into letters.
 */

import { normalizeArabic } from './quran';
import { phoneticSimilarity } from './align';

/** surah:ayah → the letters written in the mushaf. */
const AT: Record<string, string> = {
  '2:1': 'الم',
  '3:1': 'الم',
  '7:1': 'المص',
  '10:1': 'الر',
  '11:1': 'الر',
  '12:1': 'الر',
  '13:1': 'المر',
  '14:1': 'الر',
  '15:1': 'الر',
  '19:1': 'كهيعص',
  '20:1': 'طه',
  '26:1': 'طسم',
  '27:1': 'طس',
  '28:1': 'طسم',
  '29:1': 'الم',
  '30:1': 'الم',
  '31:1': 'الم',
  '32:1': 'الم',
  '36:1': 'يس',
  '38:1': 'ص',
  '40:1': 'حم',
  '41:1': 'حم',
  '42:1': 'حم',
  '42:2': 'عسق',
  '43:1': 'حم',
  '44:1': 'حم',
  '45:1': 'حم',
  '46:1': 'حم',
  '50:1': 'ق',
  '68:1': 'ن',
};

export function muqattaahAt(
  surah: number,
  ayah: number,
  index: number,
): string | null {
  if (index !== 0) return null;
  return AT[`${surah}:${ayah}`] ?? null;
}

/**
 * The whole opening said as one word. These are not a letter followed by a
 * letter but the name of the group itself, so they are matched as one token
 * before any segmentation: «يسين»/«ياسين» for يس, «طها»/«طاها» for طه and
 * «حميم»/«حاميم» for حم.
 */
const WHOLE: Record<string, string> = {
  ياسين: 'يس',
  يسين: 'يس',
  طاها: 'طه',
  طها: 'طه',
  حاميم: 'حم',
  حميم: 'حم',
};

/**
 * Spoken name of each letter, already normalised (hamza forms collapse and
 * «راء»/«را» both become «را»). A name may cover two letters: «ياسين» is the
 * name of يس, «طاها» of طه, «حاميم» of حم.
 */
const NAME: Record<string, string> = {
  الف: 'ا',
  لام: 'ل',
  ميم: 'م',
  صاد: 'ص',
  را: 'ر',
  كاف: 'ك',
  ها: 'ه',
  يا: 'ي',
  عين: 'ع',
  طا: 'ط',
  سين: 'س',
  حا: 'ح',
  قاف: 'ق',
  نون: 'ن',
};

/**
 * The same names as the recogniser often writes them. A browser engine adds a
 * tanween («ألفاً»), drops the alef of «كاف», or hears «ألف» as «آلاف»; none of
 * these change what the reader said. Reading them is only ever attempted while
 * the cursor sits on a disconnected-letters word, so an alias can never alter
 * the meaning of an ordinary word elsewhere.
 */
const ALIAS: Record<string, string> = {
  الفا: 'ا',
  الاف: 'ا',
  لاما: 'ل',
  لا: 'ل',
  ميما: 'م',
  مين: 'م',
  صادا: 'ص',
  كافا: 'ك',
  كف: 'ك',
  عينا: 'ع',
  سينا: 'س',
  قافا: 'ق',
  نونا: 'ن',
  راء: 'ر',
  هاا: 'ه',
  ياا: 'ي',
  طاا: 'ط',
  حاا: 'ح',
  // The engine often prefixes a hamza to a name that opens with ع or ح.
  اعين: 'ع',
  احا: 'ح',
  اصاد: 'ص',
  // «سين»/«صاد» heard with a short vowel written as a long one.
  سيين: 'س',
  صياد: 'ص',
};

/**
 * A bare letter, as some engines write an isolated name. It is only read at a
 * disconnected-letters word, where a single «م» can only mean the name.
 */
const BARE: Record<string, string> = {
  ا: 'ا',
  ل: 'ل',
  م: 'م',
  ص: 'ص',
  ر: 'ر',
  ك: 'ك',
  ه: 'ه',
  ي: 'ي',
  ع: 'ع',
  ط: 'ط',
  س: 'س',
  ح: 'ح',
  ق: 'ق',
  ن: 'ن',
};

const NAME_LOOKUP: Record<string, string> = { ...NAME, ...ALIAS };
const SPELL_LOOKUP: Record<string, string> = { ...NAME_LOOKUP, ...BARE };

/** Longest name first, so «سين» is not read as «سي» + «ن». */
const NAMES = Object.keys(NAME_LOOKUP).sort((a, b) => b.length - a.length);
const SPELLINGS = Object.keys(SPELL_LOOKUP).sort((a, b) => b.length - a.length);

function parseNames(
  token: string,
  names: string[],
  lookup: Record<string, string>,
): string | null {
  let rest = token;
  let letters = '';
  while (rest.length > 0) {
    const name = names.find((candidate) => rest.startsWith(candidate));
    if (!name) return null;
    letters += lookup[name];
    rest = rest.slice(name.length);
  }
  return letters || null;
}

/** Letter → the name as it is written in a transcript, for biasing the engine. */
const SPOKEN_NAME: Record<string, string> = {
  '\u0627': '\u0623\u0644\u0641',
  '\u0644': '\u0644\u0627\u0645',
  '\u0645': '\u0645\u064A\u0645',
  '\u0635': '\u0635\u0627\u062F',
  '\u0631': '\u0631\u0627\u0621',
  '\u0643': '\u0643\u0627\u0641',
  '\u0647': '\u0647\u0627',
  '\u064A': '\u064A\u0627',
  '\u0639': '\u0639\u064A\u0646',
  '\u0637': '\u0637\u0627',
  '\u0633': '\u0633\u064A\u0646',
  '\u062D': '\u062D\u0627',
  '\u0642': '\u0642\u0627\u0641',
  '\u0646': '\u0646\u0648\u0646',
};

/** Openings that are normally said as one word rather than letter by letter. */
const MERGED: Record<string, string> = {
  '\u064A\u0633': '\u064A\u0627\u0633\u064A\u0646',
  '\u0637\u0647': '\u0637\u0627\u0647\u0627',
  '\u062D\u0645': '\u062D\u0627\u0645\u064A\u0645',
};

/**
 * How a reader is likely to say this opening, as plain words. Used to bias the
 * speech recogniser towards these names; ordering is by likelihood, because the
 * caller gives the first phrases the strongest boost.
 */
export function spokenPhrases(letters: string): string[] {
  const out: string[] = [];
  const merged = MERGED[letters];
  if (merged) out.push(merged);
  for (const letter of letters) {
    const name = SPOKEN_NAME[letter];
    if (name) out.push(name);
  }
  out.push(letters);
  return out;
}

/**
 * The opening as a reader should say it, for the in-reader hint. Uses the
 * merged name when there is one («يس» → «ياسين») and the letter names
 * otherwise («الم» → «ألف لام ميم»).
 */
export function spokenHint(letters: string): string {
  const merged = MERGED[letters];
  if (merged) return merged;
  return [...letters]
    .map((letter) => SPOKEN_NAME[letter] ?? letter)
    .join(' ');
}

/**
 * Names long enough to survive a fuzzy comparison. Two-letter names («ها»,
 * «يا», «طا») and bare letters are never fuzzed: one wrong letter there is a
 * different name, not a mishearing.
 */
const FUZZY = Object.keys(NAME_LOOKUP).filter((name) => name.length >= 3);

/**
 * Segment a token whose names were heard imprecisely, but only down a path
 * that spells a prefix of `remaining`. Constraining the search by the letters
 * we are actually waiting for is what keeps a loose match from accepting the
 * wrong letter or an ordinary word: «كفر» cannot become «الف» because the
 * first expected letter is ا and no slice of «كفر» is close to «ألف».
 */
function fuzzyRun(token: string, remaining: string): string | null {
  let best: { letters: string; score: number } | null = null;

  const walk = (
    at: number,
    rest: string,
    letters: string,
    score: number,
    parts: number,
  ) => {
    if (at === token.length) {
      if (!letters) return;
      const average = score / parts;
      if (!best || average > best.score) best = { letters, score: average };
      return;
    }
    for (const name of FUZZY) {
      const letter = NAME_LOOKUP[name];
      if (!rest.startsWith(letter)) continue;
      for (const span of [name.length, name.length + 1, name.length - 1]) {
        if (span < 2 || at + span > token.length) continue;
        const slice = token.slice(at, at + span);
        if (slice === name) continue;
        const sim = phoneticSimilarity(slice, name);
        if (sim < 0.8) continue;
        walk(at + span, rest.slice(letter.length), letters + letter, score + sim, parts + 1);
      }
    }
  };

  walk(0, remaining, '', 0, 0);
  return best ? (best as { letters: string }).letters : null;
}

/** Normalise a token the way the tracker does before any lookup. */
function clean(token: string): string {
  return normalizeArabic(token).replace(/[^\u0621-\u064A]/g, '');
}

/**
 * Read a token that is made of spoken letter names. Returns the letters, or
 * null when the token is not made of names at all (an ordinary word).
 */
export function readLetterNames(token: string): string | null {
  const cleanToken = clean(token);
  if (!cleanToken) return null;
  const whole = WHOLE[cleanToken];
  if (whole) return whole;
  return parseNames(cleanToken, NAMES, NAME_LOOKUP);
}

/**
 * Like `readLetterNames`, but also accepts bare letters («ا ل م») and merged
 * bare letters («لم»), which some engines produce for isolated names. Only the
 * tracker calls this while the cursor is on a disconnected-letters word.
 */
export function readLetterSpelling(token: string): string | null {
  const cleanToken = clean(token);
  if (!cleanToken) return null;
  const whole = WHOLE[cleanToken];
  if (whole) return whole;
  return parseNames(cleanToken, SPELLINGS, SPELL_LOOKUP);
}

/**
 * Read one token while the cursor is on a disconnected letters word and
 * `remaining` letters are still expected. An exact name spelling wins; if the
 * engine wrote the name imprecisely («مين» for «ميم», «ساد» for «صاد») a
 * fuzzy segmentation is tried, but only one that spells a real prefix of the
 * opening. Returns the letters this token covers, or null.
 */
export function readLetterRun(token: string, remaining: string): string | null {
  if (!remaining) return null;
  const exact = readLetterSpelling(token);
  if (exact) return remaining.startsWith(exact) ? exact : null;
  return fuzzyRun(clean(token), remaining);
}
