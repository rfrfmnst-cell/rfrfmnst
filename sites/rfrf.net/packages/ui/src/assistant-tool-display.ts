export type SafeSourcingMarket = 'SAUDI' | 'GCC' | 'GLOBAL';

export interface SafeQuoteCard {
  quoteId: string;
  finalPrice: string;
  currency: string;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  warrantyMonths: number | null;
  fitmentConfidence: number | null;
  sourceType: 'LOCAL' | 'GLOBAL';
  market: SafeSourcingMarket;
  labels: string[];
}

const SAFE_QUOTE_LABELS = new Set([
  'BEST_OVERALL',
  'CHEAPEST',
  'FASTEST',
  'HIGHEST_WARRANTY',
  'LOWEST_RISK',
]);

/** بطاقة القطعة داخل المحادثة: اسم ورقم OEM وصورة من الكتالوج أو من العميل. */
export interface SafePartCard {
  name: string | null;
  oemNumber: string | null;
  imageUrl: string | null;
  imageSource: 'catalog' | 'customer' | null;
}

/** الخطوة التالية بعد اعتماد العرض: حجز بلا دفع الآن، أو الانتقال للدفع. */
export interface SafePaymentNext {
  kind: 'checkout' | 'deferred';
  trackHref: string;
}

interface ToolResultSummary {
  workflow: { label: string; nextStep: string } | null;
  quotes: SafeQuoteCard[];
  missingMarkets: SafeSourcingMarket[];
  part: SafePartCard | null;
  payment: SafePaymentNext | null;
  rfqCode: string | null;
  orderCode: string | null;
  totalAmount: string | null;
  currency: string | null;
  created: boolean | null;
  pending: boolean;
  error: string | null;
}

const CHAT_ATTACHMENT_IMAGE_PATTERN =
  /^\/api\/chat\/attachments\?key=[A-Za-z0-9%._-]{20,400}$/;
const TRACK_HREF_PATTERN = /^\/track\?code=ORD-[A-Z0-9-]{3,24}$/;

function safePartImageUrl(value: unknown): string | null {
  const url = safeString(value);
  if (!url || url.length > 2048) return null;
  if (CHAT_ATTACHMENT_IMAGE_PATTERN.test(url)) return url;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password
      ? parsed.toString()
      : null;
  } catch {
    return null;
  }
}

export function partCardResult(value: unknown): SafePartCard | null {
  const part = record(record(value)?.part);
  if (!part) return null;
  const name = safeString(part.name);
  const oemNumber = safeString(part.oemNumber);
  const imageUrl = safePartImageUrl(part.imageUrl);
  const imageSource =
    imageUrl &&
    (part.imageSource === 'catalog' || part.imageSource === 'customer')
      ? part.imageSource
      : null;
  if (!name && !oemNumber && !imageUrl) return null;
  return {
    name: name ? name.slice(0, 120) : null,
    oemNumber: oemNumber ? oemNumber.slice(0, 40) : null,
    imageUrl: imageSource ? imageUrl : null,
    imageSource,
  };
}

export function paymentNextResult(value: unknown): SafePaymentNext | null {
  const payment = record(record(value)?.payment);
  const trackHref = safeString(payment?.trackHref);
  if (
    !payment ||
    !trackHref ||
    !TRACK_HREF_PATTERN.test(trackHref) ||
    (payment.kind !== 'checkout' && payment.kind !== 'deferred')
  )
    return null;
  return { kind: payment.kind, trackHref };
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function safeString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function safeSourcingMarket(value: unknown): SafeSourcingMarket | null {
  return value === 'SAUDI' || value === 'GCC' || value === 'GLOBAL'
    ? value
    : null;
}

function safeMissingMarkets(value: unknown): SafeSourcingMarket[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .map(safeSourcingMarket)
        .filter((market): market is SafeSourcingMarket => market !== null),
    ),
  ];
}

export function quoteResult(value: unknown): SafeQuoteCard[] {
  const result = record(value);
  if (!result || !Array.isArray(result.quotes)) return [];
  return result.quotes.flatMap((quote) => {
    const item = record(quote);
    const quoteId = safeString(item?.quoteId);
    const finalPrice = safeString(item?.finalPrice);
    const currency = safeString(item?.currency);
    const fitmentConfidence =
      typeof item?.fitmentConfidence === 'number' &&
      Number.isFinite(item.fitmentConfidence) &&
      item.fitmentConfidence >= 0 &&
      item.fitmentConfidence <= 1
        ? item.fitmentConfidence
        : null;
    const sourceType =
      item?.sourceType === 'LOCAL' || item?.sourceType === 'GLOBAL'
        ? item.sourceType
        : null;
    const market = safeSourcingMarket(item?.market);
    const consistentMarket =
      sourceType === 'LOCAL'
        ? market === 'SAUDI'
        : sourceType === 'GLOBAL'
          ? market === 'GCC' || market === 'GLOBAL'
          : false;
    const labels = Array.isArray(item?.labels)
      ? item.labels.filter(
          (label): label is string =>
            typeof label === 'string' && SAFE_QUOTE_LABELS.has(label),
        )
      : [];
    if (
      !item ||
      !quoteId ||
      !finalPrice ||
      !currency ||
      !sourceType ||
      !market ||
      !consistentMarket ||
      (item.deliveryDaysMin !== null &&
        typeof item.deliveryDaysMin !== 'number') ||
      (item.deliveryDaysMax !== null &&
        typeof item.deliveryDaysMax !== 'number') ||
      (item.warrantyMonths !== null && typeof item.warrantyMonths !== 'number')
    ) {
      return [];
    }
    return [
      {
        quoteId,
        finalPrice,
        currency,
        deliveryDaysMin: item.deliveryDaysMin,
        deliveryDaysMax: item.deliveryDaysMax,
        warrantyMonths: item.warrantyMonths,
        fitmentConfidence,
        sourceType,
        market,
        labels,
      } satisfies SafeQuoteCard,
    ];
  });
}

export function summarizeToolResult(value: unknown): ToolResultSummary {
  const result = record(value);
  const code = safeString(result?.code);
  const progress = record(result?.workflow);
  const label = safeString(progress?.label);
  const nextStep = safeString(progress?.nextStep);
  return {
    workflow:
      label && label.length <= 100 && nextStep && nextStep.length <= 300
        ? { label, nextStep }
        : null,
    quotes: quoteResult(value),
    missingMarkets: safeMissingMarkets(result?.missingMarkets),
    part: partCardResult(value),
    payment: paymentNextResult(value),
    rfqCode: safeString(result?.rfqCode) ?? code,
    orderCode: safeString(result?.orderCode),
    totalAmount: safeString(result?.totalAmount),
    currency: safeString(result?.currency),
    created: typeof result?.created === 'boolean' ? result.created : null,
    pending: result?.pending === true,
    error: safeString(result?.error),
  };
}

export function maskQuoteId(value: unknown): string | null {
  const quoteId = safeString(value);
  if (!quoteId) return null;
  const suffix = quoteId.length > 6 ? quoteId.slice(-6) : quoteId.slice(-2);
  return `•••• ${suffix}`;
}

export function maskQuoteIdsInCustomerText(value: string): string {
  return value.replace(
    /(أريد اعتماد العرض المحدد بمعرّف\s+)([A-Za-z0-9_-]{10,64})/g,
    (_match, prefix: string, quoteId: string) =>
      `${prefix}${maskQuoteId(quoteId) ?? '••••'}`,
  );
}

export interface ToolReviewRow {
  label: string;
  value: string;
}

export function createRfqReviewRows(args: unknown): ToolReviewRow[] {
  const input = record(args);
  if (!input) return [];
  const rows: ToolReviewRow[] = [];
  const partText = safeString(input.partText);
  if (partText) rows.push({ label: 'القطعة', value: partText.slice(0, 120) });
  const vehicle = [input.make, input.model, input.year]
    .map(safeString)
    .filter((value): value is string => Boolean(value))
    .join(' ');
  if (vehicle) rows.push({ label: 'المركبة', value: vehicle.slice(0, 120) });
  const oemNumber = safeString(input.oemNumber);
  if (oemNumber) rows.push({ label: 'OEM', value: oemNumber.slice(0, 40) });
  return rows;
}

export function partNumberConfirmationValue(value: unknown): string | null {
  const partNumber = safeString(record(value)?.partNumber);
  return partNumber && partNumber.length <= 40 ? partNumber : null;
}
