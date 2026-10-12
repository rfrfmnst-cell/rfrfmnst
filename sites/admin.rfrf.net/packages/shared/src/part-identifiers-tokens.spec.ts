import {
  IDENTIFIER_TEXT_MAX,
  IDENTIFIER_TOKENS_MAX,
  customerTextContainsIdentifier,
  tokenizeIdentifiers,
} from './part-identifiers';

describe('part identifier tokens', () => {
  describe('tokenizeIdentifiers', () => {
    it('keeps a number and a year apart when Arabic words separate them', () => {
      expect(
        tokenizeIdentifiers('أبي كمبروسر رقمه 88310-06470 لكامري 2018'),
      ).toEqual(['8831006470', '2018']);
    });

    it('also returns the merged value when the pieces are adjacent', () => {
      expect(tokenizeIdentifiers('رقمه 88310-06470 2018')).toEqual([
        '8831006470',
        '88310064702018',
        '2018',
      ]);
    });

    it('finds spaced part numbers inside Arabic sentences', () => {
      const bosch = tokenizeIdentifiers('أبغى فحمات رقمها 0 986 452 041 أصلية');
      expect(bosch).toContain('0986452041');
      const mercedes = tokenizeIdentifiers(
        'رقم القطعة A 000 420 17 20 من فضلك',
      );
      expect(mercedes).toContain('A0004201720');
      const bmw = tokenizeIdentifiers('رقم BMW هو 34 11 6 860 242');
      expect(bmw).toContain('34116860242');
    });

    it('normalizes Arabic-Indic, Persian, full-width and lowercase text', () => {
      expect(tokenizeIdentifiers('رقمه ٠٤٤٦٥-٣٣٤٥٠')).toEqual(['0446533450']);
      expect(tokenizeIdentifiers('رقمه ۰۴۴۶۵-۳۳۴۵۰')).toEqual(['0446533450']);
      expect(tokenizeIdentifiers('رقمه ９０９１５－ｙｚｚｄ２')).toEqual([
        '90915YZZD2',
      ]);
      expect(tokenizeIdentifiers('فلتر 90915-yzzd2')).toEqual(['90915YZZD2']);
    });

    it('breaks runs on Arabic letters, the Arabic comma and other symbols', () => {
      expect(tokenizeIdentifiers('رقمه88310-06470لكامري')).toEqual([
        '8831006470',
      ]);
      expect(tokenizeIdentifiers('04465-33450، 90915-YZZD2')).toEqual([
        '0446533450',
        '90915YZZD2',
      ]);
      expect(tokenizeIdentifiers('04465-33450 + 90915-YZZD2')).toEqual([
        '0446533450',
        '90915YZZD2',
      ]);
    });

    it('never splits inside a piece, so no substring becomes a token', () => {
      const tokens = tokenizeIdentifiers('رقمه 1234567 و 88310-06470');
      expect(tokens).toEqual(['1234567', '8831006470']);
      expect(tokens).not.toContain('2345');
      expect(tokens).not.toContain('88310');
    });

    it('drops VIN-shaped tokens and never yields substrings of a VIN', () => {
      expect(tokenizeIdentifiers('رقم الهيكل 1HGCM82633A004352')).toEqual([]);
      expect(tokenizeIdentifiers('الهيكل 1HGCM 82633A004352 تم')).toEqual([]);
      expect(tokenizeIdentifiers('الهيكل 1HGCM 82633 A004352')).toEqual([]);
      expect(tokenizeIdentifiers('JTD KB20U7 93 123456')).toEqual([]);
      expect(tokenizeIdentifiers('WVW ZZZ 1K Z 6W 123456')).toEqual([]);
    });

    it('never joins a VIN to the pieces next to it', () => {
      expect(tokenizeIdentifiers('شاصي JTDKB20U793123456 2018')).toEqual([
        '2018',
      ]);
      expect(tokenizeIdentifiers('1HGCM82633A004352-2018')).toEqual([]);
      expect(
        tokenizeIdentifiers('الهيكل 1HGCM82633A004352 04465-33450'),
      ).toEqual(['0446533450']);
    });

    it('keeps a Saudi mobile whole and never yields its fragments', () => {
      expect(tokenizeIdentifiers('جوالي 055 123 4567')).toEqual(['0551234567']);
      expect(tokenizeIdentifiers('جوالي +966 55 123 4567')).toEqual([
        '966551234567',
      ]);
      expect(tokenizeIdentifiers('00966 55 123 4567')).toEqual([
        '00966551234567',
      ]);
      expect(tokenizeIdentifiers('رقمها 0 580 464 038')).toEqual([
        '0580464038',
      ]);
    });

    it('drops URLs without a scheme', () => {
      expect(tokenizeIdentifiers('https://example.com/part/12345')).toEqual([]);
      expect(
        tokenizeIdentifiers('الرابط www.example.com/12345 04465-33450'),
      ).toEqual(['0446533450']);
    });

    it('reads slash and underscore separated numbers', () => {
      expect(tokenizeIdentifiers('رقمه 1K0/698/151')).toEqual(['1K0698151']);
      expect(tokenizeIdentifiers('رقمه 04465_33450')).toEqual(['0446533450']);
    });

    it('does not split on invisible characters or fold trademark signs', () => {
      expect(tokenizeIdentifiers('04465\u200B-33450')).toEqual(['0446533450']);
      expect(tokenizeIdentifiers('04465\u00AD33450')).toEqual(['0446533450']);
      expect(tokenizeIdentifiers('رقمه 04465-33450\u2122')).toEqual([
        '0446533450',
      ]);
      expect(tokenizeIdentifiers('04465-33450\u00B2 قطعتين')).toEqual([
        '0446533450',
      ]);
    });

    it('drops letter-only words, URLs without digits and emails without digits', () => {
      expect(
        tokenizeIdentifiers(
          'I NEED A FILTER see https://example.com or a@b.co',
        ),
      ).toEqual([]);
    });

    it('strips fixed client templates before tokenizing', () => {
      const template =
        'أريد اعتماد العرض المحدد بمعرّف cmq1x2y3z4. اعرض عليّ بطاقة الموافقة قبل التنفيذ.';
      expect(tokenizeIdentifiers(template)).toContain('CMQ1X2Y3Z4');
      expect(tokenizeIdentifiers(template, { exclude: [template] })).toEqual(
        [],
      );
      expect(
        tokenizeIdentifiers(`${template} ورقم القطعة 04465-33450`, {
          exclude: [template],
        }),
      ).toEqual(['0446533450']);
    });

    it('removes glued identifier text with a template instead of cutting it', () => {
      const template = 'TEMPLATE';
      expect(
        tokenizeIdentifiers(`12${template}345 04465`, { exclude: [template] }),
      ).toEqual(['04465']);
      expect(tokenizeIdentifiers('رقمه X12345', { exclude: ['X1'] })).toEqual(
        [],
      );
      expect(tokenizeIdentifiers('AB1234567', { exclude: ['B'] })).toEqual([]);
      expect(
        tokenizeIdentifiers('04465أريد 33450', { exclude: ['أريد'] }),
      ).toEqual(['04465', '33450']);
      expect(tokenizeIdentifiers('رقم 04465', { exclude: ['', '  '] })).toEqual(
        ['04465'],
      );
    });

    it('caps a candidate at 8 whole pieces', () => {
      const tokens = tokenizeIdentifiers('11 22 33 44 55 66 77 88 99');
      expect(tokens).toContain('1122334455667788');
      expect(tokens).toContain('2233445566778899');
      expect(tokens).not.toContain('112233445566778899');
    });

    it('stops extending a span past 40 display characters', () => {
      const tokens = tokenizeIdentifiers(
        '1234567890 1234567890 1234567890 1234567890 5',
      );
      expect(tokens).toContain('123456789012345678901234567890');
      expect(tokens.every((token) => token.length <= 40)).toBe(true);
      expect(tokens).toContain('12345678905');
    });

    it('caps the output size and keeps the earliest candidates', () => {
      const values = Array.from(
        { length: 300 },
        (_, index) => `${1000 + index}`,
      );
      const tokens = tokenizeIdentifiers(values.join(' و '));
      expect(IDENTIFIER_TOKENS_MAX).toBe(256);
      expect(tokens).toEqual(values.slice(0, IDENTIFIER_TOKENS_MAX));
    });

    it('drops the run cut by the text limit', () => {
      const pad = 'ا'.repeat(IDENTIFIER_TEXT_MAX - 8);
      expect(tokenizeIdentifiers(`${pad} 04465-33450`)).toEqual([]);
      expect(tokenizeIdentifiers(`${pad} 0446 1HGCM 82633 A004352`)).toEqual(
        [],
      );
      expect(tokenizeIdentifiers(`${pad} 04465 و 1234567`)).toEqual(['04465']);
    });

    it('returns nothing for empty or symbol-only text', () => {
      expect(tokenizeIdentifiers('')).toEqual([]);
      expect(tokenizeIdentifiers('؟؟ !! ...')).toEqual([]);
    });
  });

  describe('customerTextContainsIdentifier', () => {
    it('confirms an exact compact match regardless of formatting', () => {
      const texts = ['السلام عليكم', 'رقم القطعة ٠٤٤٦٥ ٣٣٤٥٠ لو سمحت'];
      expect(customerTextContainsIdentifier(texts, '04465-33450')).toBe(true);
      expect(customerTextContainsIdentifier(texts, '0446533450')).toBe(true);
      expect(
        customerTextContainsIdentifier(['فحمات 0 986 452 041'], '0986452041'),
      ).toBe(true);
    });

    it('never confirms a substring of a typed value', () => {
      expect(customerTextContainsIdentifier(['1234567'], '2345')).toBe(false);
      expect(customerTextContainsIdentifier(['1234567'], '1234567')).toBe(true);
      expect(customerTextContainsIdentifier(['88310-06470'], '88310')).toBe(
        false,
      );
    });

    it('does not merge numbers across Arabic words', () => {
      const texts = ['أبي كمبروسر رقمه 88310-06470 لكامري 2018'];
      expect(customerTextContainsIdentifier(texts, '88310-06470')).toBe(true);
      expect(customerTextContainsIdentifier(texts, '88310-06470-2018')).toBe(
        false,
      );
      expect(
        customerTextContainsIdentifier(
          ['88310-06470 2018'],
          '88310-06470-2018',
        ),
      ).toBe(true);
    });

    it('never confirms part of a spaced VIN or phone', () => {
      expect(
        customerTextContainsIdentifier(
          ['الهيكل 1HGCM 82633 A004352'],
          '1HGCM82633',
        ),
      ).toBe(false);
      expect(
        customerTextContainsIdentifier(
          ['الهيكل 1HGCM 82633A004352 تم'],
          '82633A004352',
        ),
      ).toBe(false);
      expect(
        customerTextContainsIdentifier(
          ['1HGCM82633A004352 2018'],
          '1HGCM82633A004352-2018',
        ),
      ).toBe(false);
      expect(
        customerTextContainsIdentifier(['جوالي 055 123 4567'], '1234567'),
      ).toBe(false);
    });

    it('confirms slash-separated numbers and ignores invisible splits', () => {
      expect(
        customerTextContainsIdentifier(['رقمه 1K0/698/151'], '1K0698151'),
      ).toBe(true);
      expect(
        customerTextContainsIdentifier(['04465\u200B-33450'], '04465-33450'),
      ).toBe(true);
      expect(
        customerTextContainsIdentifier(['04465\u200B-33450'], '33450'),
      ).toBe(false);
    });

    it('never confirms a VIN-shaped value, typed or not', () => {
      const vin = '1HGCM82633A004352';
      expect(customerTextContainsIdentifier([`رقم الهيكل ${vin}`], vin)).toBe(
        false,
      );
      expect(customerTextContainsIdentifier([vin], vin.slice(0, 5))).toBe(
        false,
      );
      expect(customerTextContainsIdentifier([vin], vin.slice(5))).toBe(false);
    });

    it('confirms 17-character part numbers that are not VIN-shaped', () => {
      expect(
        customerTextContainsIdentifier(
          ['رقمها 1234567890ABCDEFO'],
          '1234567890abcdefo',
        ),
      ).toBe(true);
    });

    it('rejects implausible values even when the compact form matches', () => {
      expect(
        customerTextContainsIdentifier(['04465-33450'], '04465--33450'),
      ).toBe(false);
      expect(customerTextContainsIdentifier(['04465-33450'], '')).toBe(false);
    });

    it('ignores identifiers inside excluded templates', () => {
      const template =
        'أريد اعتماد العرض المحدد بمعرّف cmq1x2y3z4. اعرض عليّ بطاقة الموافقة قبل التنفيذ.';
      expect(customerTextContainsIdentifier([template], 'cmq1x2y3z4')).toBe(
        true,
      );
      expect(
        customerTextContainsIdentifier([template], 'cmq1x2y3z4', {
          exclude: [template],
        }),
      ).toBe(false);
    });

    it('returns false with no customer text', () => {
      expect(customerTextContainsIdentifier([], '04465-33450')).toBe(false);
    });
  });
});
