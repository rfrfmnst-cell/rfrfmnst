// Digit runs joined by separators lose their order inside Arabic text: digits
// after Arabic letters resolve as Arabic numbers and a hyphen or space between
// them stays neutral, so "04465-33450" renders as "33450-04465". Such runs are
// isolated as left-to-right. Runs that start with a Latin letter, or that
// follow Latin text, already keep their order (digits take the Latin
// direction), and isolating them would make the isolate a neutral that swaps
// them with the Latin text around it.
const LATIN_RUN = /\+?[A-Za-z0-9]+(?:[-./_:+, ][A-Za-z0-9]+)*/g;
const SEPARATOR = /[-./_:+, ]/;
const RTL_LETTER = /[֐-ࣿיִ-﷿ﹰ-ﻼ]/;

export interface TextRun {
  text: string;
  ltr: boolean;
}

/** True when the last letter before `start` on the same line is not RTL. */
function followsLatin(text: string, start: number): boolean {
  for (let index = start - 1; index >= 0; index -= 1) {
    const char = text.charAt(index);
    if (char === '\n') return false;
    if (/\p{L}/u.test(char)) return !RTL_LETTER.test(char);
  }
  return false;
}

function needsIsolate(text: string, value: string, start: number): boolean {
  // A single number keeps its order; only joined digit runs reorder.
  if (!/^\+?[0-9]/.test(value) || !SEPARATOR.test(value)) return false;
  // Part of a link or an email address: leave the whole token to the browser.
  const before = text[start - 1] ?? '';
  if (/[@/:.]/.test(before) || text[start + value.length] === '@') return false;
  return !followsLatin(text, start);
}

/** Splits text into plain runs and the digit runs that need an LTR isolate. */
export function ltrRuns(text: string): TextRun[] {
  const runs: TextRun[] = [];
  let last = 0;
  for (const match of text.matchAll(LATIN_RUN)) {
    const value = match[0];
    const start = match.index ?? 0;
    if (!needsIsolate(text, value, start)) continue;
    if (start > last) runs.push({ text: text.slice(last, start), ltr: false });
    runs.push({ text: value, ltr: true });
    last = start + value.length;
  }
  if (last < text.length) runs.push({ text: text.slice(last), ltr: false });
  return runs;
}
