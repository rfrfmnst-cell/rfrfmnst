import { prisma } from '@rafraf/db';
import {
  compareSourcingMarkets,
  quoteOriginCountry,
  resolveSourcingMarket,
  type SourcingMarket,
} from '@rafraf/shared/product-os/sourcing-market';
import { evaluateFitmentGate } from '@rafraf/shared/workflow/fitment-gate';
import {
  filterCustomerVisibleQuotes,
  loadLatestQuoteRiskLevels,
  loadLatestSupplierRiskLevels,
} from '../../lib/customer-quote-visibility';
import { getSessionCustomerId } from '../../lib/session';

/* ─── مقارنة العروض للعميل (Rule 2 آمنة) ─────────────────────────────
 * تُعيد فقط: السعر النهائي الواصل، مدة الوصول، الضمان، ثقة التوافق،
 * التوسيم (الأرخص/الأسرع/…)، والتوصية العربية. لا مورد، لا تكلفة، لا هامش.
 * التحقق: جلسة cu_auth الموقعة + ملكية RFQ للعميل. لا يُقبل رقم الجوال
 * من المتصفح كدليل ملكية. */

export interface CustomerQuoteCard {
  quoteId: string;
  finalPrice: string;
  currency: string;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  warrantyMonths: number | null;
  fitmentConfidence: number | null;
  sourceType: 'LOCAL' | 'GLOBAL';
  market: SourcingMarket;
  labels: string[];
}

export interface QuotesComparison {
  ok?: boolean;
  pending?: boolean;
  authRequired?: boolean;
  error?: string;
  code?: string;
  partText?: string;
  explanationAr?: string | null;
  quotes?: CustomerQuoteCard[];
  missingMarkets?: SourcingMarket[];
}

export async function getQuotesComparisonUseCase(
  codeRaw: string,
): Promise<QuotesComparison> {
  try {
    const customerId = await getSessionCustomerId();
    if (!customerId)
      return {
        authRequired: true,
        error: 'سجّل الدخول لعرض عروض طلبك بأمان.',
      };

    const code = codeRaw.trim().toUpperCase();
    if (!/^RFQ-\d{4}-\d{5}$/.test(code)) return { error: 'تأكد من رقم الطلب.' };

    const rfq = await prisma.rFQ.findFirst({
      where: { code, customerId },
      include: {
        items: {
          include: {
            part: {
              select: {
                isRestricted: true,
                sensitivity: true,
                category: {
                  select: { isRestricted: true, sensitivity: true },
                },
              },
            },
            quotes: {
              // للعميل: العروض المسعّرة المعتمدة فقط — DRAFT الوارد من المورد
              // سعر خام بلا هامش ولا يجوز كشفه (ثغرة أُغلقت 2026-07-12)
              where: { status: { in: ['ACTIVE', 'APPROVED', 'SELECTED'] } },
              orderBy: [{ decisionScore: 'desc' }, { id: 'asc' }],
              take: 60,
              include: {
                supplier: {
                  select: { status: true, id: true, countryCode: true },
                },
                sourceRegistry: { select: { country: true } },
              },
            },
            recommendations: { orderBy: { createdAt: 'desc' }, take: 1 },
          },
        },
      },
    });
    // رسالة موحّدة تمنع تعداد أكواد الطلبات التابعة لعملاء آخرين.
    if (!rfq) return { error: 'لا يوجد طلب مطابق في حسابك.' };

    const item = rfq.items[0];
    const [latestRiskByQuoteId, latestSupplierRiskById] = await Promise.all([
      loadLatestQuoteRiskLevels((item?.quotes ?? []).map((quote) => quote.id)),
      loadLatestSupplierRiskLevels(
        (item?.quotes ?? []).flatMap((quote) =>
          quote.supplier?.id ? [quote.supplier.id] : [],
        ),
      ),
    ]);
    const eligibleQuotes = item
      ? filterCustomerVisibleQuotes({
          quotes: item.quotes,
          item,
          part: item.part,
          rfqStatus: rfq.status,
          latestRiskByQuoteId,
          latestSupplierRiskById,
        })
      : [];
    const marketComparison = compareSourcingMarkets(
      eligibleQuotes.map((quote) => ({
        ...quote,
        market: resolveSourcingMarket(
          quote.sourceType,
          quoteOriginCountry(quote),
        ),
      })),
    );
    const quotes = marketComparison.quotes;
    if (
      !item ||
      !evaluateFitmentGate(item).ready ||
      !quotes.length ||
      rfq.status === 'CANCELLED'
    )
      return {
        ok: true,
        pending: true,
        code,
        partText: item?.freeTextAr ?? undefined,
        missingMarkets: marketComparison.missingMarkets,
      };

    // Rule 2: توصية الأدمن تتضمن أسماء موردين — نولّد للعميل صيغة عامة آمنة
    const bestIsCheapest = quotes.some(
      (quote) =>
        quote.labels.includes('BEST_OVERALL') &&
        quote.labels.includes('CHEAPEST'),
    );
    const safeExplanation =
      quotes.length > 1
        ? bestIsCheapest
          ? 'ترشيحنا هو الأوفر أيضاً — أعلى توازن بين السعر والتوافق والموثوقية.'
          : 'ترشيحنا ليس الأرخص، لكنه الأعلى توازناً بين التوافق والموثوقية والسرعة والضمان — الفرق يستحق.'
        : 'هذا أفضل عرض متاح لطلبك حالياً — سعر نهائي واصل بلا مفاجآت.';

    return {
      ok: true,
      code,
      partText: item?.freeTextAr ?? undefined,
      explanationAr: safeExplanation,
      missingMarkets: marketComparison.missingMarkets,
      quotes: quotes.map((q) => ({
        quoteId: q.id,
        finalPrice: q.finalPrice.toFixed(2),
        currency: q.currency,
        deliveryDaysMin: q.deliveryDaysMin,
        deliveryDaysMax: q.deliveryDaysMax,
        warrantyMonths: q.warrantyMonths,
        fitmentConfidence:
          q.fitmentConfidence != null ? Number(q.fitmentConfidence) : null,
        sourceType: q.sourceType as 'LOCAL' | 'GLOBAL',
        market: q.market,
        labels: q.labels as string[],
      })),
    };
  } catch (e) {
    console.error('getQuotesComparison failed:', e);
    return { error: 'تعذّر جلب العروض الآن. جرّب بعد قليل.' };
  }
}
