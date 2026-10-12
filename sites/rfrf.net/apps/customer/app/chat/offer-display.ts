import type { CustomerQuoteCard } from '../actions';

export type OfferMode = 'preview' | 'live';
export type OfferTone = 'violet' | 'blue' | 'green';

export interface DisplayOffer {
  id: string;
  badge: string;
  tone: OfferTone;
  partType: string;
  supplier: string;
  marketArea: string;
  sourceLabel: string;
  qualitySignal: string;
  price: string;
  delivery: string;
  deliveryDate?: string;
  warranty: string;
  fitment?: string;
  rating?: string;
  reviews?: string;
  returnPolicy?: string;
  stock?: string;
}

const LABEL_AR: Record<string, string> = {
  BEST_OVERALL: 'موصى به',
  CHEAPEST: 'الأفضل قيمة',
  FASTEST: 'الأسرع',
  HIGHEST_WARRANTY: 'الأعلى ضماناً',
  LOWEST_RISK: 'الأكثر موثوقية',
};

function dateAfter(now: Date, days: number): string {
  const value = new Date(now);
  value.setDate(value.getDate() + days);
  return new Intl.DateTimeFormat('ar-SA', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(value);
}

function previewOffers(now: Date): DisplayOffer[] {
  return [
    {
      id: 'original-preview',
      badge: 'الأصلي',
      tone: 'violet',
      partType: 'قطعة أصلية (OEM)',
      supplier: 'وكالة معتمدة',
      marketArea: 'الرياض - مستودع وكالة',
      sourceLabel: 'توريد محلي موثق',
      qualitySignal: 'فاتورة وضمان وكالة',
      rating: '4.9',
      reviews: '3,210',
      price: '748 ر.س',
      delivery: 'خلال يومين',
      deliveryDate: dateAfter(now, 2),
      warranty: '3 سنوات',
      returnPolicy: '30 يوم استرجاع',
      stock: 'متوفر في الرياض',
      fitment: '99%',
    },
    {
      id: 'fast-preview',
      badge: 'الأسرع',
      tone: 'blue',
      partType: 'بديل ممتاز (Denso)',
      supplier: 'مورد محلي معتمد',
      marketArea: 'جدة - سوق قطع الغيار',
      sourceLabel: 'مخزون سعودي جاهز',
      qualitySignal: 'مطابقة صورة ورقم قطعة',
      rating: '4.8',
      reviews: '892',
      price: '612 ر.س',
      delivery: 'يصل غداً',
      deliveryDate: dateAfter(now, 1),
      warranty: 'سنة واحدة',
      returnPolicy: '7 أيام استرجاع',
      stock: 'متوفر في جدة',
      fitment: '97%',
    },
    {
      id: 'value-preview',
      badge: 'الأفضل قيمة',
      tone: 'green',
      partType: 'بديل عالي الجودة',
      supplier: 'مورد موثق من رفرف',
      marketArea: 'الدمام - موزع معتمد',
      sourceLabel: 'تجهيز سريع للشحن',
      qualitySignal: 'فحص توافق قبل الاعتماد',
      rating: '4.7',
      reviews: '1,248',
      price: '576 ر.س',
      delivery: 'توصيل مجاني',
      deliveryDate: dateAfter(now, 3),
      warranty: 'سنتان',
      returnPolicy: '14 يوم استرجاع',
      stock: 'متوفر الآن',
      fitment: '96%',
    },
  ];
}

function toDisplayOffer(offer: CustomerQuoteCard, index: number): DisplayOffer {
  const min = offer.deliveryDaysMin;
  const max = offer.deliveryDaysMax;
  const tone = (['violet', 'blue', 'green'] as const)[index] ?? 'green';
  const badge =
    offer.labels.map((label) => LABEL_AR[label]).find(Boolean) ?? 'عرض موثوق';
  return {
    id: offer.quoteId,
    badge,
    tone,
    partType:
      offer.sourceType === 'LOCAL' ? 'قطعة محلية معتمدة' : 'استيراد مضمون',
    supplier:
      offer.sourceType === 'LOCAL' ? 'مورد محلي معتمد' : 'مورد دولي موثوق',
    marketArea:
      offer.sourceType === 'LOCAL'
        ? 'السوق السعودي'
        : 'توريد دولي إلى السعودية',
    sourceLabel:
      offer.sourceType === 'LOCAL'
        ? 'مخزون محلي قابل للتسليم'
        : 'عرض مستورد تحت المراجعة',
    qualitySignal:
      offer.fitmentConfidence == null
        ? 'يتأكد الفريق من التوافق قبل الاعتماد'
        : `ثقة مطابقة ${Math.round(offer.fitmentConfidence * 100)}%`,
    price: `${offer.finalPrice} ${offer.currency === 'SAR' ? 'ر.س' : offer.currency}`,
    delivery:
      min == null
        ? 'بعد تأكيد المورد'
        : `${min}${max != null && max !== min ? `–${max}` : ''} ${min === 1 ? 'يوم' : 'أيام'}`,
    warranty: offer.warrantyMonths
      ? `${offer.warrantyMonths} شهراً`
      : 'حسب العرض',
    fitment:
      offer.fitmentConfidence == null
        ? undefined
        : `${Math.round(offer.fitmentConfidence * 100)}%`,
  };
}

export function buildDisplayOffers(
  offers: CustomerQuoteCard[] | undefined,
  mode: OfferMode,
  now = new Date(),
): DisplayOffer[] {
  if (mode === 'preview') return previewOffers(now);
  return (offers ?? []).slice(0, 3).map(toDisplayOffer);
}

export function approvalPayload(code: string, phone: string, quoteId: string) {
  return { code, phone, quoteId };
}
