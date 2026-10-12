// قواعد أرقام القطع (pure): تطبيع، معقولية، شكل VIN، GTIN، واستخراج الرموز من نص العميل.

export const PART_NUMBER_DISPLAY_MAX = 40;
export const PART_NUMBER_COMPACT_MIN = 3;
export const PART_NUMBER_COMPACT_MAX = 40;

/** Most whole space-separated pieces joined into one candidate token. */
export const IDENTIFIER_TOKEN_MAX_PIECES = 8;
/** Output cap per tokenizeIdentifiers call; later candidates are dropped. */
export const IDENTIFIER_TOKENS_MAX = 256;
/** Normalized characters tokenized per text; the run cut at the limit is dropped. */
export const IDENTIFIER_TEXT_MAX = 4096;

export interface IdentifierTokenOptions {
  /**
   * Exact client template strings removed (after normalization) before
   * tokenizing. A template that embeds an id, such as quote selection, must be
   * passed once per id in the thread, fully built.
   */
  exclude?: readonly string[];
}

const ARABIC_INDIC_ZERO = 0x0660;
const EXTENDED_ARABIC_INDIC_ZERO = 0x06f0;
const ASCII_ZERO = 0x30;

// Bidi controls, zero-width spaces, soft hyphens and joiners are invisible in
// mixed Arabic/Latin text and would otherwise split an identifier that looks
// whole on screen.
const INVISIBLE_CONTROLS = /\p{Default_Ignorable_Code_Point}/gu;
// NFKC would turn ™, № and superscripts into letters or digits glued to the
// number, so they break runs instead.
const SYMBOLS_AND_OTHER_NUMBERS = /[\p{So}\p{No}]/gu;
const DASH_LOOKALIKES = /[\u2010-\u2015\u2212]/gu;
// Arabic decimal separator, typed between digits on Arabic numeric keyboards.
const ARABIC_DECIMAL_SEPARATOR = /\u066B/gu;
const IDENTIFIER_SEPARATORS = /[ ._/-]/gu;
const PLAUSIBLE_DISPLAY = /^[A-Z0-9]+(?:[ ._/-][A-Z0-9]+)*$/u;
const IDENTIFIER_RUN = /[A-Z0-9]+(?:[ ._/-][A-Z0-9]+)*/gu;
const RUN_CHAR = /[A-Z0-9._/-]/u;
const VIN_SHAPE = /^[A-HJ-NPR-Z0-9]{17}$/u;
// Saudi mobile with a 0, 966 or 00966 prefix; a bare 5XXXXXXXX is left alone.
const SAUDI_MOBILE_SHAPE = /^(?:00966|966|0)5[0-9]{8}$/u;
const SAUDI_MOBILE_WITH_TRUNK_SHAPE = /^(?:00966|966)05[0-9]{8}$/u;
// A domain whose labels are letters only, followed by a path or the end.
const DOMAIN_LIKE = /(?:^|[ /])[A-Z]+(?:\.[A-Z]+)*\.[A-Z]{2,24}(?:\/|$)/u;
const GTIN_LENGTHS: ReadonlySet<number> = new Set([8, 12, 13, 14]);
// Never present after normalization (whitespace collapses to U+0020), so it
// breaks identifier runs where an excluded template used to be.
const EXCLUDED_TEMPLATE_BREAK = '\n';
// Survives normalization and separates tokens on both sides of a reference.
const EXCLUDED_REFERENCE_BREAK = '\u0000';
const URL_REFERENCE =
  /(?<![A-Z0-9+.-])(?:[A-Z][A-Z0-9+.-]*:\/\/|(?:HTTPS?|FTPS?|FILE|MAILTO|TEL|DATA):|WWW\.)[^\s<>"']+|(?<![\p{L}\p{N}._@\uFF20-])(?:[\p{L}\p{N}-]+\.)+[\p{L}]{2,24}(?::[0-9]{1,5})?[/?#][^\s<>"']*|(?<![A-Z0-9._@\uFF20-])(?:[A-Z0-9-]+\.)+(?:COM|NET|ORG|EDU|GOV|IO|CO|SA|AE|QA|KW|BH|OM|UK|US|DE|FR|JP|CN|SHOP|STORE|ONLINE|APP|DEV|INFO|BIZ|ME|RU)(?![A-Z0-9.-])|(?<![A-Z0-9._-])(?:(?:[0-9]{1,3}\.){3}[0-9]{1,3}|\[[A-F0-9:]+\]|LOCALHOST)(?::[0-9]{1,5})?[/?#][^\s<>"']*/giu;
const EMAIL_REFERENCE =
  /(?<![^\s<>()",;]) *(?:"(?:[^"\\]|\\.)*"|[^\s<>()",;]+) *@ *(?:\[[^\]\s]+\]|[^\s<>()",;]*) */gu;
const SHAPE_GAP = /^[ \p{P}\p{S}]*$/u;
// Registered IBAN country lengths; shape, not a bank/checksum verification.
const IBAN_LENGTHS = new Map(
  (
    'AD24 AE23 AL28 AT20 AZ28 BA20 BE16 BG22 BH22 BR29 BY28 CH21 CR22 ' +
    'CY28 CZ24 DE22 DJ27 DK18 DO28 EE20 EG29 ES24 FI18 FK18 FO18 FR27 ' +
    'GB22 GE22 GI23 GL18 GR27 GT28 HR21 HU28 IE22 IL23 IQ23 IS26 IT27 ' +
    'JO30 KW30 KZ20 LB28 LC32 LI21 LT20 LU20 LV21 LY25 MC27 MD24 ME22 ' +
    'MK19 MN20 MR27 MT31 MU30 NI28 NL18 NO15 OM23 PK24 PL28 PS29 PT25 ' +
    'QA29 RO24 RS22 RU33 SA24 SC31 SD18 SE24 SI19 SK24 SM27 SO23 ST25 ' +
    'SV28 TL23 TN24 TR26 UA29 VA22 VG24 XK20'
  )
    .split(' ')
    .map((entry) => [entry.slice(0, 2), Number(entry.slice(2))]),
);

export function normalizeIdentifierText(value: string): string {
  return value
    .replace(/[\u0660-\u0669]/gu, (digit) =>
      String.fromCharCode(digit.charCodeAt(0) - ARABIC_INDIC_ZERO + ASCII_ZERO),
    )
    .replace(/[\u06F0-\u06F9]/gu, (digit) =>
      String.fromCharCode(
        digit.charCodeAt(0) - EXTENDED_ARABIC_INDIC_ZERO + ASCII_ZERO,
      ),
    )
    .replace(INVISIBLE_CONTROLS, '')
    .replace(SYMBOLS_AND_OTHER_NUMBERS, ' ')
    .normalize('NFKC')
    .toUpperCase()
    .replace(DASH_LOOKALIKES, '-')
    .replace(ARABIC_DECIMAL_SEPARATOR, '.')
    .replace(/\s+/gu, ' ')
    .trim();
}

export function compactIdentifier(value: string): string {
  return normalizeIdentifierText(value).replace(IDENTIFIER_SEPARATORS, '');
}

function isPlausibleNormalized(display: string): boolean {
  if (display.length > PART_NUMBER_DISPLAY_MAX) return false;
  if (!PLAUSIBLE_DISPLAY.test(display)) return false;
  if (display.startsWith('WWW.') || DOMAIN_LIKE.test(display)) return false;
  const compact = display.replace(IDENTIFIER_SEPARATORS, '');
  return (
    compact.length >= PART_NUMBER_COMPACT_MIN &&
    compact.length <= PART_NUMBER_COMPACT_MAX &&
    /[0-9]/u.test(compact)
  );
}

export function isPlausiblePartNumber(value: string): boolean {
  return isPlausibleNormalized(normalizeIdentifierText(value));
}

/** Write-time VIN shape. Sourcing keeps its stricter isVinLikeSearchQuery. */
export function isVinShaped(value: string): boolean {
  return VIN_SHAPE.test(compactIdentifier(value));
}

/** GS1 mod-10 check digit for GTIN-8, GTIN-12, GTIN-13 and GTIN-14. */
export function gtinCheckDigitValid(digits: string): boolean {
  if (!/^[0-9]+$/u.test(digits) || !GTIN_LENGTHS.has(digits.length)) {
    return false;
  }
  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1) {
    sum += Number(digits[index]) * weight;
    weight = weight === 3 ? 1 : 3;
  }
  return (10 - (sum % 10)) % 10 === Number(digits[digits.length - 1]);
}

export function isPossibleGtin(value: string): boolean {
  return gtinCheckDigitValid(compactIdentifier(value));
}

// Removes each template occurrence. Identifier characters glued to an edge
// that is itself an identifier character go too, so a template never cuts a
// piece and leaves a fragment of it behind.
function stripTemplates(
  normalized: string,
  exclude: readonly string[] | undefined,
): string {
  let text = normalized;
  for (const template of exclude ?? []) {
    const needle = normalizeIdentifierText(template);
    if (!needle) continue;
    const gluesBefore = RUN_CHAR.test(needle.charAt(0));
    const gluesAfter = RUN_CHAR.test(needle.charAt(needle.length - 1));
    let result = '';
    let from = 0;
    let at = text.indexOf(needle);
    while (at !== -1) {
      let start = at;
      while (
        gluesBefore &&
        start > from &&
        RUN_CHAR.test(text.charAt(start - 1))
      ) {
        start -= 1;
      }
      let end = at + needle.length;
      while (
        gluesAfter &&
        end < text.length &&
        RUN_CHAR.test(text.charAt(end))
      ) {
        end += 1;
      }
      result += text.slice(from, start) + EXCLUDED_TEMPLATE_BREAK;
      from = end;
      at = text.indexOf(needle, from);
    }
    text = result + text.slice(from);
  }
  return text;
}

// Keeps the first IDENTIFIER_TEXT_MAX characters and drops the run the limit
// cuts, so a cut never leaves part of a number, VIN or phone behind.
function capRawText(text: string): string {
  if (text.length <= IDENTIFIER_TEXT_MAX) return text;
  let end = IDENTIFIER_TEXT_MAX;
  let quoteStart = -1;
  let escaped = false;
  const parentheses: number[] = [];
  for (let index = 0; index < end; index += 1) {
    const character = text.charAt(index);
    if (!escaped && /["\uFF02]/u.test(character)) {
      quoteStart = quoteStart === -1 ? index : -1;
    }
    if (!escaped && quoteStart === -1 && /[(\uFF08]/u.test(character))
      parentheses.push(index);
    if (!escaped && quoteStart === -1 && /[)\uFF09]/u.test(character))
      parentheses.pop();
    escaped = character === '\\' && !escaped;
  }
  if (quoteStart !== -1) end = quoteStart;
  if (parentheses[0] !== undefined) end = Math.min(end, parentheses[0]);
  // Unicode local parts/domains can contain letters that are not identifier
  // letters. Discard the cut whitespace-delimited piece before shape groups.
  while (end > 0 && !/\s/u.test(text.charAt(end - 1))) end -= 1;
  const cutPiece = text.slice(end, IDENTIFIER_TEXT_MAX);
  if (
    !/[A-Z0-9\u0660-\u0669\u06F0-\u06F9\uFF00-\uFFEF]/iu.test(cutPiece) &&
    !text.slice(0, end).includes('"')
  ) {
    return text.slice(0, end);
  }
  // Drop the complete tail that could belong to a cut identifier/reference,
  // before running any regular expression over untrusted unbounded input.
  while (
    end > 0 &&
    /[A-Z0-9\s\p{P}\p{S}\p{M}\p{Default_Ignorable_Code_Point}\u0660-\u0669\u06F0-\u06F9\uFF00-\uFFEF]/iu.test(
      text.charAt(end - 1),
    )
  ) {
    end -= 1;
  }
  return text.slice(0, end);
}

function capText(text: string): string {
  if (text.length <= IDENTIFIER_TEXT_MAX) return text;
  let end = IDENTIFIER_TEXT_MAX;
  while (end > 0 && /[A-Z0-9 \p{P}\p{S}]/u.test(text.charAt(end))) {
    end -= 1;
  }
  return text.slice(0, end);
}

interface ShapeClaim {
  start: number;
  stop: number;
  /** A phone keeps its own exact span; a VIN keeps nothing. */
  keepExact: boolean;
}

function stripReferences(text: string): string {
  // CFWS permits nested/escaped email comments. Blank balanced comments only
  // in the matching view; preserve source offsets and unrelated parentheses.
  const emailView = text.split('');
  const wrappedEmailView = text.split('');
  const comments: number[] = [];
  let escaped = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (!escaped && character === '(') {
      comments.push(index);
    } else if (!escaped && character === ')' && comments.length > 0) {
      const commentStart = comments.pop()!;
      emailView.fill(' ', commentStart, index + 1);
      // Parentheses around an address are ordinary prose; inner CFWS still
      // disappears in this view. The first view handles @ inside a comment.
      if (!text.slice(commentStart, index + 1).includes('@')) {
        wrappedEmailView.fill(' ', commentStart, index + 1);
      }
    }
    escaped = character === '\\' && !escaped;
  }
  const references = [
    ...text.matchAll(URL_REFERENCE),
    ...text.matchAll(EMAIL_REFERENCE),
    ...emailView.join('').matchAll(EMAIL_REFERENCE),
    ...wrappedEmailView.join('').matchAll(EMAIL_REFERENCE),
  ].sort((left, right) => left.index - right.index);
  let result = '';
  let from = 0;
  for (const reference of references) {
    const stop = reference.index + reference[0].length;
    if (reference.index >= from) {
      result += text.slice(from, reference.index) + EXCLUDED_REFERENCE_BREAK;
    }
    from = Math.max(from, stop);
  }
  return result + text.slice(from);
}

function wholePieceClaim(
  text: string,
  start: number,
  stop: number,
): ShapeClaim {
  while (start > 0 && RUN_CHAR.test(text.charAt(start - 1))) start -= 1;
  while (stop < text.length && RUN_CHAR.test(text.charAt(stop))) stop += 1;
  return { start, stop, keepExact: false };
}

// Scan across punctuation before ordinary tokenization splits it. A claim uses
// source character offsets, so every overlapping candidate is rejected.
function shapeClaims(text: string): ShapeClaim[] {
  const claims: ShapeClaim[] = [];
  const atoms = [...text.matchAll(/[A-Z0-9]+(?:[._/-][A-Z0-9]+)*/gu)];
  for (const [index, atom] of atoms.entries()) {
    const start = atom.index;
    let compact = '';
    let previousStop = start;
    for (let position = index; position < atoms.length; position += 1) {
      const next = atoms[position];
      if (!next) break;
      if (!SHAPE_GAP.test(text.slice(previousStop, next.index))) break;
      compact += next[0].replace(IDENTIFIER_SEPARATORS, '');
      if (compact.length > 34) break;
      const stop = next.index + next[0].length;
      if (
        SAUDI_MOBILE_SHAPE.test(compact) ||
        SAUDI_MOBILE_WITH_TRUNK_SHAPE.test(compact)
      ) {
        claims.push({ start, stop, keepExact: true });
      } else if (
        IBAN_LENGTHS.get(compact.slice(0, 2)) === compact.length &&
        /^[A-Z]{2}[0-9]{2}[A-Z0-9]+$/u.test(compact)
      ) {
        claims.push(wholePieceClaim(text, start, stop));
      }
      previousStop = stop;
    }
  }
  const vinClaims: ShapeClaim[] = [];
  for (const [index, atom] of atoms.entries()) {
    const start = atom.index;
    if (atom[0].split(/[._/-]/u).some((part) => VIN_SHAPE.test(part))) {
      vinClaims.push(wholePieceClaim(text, start, start + atom[0].length));
    }
    let compact = '';
    let previousStop = start;
    for (let position = index; position < atoms.length; position += 1) {
      const next = atoms[position];
      if (!next || !SHAPE_GAP.test(text.slice(previousStop, next.index))) break;
      compact += next[0].replace(IDENTIFIER_SEPARATORS, '');
      if (compact.length > 17) break;
      const stop = next.index + next[0].length;
      if (
        VIN_SHAPE.test(compact) &&
        !claims.some(
          (claim) =>
            claim.start < stop &&
            start < claim.stop &&
            (start > claim.start || stop < claim.stop),
        )
      ) {
        vinClaims.push(wholePieceClaim(text, start, stop));
      }
      previousStop = stop;
    }
  }
  return [...claims, ...vinClaims];
}

// A malformed separator never licenses the valid-looking pieces on its sides.
// Final dots are sentence punctuation; internal repeated separators and leading
// or trailing slash/underscore/dash quarantine the complete connected pieces.
function malformedClaims(text: string): ShapeClaim[] {
  const claims: ShapeClaim[] = [];
  const pieces = [...text.matchAll(/[A-Z0-9._/-]+/gu)];
  for (const [index, piece] of pieces.entries()) {
    const previous = pieces[index - 1];
    const next = pieces[index + 1];
    if (
      /^[._/-]+$/u.test(piece[0]) &&
      previous &&
      next &&
      /^ +$/u.test(
        text.slice(previous.index + previous[0].length, piece.index),
      ) &&
      /^ +$/u.test(text.slice(piece.index + piece[0].length, next.index))
    ) {
      claims.push({
        start: previous.index,
        stop: next.index + next[0].length,
        keepExact: false,
      });
    }
    const core = piece[0].replace(/^\.+|\.+$/gu, '');
    if (!/[0-9]/u.test(core)) continue;
    if (!/(?:[._/-]{2,}|^[_/-]|[_/-]$)/u.test(core)) continue;
    let start = piece.index;
    let stop = start + piece[0].length;
    if (
      /^[_/-]/u.test(core) &&
      previous &&
      /^ +$/u.test(text.slice(previous.index + previous[0].length, start))
    ) {
      start = previous.index;
    }
    if (
      /[_/-]$/u.test(core) &&
      next &&
      /^ +$/u.test(text.slice(stop, next.index))
    ) {
      stop = next.index + next[0].length;
    }
    claims.push({ start, stop, keepExact: false });
  }
  for (const match of text.matchAll(
    /[A-Z0-9]+(?:[._/-]+ +| +[._/-]+)[A-Z0-9]+/gu,
  )) {
    claims.push(
      wholePieceClaim(text, match.index, match.index + match[0].length),
    );
  }
  return claims;
}

function overlapsClaim(
  claims: readonly ShapeClaim[],
  start: number,
  stop: number,
): boolean {
  return claims.some(
    (claim) =>
      claim.start < stop &&
      start < claim.stop &&
      !(claim.keepExact && claim.start === start && claim.stop === stop),
  );
}

/**
 * Compact identifier candidates in free customer text. Every contiguous span
 * of up to IDENTIFIER_TOKEN_MAX_PIECES whole space-separated pieces of a run
 * is a candidate, so "0 986 452 041" and "88310-06470 2018" both resolve; a
 * span is never cut inside a piece, so no substring of a typed value appears.
 * References, malformed separator spans, VINs and IBANs are never provenance.
 * A Saudi mobile keeps only its exact span because some Bosch numbers share
 * its shape. Punctuation can break candidates but cannot expose shape fragments.
 */
export function tokenizeIdentifiers(
  text: string,
  options: IdentifierTokenOptions = {},
): string[] {
  const normalized = capText(
    stripTemplates(
      stripReferences(
        normalizeIdentifierText(
          stripReferences(capRawText(text).replace(INVISIBLE_CONTROLS, '')),
        ),
      ),
      options.exclude,
    ),
  );
  const tokens = new Set<string>();
  const claims = [...shapeClaims(normalized), ...malformedClaims(normalized)];
  for (const match of normalized.matchAll(IDENTIFIER_RUN)) {
    const pieces = match[0].split(' ');
    let from = match.index;
    for (let start = 0; start < pieces.length; start += 1) {
      const end = Math.min(pieces.length, start + IDENTIFIER_TOKEN_MAX_PIECES);
      for (let stop = start + 1; stop <= end; stop += 1) {
        const display = pieces.slice(start, stop).join(' ');
        if (display.length > PART_NUMBER_DISPLAY_MAX) break;
        if (!isPlausibleNormalized(display)) continue;
        if (overlapsClaim(claims, from, from + display.length)) continue;
        tokens.add(display.replace(IDENTIFIER_SEPARATORS, ''));
        if (tokens.size >= IDENTIFIER_TOKENS_MAX) return [...tokens];
      }
      from += (pieces[start]?.length ?? 0) + 1;
    }
  }
  return [...tokens];
}

/** Exact compact equality with one customer token; never a substring match. */
export function customerTextContainsIdentifier(
  texts: readonly string[],
  value: string,
  options: IdentifierTokenOptions = {},
): boolean {
  if (!isPlausiblePartNumber(value) || isVinShaped(value)) return false;
  const compact = compactIdentifier(value);
  return texts.some((text) =>
    tokenizeIdentifiers(text, options).includes(compact),
  );
}
