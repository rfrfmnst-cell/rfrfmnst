import {
  IDENTIFIER_TEXT_MAX,
  compactIdentifier,
  customerTextContainsIdentifier,
  tokenizeIdentifiers,
} from './part-identifiers';

describe('customer identifier provenance boundaries', () => {
  it.each([
    'https://example.com/?part=04465-33450',
    'https://example.com/#04465-33450',
    'https://example.com/?a=04465&b=33450',
    'https://example.com/?part=™04465-33450',
    'https://example.com/?part=²04465-33450',
    'https://user123@example.com/04465-33450',
    'www.parts4u.com/?part=04465-33450',
    'parts4u.example/part/04465-33450?year=2018',
    'example.com:8443/#04465-33450',
    'https:04465-33450',
    'مثال.السعودية/?part=04465-33450',
    '192.168.1.1/?item=04465-33450',
    '127.0.0.1?item=04465-33450',
    '[::1]/?item=04465-33450',
    'localhost/?item=04465-33450',
    'ｈｔｔｐｓ：／／example.com/?part=０４４６５－３３４５０',
  ])('never treats a URL as typed part provenance: %s', (reference) => {
    expect(tokenizeIdentifiers(`الرابط ${reference}`)).toEqual([]);
    for (const value of ['04465', '33450', '04465-33450', '2018', '123']) {
      expect(customerTextContainsIdentifier([reference], value)).toBe(false);
    }
  });

  it.each([
    '12345@example.com',
    '04465-33450@example.com',
    'parts12+04465@example.com',
    '04465.33450@parts4u.example',
    '０４４６５－３３４５０＠example.com',
    '04465-33450@مثال.السعودية',
    '04465س33450@example.com',
    '"04465-33450"@example.com',
    '"04465 33450"@example.com',
    '04465-33450@[192.0.2.1]',
    '04465-33450(comment)@example.com',
    '"04465-33450"(comment)@example.com',
    '04465-33450(comment(nested))@example.com',
    '04465-33450(comment\\)continued)@example.com',
    '(04465-33450@example.com)',
    '(04465-33450(comment(nested))@example.com)',
    '04465-33450(comment@invalid)@example.com',
  ])('never treats an email local part as provenance: %s', (email) => {
    expect(tokenizeIdentifiers(`بريدي ${email}`)).toEqual([]);
    for (const value of ['12345', '04465', '33450', '04465-33450']) {
      expect(customerTextContainsIdentifier([email], value)).toBe(false);
    }
  });

  it('preserves independent typed numbers without joining across references', () => {
    const text = '04465 https://example.com/?id=99999 33450';
    expect(tokenizeIdentifiers(text)).toEqual(['04465', '33450']);
    expect(customerTextContainsIdentifier([text], '04465-33450')).toBe(false);
    expect(
      tokenizeIdentifiers('04465-33450، بريدي 12345@example.com، 90915-YZZD2'),
    ).toEqual(['0446533450', '90915YZZD2']);
  });

  it.each([
    '1HGCM،82633،A004352',
    '1HGCM, 82633, A004352',
    '(1HGCM) (82633) (A004352)',
    '1HGCM (82633) A004352',
    '1HGCM/82633/A004352',
    '1HGCM;82633;A004352',
    '1HGCM826|33A004352',
    '1HGCM*82633*A004352',
    '1HGC,M826,33A0,04352',
    '١HGCM،٨٢٦٣٣،A٠٠٤٣٥٢',
  ])('never exposes punctuation-separated VIN fragments: %s', (vin) => {
    expect(tokenizeIdentifiers(`الهيكل ${vin}`)).toEqual([]);
    for (const value of ['1HGCM', '82633', 'A004352', '1HGCM82633']) {
      expect(customerTextContainsIdentifier([vin], value)).toBe(false);
    }
    expect(tokenizeIdentifiers(`${vin} القطعة 04465-33450`)).toEqual([
      '0446533450',
    ]);
  });

  it.each([
    'رقم الهيكل 1HGCM,82633,A004352 2018',
    'VIN 1HGCM,82633,A004352 2018',
    '2018 1HGCM,82633,A004352',
    '04465-33450 1HGCM,82633,A004352',
    '1HGCM,82633,A004352 04465-33450',
  ])(
    'never licenses a VIN fragment beside another typed value: %s',
    (text: string) => {
      for (const value of ['1HGCM', '82633', 'A004352']) {
        expect(customerTextContainsIdentifier([text], value)).toBe(false);
      }
    },
  );

  it.each([
    '+966 (0) 55 123 4567',
    '+966 (55) 123-4567',
    '00966 (0) 55 123 4567',
    '(055) 123 4567',
    '055،123،4567',
    '+٩٦٦ (٠) ٥٥ ١٢٣ ٤٥٦٧',
  ])('never exposes punctuation-separated mobile fragments: %s', (phone) => {
    for (const value of ['966', '055', '123', '4567', '1234567', '551234567']) {
      expect(customerTextContainsIdentifier([phone], value)).toBe(false);
    }
    expect(tokenizeIdentifiers(`${phone} القطعة 04465-33450`)).toContain(
      '0446533450',
    );
  });

  it('never keeps a complete mobile span inside a longer grouped VIN shape', () => {
    expect(tokenizeIdentifiers('0551234567 1234567')).toEqual([]);
  });

  it.each([
    'SA0380000000608010167519',
    'SA03 8000 0000 6080 1016 7519',
    'SA03،8000،0000،6080،1016،7519',
    'SA03-8000-0000-6080-1016-7519',
    'SA03|8000|0000|6080|1016|7519',
    'AE07 0331 2345 6789 0123 456',
    'DE89 3704 0044 0532 0130 00',
    'GB82 WEST 1234 5698 7654 32',
    // A mistyped check digit still identifies bank data, not a part number.
    'SA04 8000 0000 6080 1016 7519',
  ])(
    'never treats an IBAN or its fragments as provenance: %s',
    (iban: string) => {
      expect(tokenizeIdentifiers(`الآيبان ${iban}`)).toEqual([]);
      expect(
        customerTextContainsIdentifier([iban], compactIdentifier(iban)),
      ).toBe(false);
      for (const value of ['8000', '6080', '1016', '7519', 'SA03']) {
        expect(customerTextContainsIdentifier([iban], value)).toBe(false);
      }
      expect(tokenizeIdentifiers(`${iban} رقم القطعة 90915-YZZD2`)).toEqual([
        '90915YZZD2',
      ]);
    },
  );

  it.each([
    '04465--33450',
    '04465 -33450',
    '04465- 33450',
    '04465 - 33450',
    '04465/_33450',
    '04465__33450',
    '04465..33450',
    '04465 .33450',
    '04465. 33450',
    '04465 /_ 33450',
    '-04465',
    '04465-',
  ])('rejects the complete malformed separator span: %s', (malformed) => {
    expect(tokenizeIdentifiers(`رقمه ${malformed}`)).toEqual([]);
    for (const value of ['04465', '33450', '04465-33450']) {
      expect(customerTextContainsIdentifier([malformed], value)).toBe(false);
    }
    expect(tokenizeIdentifiers(`${malformed} والبديل 90915-YZZD2`)).toEqual([
      '90915YZZD2',
    ]);
  });

  it('does not expose a protected shape split by the text cap', () => {
    const pad = 'ا'.repeat(IDENTIFIER_TEXT_MAX - 8);
    for (const value of [
      '1HGCM،82633،A004352',
      '+966 (0) 55 123 4567',
      'SA03،8000،0000،6080،1016،7519',
    ]) {
      expect(tokenizeIdentifiers(`${pad} ${value}`)).toEqual([]);
    }
    const unicodePad = 'ا'.repeat(IDENTIFIER_TEXT_MAX - 7);
    for (const value of [
      '04465مثال@example.com',
      '04465école@example.com',
      '04465商城.example/12345',
    ]) {
      expect(tokenizeIdentifiers(`${unicodePad} ${value}`)).toEqual([]);
    }
    const quotedPad = 'ا'.repeat(IDENTIFIER_TEXT_MAX - 13);
    for (const value of [
      '"04465 مثال طويل جداً"@example.com',
      '＂04465 مثال طويل جداً＂＠example.com',
    ]) {
      expect(tokenizeIdentifiers(`${quotedPad} ${value}`)).toEqual([]);
    }
    const escapedCommentPad = 'ا'.repeat(IDENTIFIER_TEXT_MAX - 19);
    expect(
      tokenizeIdentifiers(
        `${escapedCommentPad} 04465(comment\\) مثال طويل)@example.com`,
      ),
    ).toEqual([]);
  });

  it('bounds processing before scanning multi-megabyte hostile references', () => {
    const source = resolve(__dirname, 'part-identifiers.ts');
    const script = `
      const { tokenizeIdentifiers } = await import(${JSON.stringify(source)});
      for (const text of ['A'.repeat(4 * 1024 * 1024),
        '04465-33450' + 'A'.repeat(4 * 1024 * 1024),
        'https:' + 'A'.repeat(4 * 1024 * 1024)]) {
        if (tokenizeIdentifiers(text).length !== 0) process.exit(1);
      }
    `;
    expect(() =>
      execFileSync(
        process.execPath,
        ['--experimental-strip-types', '--input-type=module', '-e', script],
        { timeout: 5000, stdio: 'pipe' },
      ),
    ).not.toThrow();
  });

  it.each([
    '04465-33450',
    '1K0/698/151',
    '1K0.698.151.A',
    '0 580 464 038',
    'A 000 420 17 20',
    '34 11 6 860 242',
    '09.A905.11',
    '6C11-2K021-AB',
    '16 087 641 80',
  ])(
    'still accepts independently typed automotive formats: %s',
    (number: string) => {
      expect(customerTextContainsIdentifier([`القطعة ${number}`], number)).toBe(
        true,
      );
    },
  );

  it('accepts a number followed by sentence punctuation', () => {
    expect(tokenizeIdentifiers('رقمه 04465-33450.')).toEqual(['0446533450']);
    expect(tokenizeIdentifiers('(04465-33450)،')).toEqual(['0446533450']);
  });

  it.each(['OEM:', 'OE:', 'PN:', 'PART:', 'P/N:'])(
    'accepts a typed number after an ordinary label %s',
    (label: string) => {
      expect(
        customerTextContainsIdentifier([`${label}04465-33450`], '04465-33450'),
      ).toBe(true);
    },
  );

  it.each(['-', '.', '/'])(
    'never scans a 17-character substring inside a longer %s-joined part',
    (separator: string) => {
      const number = ['12345', '67890', 'ABCDEFGH', 'JKLM'].join(separator);
      expect(customerTextContainsIdentifier([number], number)).toBe(true);
    },
  );

  it.each([
    ['88310-06470', '0 580 464 038'],
    ['SA03 8000 0000 6080 1016 7519', '04465-33450'],
  ])(
    'never cuts inside %s to claim a fake VIN with %s',
    (first: string, second: string) => {
      const text = `${first}، ${second}`;
      if (!first.startsWith('SA03')) {
        expect(customerTextContainsIdentifier([text], first)).toBe(true);
      }
      expect(customerTextContainsIdentifier([text], second)).toBe(true);
    },
  );

  it('quarantines an ambiguous whole grouped VIN shape until separately labeled', () => {
    // Toyota(10) + A(1) + 000(3) + 420(3) is indistinguishable from a grouped
    // VIN under a shape-only contract; no partial-piece scan is involved.
    const ambiguous = '04465-33450 A 000 420 17 20';
    expect(customerTextContainsIdentifier([ambiguous], '04465-33450')).toBe(
      false,
    );
    const labeled = 'القطعة 04465-33450 والبديل A 000 420 17 20';
    expect(customerTextContainsIdentifier([labeled], '04465-33450')).toBe(true);
    expect(customerTextContainsIdentifier([labeled], 'A 000 420 17 20')).toBe(
      true,
    );
  });
});
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
