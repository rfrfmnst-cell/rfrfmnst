/**
 * احتساب ضريبة القيمة المضافة — نقي بلا I/O.
 *
 * النسبة **إعداد لا ثابت في الكود**، على نمط `COMPLAINT_WINDOW_HOURS`: قيمة
 * نظامية لا يجوز أن يخمّنها المطوّر ولا أن تُدفن في ملف مصدر يحتاج إصداراً
 * جديداً لتغييرها.
 *
 * وبفارق واحد مقصود عن نافذة الشكوى: **لا افتراضي صامت هنا**. النافذة الغائبة
 * تعني انتظاراً أطول أو أقصر، أما النسبة الغائبة فتعني ضريبة صفر تمرّ إلى سعر
 * العميل بينما الواجهة تعده بأن السعر شاملها. الصمت هناك مقبول، وهنا هو العطب
 * نفسه المراد منعه — فالغياب يُرمى بدل أن يُفترض.
 */

/** أعلى نسبة يقبلها المدقّق. ما فوقها خطأ إدخال لا سياسة ضريبية. */
const MAX_VAT_RATE = 1;

export class VatRateNotConfiguredError extends Error {
  constructor(reason: string) {
    super(`VAT_RATE ${reason}`);
    this.name = 'VatRateNotConfiguredError';
  }
}

function round2(n: number): number {
  return Math.round((n + Number.EPSILON) * 100) / 100;
}

/**
 * يقرأ النسبة من الإعداد ويتحقّق منها. كسر عشري لا نسبة مئوية: `0.15` لا `15`.
 *
 * الرقم يأتي من المستشار الضريبي ويُضبط في البيئة. لا قيمة افتراضية هنا عمداً —
 * راجع رأس الملف.
 */
export function resolveVatRate(raw: unknown): number {
  if (raw === undefined || raw === null || raw === '') {
    throw new VatRateNotConfiguredError('is not set');
  }

  const parsed =
    typeof raw === 'number' ? raw : typeof raw === 'string' ? Number(raw) : NaN;

  if (!Number.isFinite(parsed)) {
    throw new VatRateNotConfiguredError('is not a number');
  }
  if (parsed < 0) {
    throw new VatRateNotConfiguredError('cannot be negative');
  }
  // نسبة أكبر من واحد تعني غالباً أن أحدهم كتب 15 وهو يقصد 0.15. الرفض أأمن من
  // قبولها وتحصيل خمسة عشر ضعف السعر.
  if (parsed > MAX_VAT_RATE) {
    throw new VatRateNotConfiguredError(
      'must be a fraction such as 0.15, not a percentage',
    );
  }

  return parsed;
}

export interface VatInput {
  /** الوعاء الخاضع: مجموع المركّبات قبل الضريبة. */
  taxableBase: number;
  rate: number;
}

/** مبلغ الضريبة على الوعاء، مقرَّباً لخانتين كبقية أرقام التسعير. */
export function computeVat(input: VatInput): number {
  if (!Number.isFinite(input.taxableBase) || input.taxableBase < 0) {
    throw new Error('VAT requires a non-negative, finite taxable base');
  }
  return round2(input.taxableBase * input.rate);
}
