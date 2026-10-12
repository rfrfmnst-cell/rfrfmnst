import {
  IDENTIFIER_TOKEN_MAX_PIECES,
  IDENTIFIER_TEXT_MAX,
  PART_NUMBER_COMPACT_MAX,
  PART_NUMBER_COMPACT_MIN,
  PART_NUMBER_DISPLAY_MAX,
  compactIdentifier,
  gtinCheckDigitValid,
  isPlausiblePartNumber,
  isPossibleGtin,
  isVinShaped,
  normalizeIdentifierText,
  tokenizeIdentifiers,
} from './part-identifiers';

// Independent GS1 reference: pad to 14 digits, weights 3,1,3,... from the left.
function referenceCheckDigit(body: string): string {
  const padded = body.padStart(13, '0');
  let sum = 0;
  for (let index = 0; index < 13; index += 1) {
    sum += Number(padded[index]) * (index % 2 === 0 ? 3 : 1);
  }
  return String((10 - (sum % 10)) % 10);
}

function withCheckDigit(body: string): string {
  return body + referenceCheckDigit(body);
}

function withWrongCheckDigit(body: string): string {
  return body + String((Number(referenceCheckDigit(body)) + 1) % 10);
}

const REAL_PART_NUMBERS = [
  '04465-33450', // Toyota
  '90915-YZZD2', // Toyota
  '1K0.698.151', // VW/Audi
  '1K0 698 151 A', // VW/Audi
  '0 986 452 041', // Bosch
  'A 000 420 17 20', // Mercedes
  '447260-1234', // Denso
  '41060-1LA0A', // Nissan
  '58101-3SA26', // Hyundai
  '34 11 6 860 242', // BMW
];

describe('part identifier rules', () => {
  it('pins the shared length limits', () => {
    expect(PART_NUMBER_DISPLAY_MAX).toBe(40);
    expect(PART_NUMBER_COMPACT_MIN).toBe(3);
    expect(PART_NUMBER_COMPACT_MAX).toBe(40);
    expect(IDENTIFIER_TOKEN_MAX_PIECES).toBe(8);
    expect(IDENTIFIER_TEXT_MAX).toBe(4096);
  });

  describe('normalizeIdentifierText', () => {
    it('maps Arabic-Indic and Persian digits to ASCII', () => {
      expect(normalizeIdentifierText('٠٤٤٦٥-٣٣٤٥٠')).toBe('04465-33450');
      expect(normalizeIdentifierText('۰۴۴۶۵-۳۳۴۵۰')).toBe('04465-33450');
      expect(compactIdentifier('٠٤٤٦٥-٣٣٤٥٠')).toBe(
        compactIdentifier('04465-33450'),
      );
    });

    it('folds full-width Latin with NFKC and uppercases', () => {
      expect(normalizeIdentifierText('９０９１５－ｙｚｚｄ２')).toBe(
        '90915-YZZD2',
      );
      expect(normalizeIdentifierText('41060-1la0a')).toBe('41060-1LA0A');
    });

    it('maps dash lookalikes and collapses whitespace', () => {
      expect(normalizeIdentifierText('04465\u201333450')).toBe('04465-33450');
      expect(normalizeIdentifierText('04465\u221233450')).toBe('04465-33450');
      expect(normalizeIdentifierText('04465\u201133450')).toBe('04465-33450');
      expect(normalizeIdentifierText('  0\u00A0986 \t452\n041 ')).toBe(
        '0 986 452 041',
      );
    });

    it('drops invisible bidi controls copied from mixed Arabic text', () => {
      expect(normalizeIdentifierText('\u200F04465\u200E-33450\u2069')).toBe(
        '04465-33450',
      );
    });

    it('drops zero-width spaces, soft hyphens and word joiners', () => {
      for (const invisible of ['\u200B', '\u00AD', '\u2060', '\u034F']) {
        expect(normalizeIdentifierText(`04465${invisible}-33450`)).toBe(
          '04465-33450',
        );
      }
    });

    it('breaks on trademark signs and superscripts instead of folding them', () => {
      expect(normalizeIdentifierText('04465-33450\u2122')).toBe('04465-33450');
      expect(normalizeIdentifierText('04465-33450\u00B2 قطعتين')).toBe(
        '04465-33450 قطعتين',
      );
      expect(normalizeIdentifierText('\u2116 04465')).toBe('04465');
    });

    it('uppercases without the Turkish dotted I', () => {
      expect(normalizeIdentifierText('1k0 698 151 i')).toBe('1K0 698 151 I');
    });

    it('reads the Arabic decimal separator as a dot but keeps the Arabic comma', () => {
      // Arabic numeric keyboards type U+066B between digit groups.
      expect(normalizeIdentifierText('1K0\u066B698\u066B151')).toBe(
        '1K0.698.151',
      );
      expect(isPlausiblePartNumber('1K0\u066B698\u066B151')).toBe(true);
      // U+060C separates list items, so it must keep breaking identifiers.
      expect(normalizeIdentifierText('04465-33450، 2018')).toBe(
        '04465-33450، 2018',
      );
    });

    it('compacts by removing space, dot, underscore, slash and dash', () => {
      expect(compactIdentifier('a 000_420/17.20-x')).toBe('A0004201720X');
      expect(compactIdentifier('0 986 452 041')).toBe('0986452041');
    });
  });

  describe('isPlausiblePartNumber', () => {
    it.each(REAL_PART_NUMBERS)('accepts %s', (value: string) => {
      expect(isPlausiblePartNumber(value)).toBe(true);
    });

    it('accepts lowercase, Arabic-Indic and full-width forms', () => {
      expect(isPlausiblePartNumber('90915-yzzd2')).toBe(true);
      expect(isPlausiblePartNumber('٠٤٤٦٥-٣٣٤٥٠')).toBe(true);
      expect(isPlausiblePartNumber('۰۴۴۶۵-۳۳۴۵۰')).toBe(true);
      expect(isPlausiblePartNumber('０４４６５－３３４５０')).toBe(true);
    });

    it('accepts underscore and slash separators', () => {
      expect(isPlausiblePartNumber('1K0/698/151')).toBe(true);
      expect(isPlausiblePartNumber('04465_33450')).toBe(true);
    });

    it('accepts Bosch numbers shaped like a Saudi mobile', () => {
      // 0 580 ... fuel pumps match 05XXXXXXXX, so phones are only handled
      // by the tokenizer, which never rejects a whole typed value for it.
      expect(isPlausiblePartNumber('0 580 464 038')).toBe(true);
    });

    it.each([
      ['Arabic text', 'فلتر زيت'],
      ['Arabic text with digits', 'فلتر 123'],
      ['URL', 'https://example.com/part/12345'],
      ['URL without a scheme', 'www.example.com/12345'],
      ['domain and path', 'example.com/part/12345'],
      ['short domain and path', 'rafraf.sa/p/123'],
      ['uppercase domain', 'WWW.AMAZON.SA/DP/B08XYZ1234'],
      ['www with digits', 'www.parts4u.com/123'],
      ['email', 'parts12@example.com'],
      ['phone with country code', '+966 512345678'],
      ['short phone-like', '+966 5x'],
      ['symbols', 'ABC#123'],
      ['symbol separator', '04465*33450'],
      ['all letters', 'FILTER'],
      ['all letters with separators', 'ABCDEF-GHIJ'],
      ['leading separator', '-04465'],
      ['trailing separator', '04465-'],
      ['two separators in a row', '04465--33450'],
      ['slash then underscore', '04465/_33450'],
      ['underscore then slash', '04465_/33450'],
      ['space then dash', '04465 -33450'],
      ['empty', ''],
      ['over 40 display characters', '1'.repeat(41)],
      ['over 40 with spaces', '1234567890 1234567890 1234567890 12345678'],
      ['compact shorter than 3', 'A-1'],
    ])('rejects %s', (_label: string, value: string) => {
      expect(isPlausiblePartNumber(value)).toBe(false);
    });

    it('accepts the exact boundaries', () => {
      expect(isPlausiblePartNumber('1'.repeat(PART_NUMBER_DISPLAY_MAX))).toBe(
        true,
      );
      expect(isPlausiblePartNumber('A12')).toBe(true);
      expect(isPlausiblePartNumber('A 1 2')).toBe(true);
    });
  });

  describe('isVinShaped', () => {
    it('matches exactly 17 compact characters of the VIN alphabet', () => {
      expect(isVinShaped('1HGCM82633A004352')).toBe(true);
      expect(isVinShaped('1hgcm82633a004352')).toBe(true);
      expect(isVinShaped('1HGCM 82633 A004352')).toBe(true);
      expect(isVinShaped('١HGCM82633A004352')).toBe(true);
    });

    it('does not treat 17-character part numbers with I, O or Q as VINs', () => {
      for (const value of [
        '1234567890ABCDEFO',
        '1234567890ABCDEFI',
        '1234567890ABCDEFQ',
        '1234567890abcdefi',
      ]) {
        expect(compactIdentifier(value)).toHaveLength(17);
        expect(isVinShaped(value)).toBe(false);
        expect(isPlausiblePartNumber(value)).toBe(true);
      }
    });

    it('does not treat 16 or 18-24 character part numbers as VINs', () => {
      for (const value of [
        '1234567890ABCDEF',
        '1234567890ABCDEFGH',
        '12345-67890-ABCDEFGH-JKLM',
        'A1B2C3D4E5F6G7H8J9K0L1M2',
      ]) {
        expect(isVinShaped(value)).toBe(false);
        expect(isPlausiblePartNumber(value)).toBe(true);
      }
    });

    it('rejects values with characters outside the identifier grammar', () => {
      expect(isVinShaped('1HGCM82633A00435#')).toBe(false);
      expect(isVinShaped('1HGCM82633A00435')).toBe(false);
    });
  });

  describe('GTIN', () => {
    it('accepts real published codes', () => {
      expect(gtinCheckDigitValid('4006381333931')).toBe(true); // EAN-13
      expect(gtinCheckDigitValid('036000291452')).toBe(true); // UPC-A
    });

    it.each([
      ['EAN-8', '9638507'],
      ['UPC-A', '03600029145'],
      ['EAN-13', '400638133393'],
      ['GTIN-14', '1400638133393'],
    ])('validates computed %s check digits', (_label: string, body: string) => {
      expect(gtinCheckDigitValid(withCheckDigit(body))).toBe(true);
      expect(gtinCheckDigitValid(withWrongCheckDigit(body))).toBe(false);
    });

    it('agrees with the reference on the published codes', () => {
      expect(withCheckDigit('400638133393')).toBe('4006381333931');
      expect(withCheckDigit('03600029145')).toBe('036000291452');
    });

    it('rejects other lengths and non-digits', () => {
      expect(gtinCheckDigitValid('4006381333932')).toBe(false);
      expect(gtinCheckDigitValid('036000291453')).toBe(false);
      expect(gtinCheckDigitValid(withCheckDigit('123456789'))).toBe(false);
      expect(gtinCheckDigitValid(withCheckDigit('123456'))).toBe(false);
      expect(gtinCheckDigitValid(withCheckDigit('123456789012345'))).toBe(
        false,
      );
      expect(gtinCheckDigitValid('40063813339A1')).toBe(false);
      // Number(' ') is 0, so a space standing in for a zero must still fail.
      expect(gtinCheckDigitValid('4 06381333931')).toBe(false);
      expect(gtinCheckDigitValid('\t36000291452')).toBe(false);
      expect(gtinCheckDigitValid('')).toBe(false);
    });

    it('accepts exactly one check digit per body, covering 0 through 9', () => {
      const seen = new Set<string>();
      for (let last = 0; last <= 9; last += 1) {
        const body = `40063813339${last}`;
        const valid = Array.from({ length: 10 }, (_, digit) => digit).filter(
          (digit) => gtinCheckDigitValid(`${body}${digit}`),
        );
        expect(valid).toEqual([Number(referenceCheckDigit(body))]);
        seen.add(referenceCheckDigit(body));
      }
      expect(seen.size).toBe(10);
    });

    it('detects possible GTINs in spaced, Arabic-Indic or dashed input', () => {
      expect(isPossibleGtin('4006381333931')).toBe(true);
      expect(isPossibleGtin('0 36000 29145 2')).toBe(true);
      expect(isPossibleGtin('٤٠٠٦٣٨١٣٣٣٩٣١')).toBe(true);
      expect(isPossibleGtin(withCheckDigit('9638507'))).toBe(true);
      expect(isPossibleGtin('4006381333932')).toBe(false);
      expect(isPossibleGtin('04465-33450')).toBe(false);
      expect(isPossibleGtin('A006381333931')).toBe(false);
    });
  });

  it.each(REAL_PART_NUMBERS)(
    'round-trips %s from customer text',
    (value: string) => {
      expect(tokenizeIdentifiers(`عندي القطعة ${value} شكراً`)).toContain(
        compactIdentifier(value),
      );
    },
  );
});
