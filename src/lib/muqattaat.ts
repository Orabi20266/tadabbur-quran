/**
 * The disconnected letters (الحروف المقطّعة) that open 29 surahs.
 *
 * The mushaf writes them as one word — «الٓمٓ», «كٓهيعٓصٓ», «يسٓ» — but a reader
 * says the *names* of the letters: «ألف لام ميم», «كاف ها يا عين صاد», «ياسين».
 * A recogniser transcribes what it hears, so the tracker would see three or five
 * tokens where the mushaf has one word and never advance. This module knows the
 * word at each position and turns the spoken letter names back into letters.
 */

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

/** Longest name first, so «سين» is not read as «سي» + «ن». */
const NAMES = Object.keys(NAME).sort((a, b) => b.length - a.length);

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
 * Read a normalised token as a run of letter names. Returns the letters, or
 * null when the token is not made of names at all (an ordinary word).
 */
export function readLetterNames(token: string): string | null {
  let rest = token;
  let letters = '';
  while (rest.length > 0) {
    const name = NAMES.find((candidate) => rest.startsWith(candidate));
    if (!name) return null;
    letters += NAME[name];
    rest = rest.slice(name.length);
  }
  return letters || null;
}
