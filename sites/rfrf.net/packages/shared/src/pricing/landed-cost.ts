/**
 * Landed Cost calculator — pure, no I/O.
 * Source of truth: docs/BUSINESS_RULES.md "Landed cost formula" + Rules 2 & 3.
 *
 * CRITICAL (Rule 2): the customer-visible breakdown must NEVER be derivable back
 * into supplier cost or margin. We expose only: part price (a bundled customer
 * figure = final − shipping − tax), shipping, warranty (months), tax.
 * All internal components live in internalCostBreakdown (ADMIN ONLY).
 */

export interface LandedCostInput {
  supplierPrice: number;
  localShipping?: number;
  intlShipping?: number;
  customsEstimate?: number;
  complianceCost?: number;
  inspectionFee?: number;
  paymentFee?: number;
  packagingFee?: number;
  riskBuffer?: number;
  platformMargin?: number;
  /**
   * نسبة ضريبة القيمة المضافة ككسر عشري. المسار الطبيعي: تُمرَّر من
   * `resolveVatRate` فتُشتقّ الضريبة من الوعاء الخاضع.
   */
  vatRate?: number;
  /**
   * تجاوز صريح لمبلغ الضريبة، للحالات المعفاة أو المسعّرة خارجياً.
   *
   * موجود لأن الإعفاء واقع لا استثناء نظري، ولا يُستعمل لإدخال رقم يدوي في
   * المسار العادي: تركه فارغاً مع `vatRate` هو الطريق الصحيح، والاشتقاق أدقّ
   * من أي رقم يكتبه مشغّل على عجل.
   */
  taxAmount?: number;
  warrantyMonths?: number;
  currency?: string;
}

/** Safe to expose to the customer (Rule 2). Reveals no cost or margin. */
export interface CustomerVisibleBreakdown {
  partPrice: number; // bundled: final − shipping − tax
  shipping: number;
  tax: number;
  warrantyMonths: number;
  currency: string;
}

/** ADMIN ONLY (Rule 3). RBAC must forbid customer/supplier access. */
export interface InternalCostBreakdown {
  supplierPrice: number;
  localShipping: number;
  intlShipping: number;
  customsEstimate: number;
  complianceCost: number;
  inspectionFee: number;
  paymentFee: number;
  packagingFee: number;
  riskBuffer: number;
  platformMargin: number;
  taxAmount: number;
  netProfit: number;
  currency: string;
}

export interface LandedCostResult {
  totalLandedCost: number; // == customer final price
  customerVisibleBreakdown: CustomerVisibleBreakdown;
  internalCostBreakdown: InternalCostBreakdown;
}

const round2 = (n: number): number =>
  Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Landed Cost =
 *   Supplier Price + Local Shipping + International Shipping + Customs Estimate
 * + Compliance Cost + Inspection Fee + Payment Fee + Packaging Fee
 * + Risk Buffer + Platform Margin + Tax Amount
 */
export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const supplierPrice = input.supplierPrice;
  const localShipping = input.localShipping ?? 0;
  const intlShipping = input.intlShipping ?? 0;
  const customsEstimate = input.customsEstimate ?? 0;
  const complianceCost = input.complianceCost ?? 0;
  const inspectionFee = input.inspectionFee ?? 0;
  const paymentFee = input.paymentFee ?? 0;
  const packagingFee = input.packagingFee ?? 0;
  const riskBuffer = input.riskBuffer ?? 0;
  const platformMargin = input.platformMargin ?? 0;
  const currency = input.currency ?? 'SAR';

  // الوعاء الخاضع هو كل ما يسبق الضريبة. اشتقاقه هنا يمنع الحالة التي كانت
  // قائمة: حقل ضريبة يدوي يبقى صفراً بينما واجهة العميل تعده بأن السعر شاملها.
  const taxableBase = round2(
    supplierPrice +
      localShipping +
      intlShipping +
      customsEstimate +
      complianceCost +
      inspectionFee +
      paymentFee +
      packagingFee +
      riskBuffer +
      platformMargin,
  );

  // التجاوز الصريح يسبق الاشتقاق، والصفر الصريح إعفاء مقصود لا قيمة مفقودة.
  // نفس قاعدة `computeVat` في `./vat.ts` وهي التعريف المرجعي. مكرّرة هنا لأن
  // هذا الملف يُحمَّل مصدراً في اختبارات العقد، ومحمّل Node لا يحلّ استيراداً
  // نسبياً بلا امتداد. اختبار في `pricing.spec.ts` يؤكّد تطابق الطريقين.
  const taxAmount =
    input.taxAmount !== undefined
      ? round2(input.taxAmount)
      : input.vatRate !== undefined
        ? round2(taxableBase * input.vatRate)
        : 0;

  const totalLandedCost = round2(taxableBase + taxAmount);

  const shipping = round2(localShipping + intlShipping);
  // Bundled part price hides every internal component behind one number.
  const partPrice = round2(totalLandedCost - shipping - taxAmount);

  // netProfit = margin minus the risk buffer we reserve against this deal.
  const netProfit = round2(platformMargin - riskBuffer);

  return {
    totalLandedCost,
    customerVisibleBreakdown: {
      partPrice,
      shipping,
      tax: round2(taxAmount),
      warrantyMonths: input.warrantyMonths ?? 0,
      currency,
    },
    internalCostBreakdown: {
      supplierPrice: round2(supplierPrice),
      localShipping: round2(localShipping),
      intlShipping: round2(intlShipping),
      customsEstimate: round2(customsEstimate),
      complianceCost: round2(complianceCost),
      inspectionFee: round2(inspectionFee),
      paymentFee: round2(paymentFee),
      packagingFee: round2(packagingFee),
      riskBuffer: round2(riskBuffer),
      platformMargin: round2(platformMargin),
      taxAmount: round2(taxAmount),
      netProfit,
      currency,
    },
  };
}
