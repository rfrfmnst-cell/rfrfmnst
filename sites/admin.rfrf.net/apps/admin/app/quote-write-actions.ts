'use server';

import { randomInt } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import {
  ActorType,
  Prisma,
  QuoteSourceType,
  QuoteStatus,
  RFQStatus,
  prisma,
} from '@rafraf/db';
import { recordReviewedRisk } from '@rafraf/orders/src/risk-assessment-writer.ts';
import { rfqDecisionLockKey } from '@rafraf/shared/product-os/rfq-decision-lock';
import { matchesVehiclePartCompatibility } from '@rafraf/shared/product-os/fitment-match';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import {
  boundedFitmentConfidence,
  isVerifiedFitment,
} from '@rafraf/shared/product-os/quote-policy';
import {
  isSourcingMarket,
  sourceCountryForMarket,
} from '@rafraf/shared/product-os/sourcing-market';
import { computeLandedCost } from '@rafraf/shared/pricing/landed-cost';
import { resolveVatRate } from '@rafraf/shared/pricing/vat';
import { completeHumanFitmentReview } from '../lib/fitment-review';
import {
  parseIncomingQuoteCurrencyAmount,
  priceIncomingSupplierQuote,
  isRiskLevel,
  isPriceableRfqStatus,
} from '../lib/incoming-quote-pricing';
import { recomputeRankingInTransaction } from '../lib/recompute-ranking';
import { requireAdminPermission } from '../lib/require-admin-session';

function num(fd: FormData, k: string): number {
  const v = Number(String(fd.get(k) ?? '').trim());
  return Number.isFinite(v) ? v : 0;
}

function quoteCode(): string {
  return `Q-${randomInt(100000, 1000000)}`;
}

/** إضافة عرض يدوي لعنصر RFQ: يحسب Landed Cost ويخزّن Quote + LandedCost. */
export async function addQuote(fd: FormData): Promise<{ error?: string }> {
  const admin = await requireAdminPermission('QUOTE_WRITE');
  const rfqItemId = String(fd.get('rfqItemId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!rfqItemId || !rfqId) return { error: 'طلب غير صالح.' };

  const supplierName = String(fd.get('supplierName') ?? '').trim();
  if (!supplierName) return { error: 'اسم المورد مطلوب.' };
  const supplierPrice = num(fd, 'supplierPrice');
  if (supplierPrice <= 0) return { error: 'سعر المورد غير صالح.' };

  const marketValue = String(fd.get('market') ?? '').trim();
  if (!isSourcingMarket(marketValue)) return { error: 'سوق المصدر غير صالح.' };

  const sourceCountry = sourceCountryForMarket(
    marketValue,
    fd.get('sourceCountry'),
  );
  if (!sourceCountry)
    return { error: 'رمز بلد المصدر لا يطابق السوق المختار.' };

  const sourceName = String(fd.get('sourceName') ?? '').trim();
  if (
    marketValue !== 'SAUDI' &&
    (sourceName.length < 2 || sourceName.length > 120)
  )
    return { error: 'اسم المصدر الخارجي مطلوب.' };

  const sourceType =
    marketValue === 'SAUDI' ? QuoteSourceType.LOCAL : QuoteSourceType.GLOBAL;

  const lc = computeLandedCost({
    supplierPrice,
    localShipping: num(fd, 'localShipping'),
    intlShipping: num(fd, 'intlShipping'),
    customsEstimate: num(fd, 'customsEstimate'),
    inspectionFee: num(fd, 'inspectionFee'),
    paymentFee: num(fd, 'paymentFee'),
    packagingFee: num(fd, 'packagingFee'),
    riskBuffer: num(fd, 'riskBuffer'),
    platformMargin: num(fd, 'platformMargin'),
    // الضريبة تُشتقّ من الوعاء الخاضع؛ لم تعد رقماً يكتبه المشغّل.
    vatRate: resolveVatRate(process.env.VAT_RATE),
    warrantyMonths: num(fd, 'warrantyMonths'),
  });

  const riskLevel = String(fd.get('riskLevel') ?? '').trim();
  if (!isRiskLevel(riskLevel))
    return { error: 'اختر مستوى المخاطر بعد المراجعة.' };

  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(rfqId)}))`;
      const item = await tx.rFQItem.findUnique({
        where: { id: rfqItemId },
        select: {
          rfqId: true,
          rfq: { select: { status: true, updatedAt: true } },
          partId: true,
          fitmentConfidence: true,
          humanReviewRequired: true,
          part: {
            select: {
              isRestricted: true,
              sensitivity: true,
              category: { select: { isRestricted: true, sensitivity: true } },
            },
          },
        },
      });
      if (!item || item.rfqId !== rfqId) {
        return { error: 'عنصر الطلب غير صالح.' };
      }
      if (!isPriceableRfqStatus(item.rfq.status)) {
        return { error: 'حالة الطلب الحالية لا تسمح بإضافة عرض جديد.' };
      }
      if (!isVerifiedFitment(item)) {
        return {
          error: 'يجب تثبيت القطعة واجتياز مراجعة التوافق قبل تفعيل العرض.',
        };
      }
      if (isPartCommerceRestricted(item.part)) {
        return { error: 'هذه الفئة مقيّدة وغير متاحة للتوريد أو البيع.' };
      }

      const effectiveFitment = boundedFitmentConfidence(
        num(fd, 'fitmentConfidence'),
        item.fitmentConfidence,
      );

      const supplier = await tx.supplier.findFirst({
        where: { businessName: supplierName, status: 'APPROVED' },
        select: { id: true },
      });
      if (!supplier) {
        return { error: 'اختر مورداً معتمداً مسجلاً قبل إنشاء العرض.' };
      }

      const rfqUpdated = await tx.rFQ.updateMany({
        where: {
          id: rfqId,
          status: item.rfq.status,
          updatedAt: item.rfq.updatedAt,
        },
        data: { status: RFQStatus.QUOTES_READY },
      });
      if (rfqUpdated.count !== 1)
        return { error: 'تغير الطلب أثناء المراجعة. حدّث الصفحة.' };
      let sourceRegistryId: string | null = null;
      if (marketValue !== 'SAUDI') {
        const registryLock = `source-registry:${sourceCountry}:${sourceName.toLowerCase()}`;
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${registryLock}))`;

        const sourceRegistry =
          (await tx.sourceRegistry.findFirst({
            where: {
              name: sourceName,
              type: QuoteSourceType.GLOBAL,
              country: sourceCountry,
              isActive: true,
            },
            select: { id: true },
          })) ??
          (await tx.sourceRegistry.create({
            data: {
              name: sourceName,
              type: QuoteSourceType.GLOBAL,
              country: sourceCountry,
              notes: 'manual_admin_quote',
            },
            select: { id: true },
          }));
        sourceRegistryId = sourceRegistry.id;
      }

      const quote = await tx.quote.create({
        data: {
          code: quoteCode(),
          rfqItemId,
          supplierId: supplier.id,
          sourceRegistryId,
          sourceType,
          partId: item.partId,
          finalPrice: new Prisma.Decimal(lc.totalLandedCost),
          deliveryDaysMin: num(fd, 'deliveryDays') || null,
          deliveryDaysMax: num(fd, 'deliveryDays') || null,
          warrantyMonths: Math.round(num(fd, 'warrantyMonths')),
          fitmentConfidence: effectiveFitment,
          riskLevel,
          status: QuoteStatus.ACTIVE,
          landedCost: {
            create: {
              supplierPrice: new Prisma.Decimal(supplierPrice),
              localShipping: new Prisma.Decimal(num(fd, 'localShipping')),
              intlShipping: new Prisma.Decimal(num(fd, 'intlShipping')),
              customsEstimate: new Prisma.Decimal(num(fd, 'customsEstimate')),
              inspectionFee: new Prisma.Decimal(num(fd, 'inspectionFee')),
              paymentFee: new Prisma.Decimal(num(fd, 'paymentFee')),
              packagingFee: new Prisma.Decimal(num(fd, 'packagingFee')),
              riskBuffer: new Prisma.Decimal(num(fd, 'riskBuffer')),
              platformMargin: new Prisma.Decimal(num(fd, 'platformMargin')),
              // القيمة المحسوبة لا المُدخَلة: تخزين رقم يدوي هنا يجعل
              // الصفّ يناقض `totalLandedCost` المحسوب فوقه.
              taxAmount: new Prisma.Decimal(lc.internalCostBreakdown.taxAmount),
              totalLandedCost: new Prisma.Decimal(lc.totalLandedCost),
              customerVisibleBreakdown:
                lc.customerVisibleBreakdown as unknown as Prisma.InputJsonValue,
              internalCostBreakdown:
                lc.internalCostBreakdown as unknown as Prisma.InputJsonValue,
            },
          },
        },
      });

      const riskAssessmentId = await recordReviewedRisk(tx, {
        entityType: 'quote',
        entityId: quote.id,
        actorId: admin.userId,
        riskLevel,
        reasonCode: 'QUOTE_REVIEW',
      });
      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'quote.created.manual',
          entityType: 'quote',
          entityId: quote.id,
          after: {
            riskAssessmentId,
            rfqItemId,
            supplierId: supplier.id,
            sourceType,
            market: marketValue,
            sourceCountry,
          },
        },
      });
      await recomputeRankingInTransaction(tx, rfqItemId);
      return {};
    });

    if ('error' in outcome && outcome.error) return outcome;
    revalidatePath(`/rfq/${rfqId}`);
    revalidatePath('/');
    return {};
  } catch (e) {
    console.error('addQuote failed:', e instanceof Error ? e.name : 'UNKNOWN');
    return { error: 'تعذّر حفظ العرض.' };
  }
}
/** ربط عنصر RFQ بقطعة من الكتالوج + توريث ثقة التوافق من أعلى
 *  PartCompatibility مطابق لمركبة الطلب (الماركة+الموديل+السنة ضمن المدى). */
export async function linkPartToItem(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('CATALOG_WRITE');
  const rfqItemId = String(fd.get('rfqItemId') ?? '');
  const partId = String(fd.get('partId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!rfqItemId || !partId || !rfqId) return;

  const changed = await prisma.$transaction(async (tx) => {
    // Share the customer's order-creation lock: an ordered RFQ is immutable.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(rfqId)}))`;
    const item = await tx.rFQItem.findUnique({
      where: { id: rfqItemId },
      include: { rfq: { include: { vehicle: true } } },
    });
    if (
      !item ||
      item.rfqId !== rfqId ||
      item.rfq.status === RFQStatus.CONVERTED_TO_ORDER
    )
      return false;
    const ordered = await tx.order.findFirst({
      where: { OR: [{ rfqId }, { quote: { rfqItem: { rfqId } } }] },
      select: { id: true },
    });
    if (ordered) return false;

    let confidence: number | null = null;
    const veh = item.rfq.vehicle;
    if (veh) {
      const candidates = await tx.partCompatibility.findMany({
        where: {
          partId,
          make: { equals: veh.make, mode: 'insensitive' },
          model: { equals: veh.model, mode: 'insensitive' },
          yearFrom: { lte: veh.year },
          yearTo: { gte: veh.year },
        },
        orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
      });
      const compat = candidates.find((candidate) =>
        matchesVehiclePartCompatibility(veh, candidate),
      );
      confidence = compat?.confidence ?? null;
    }

    await tx.rFQItem.update({
      where: { id: rfqItemId },
      data: {
        partId,
        fitmentConfidence: confidence,
        humanReviewRequired: true,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: admin.userId,
        actorType: ActorType.ADMIN,
        action: 'rfq.item.part_linked',
        entityType: 'rfq_item',
        entityId: rfqItemId,
        after: {
          partId,
          fitmentConfidence: confidence,
          humanReviewRequired: true,
        },
      },
    });
    return true;
  });
  if (changed) revalidatePath(`/rfq/${rfqId}`);
}

/** اعتماد بشري صريح للتوافق بعد ربط قطعة وتوافق كتالوج موثوق بنسبة 85% فأعلى. */
export async function approveFitmentReview(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('FITMENT_APPROVE');

  const rfqItemId = String(fd.get('rfqItemId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!rfqItemId || !rfqId) return;

  try {
    await completeHumanFitmentReview({
      rfqItemId,
      rfqId,
      actorId: admin.userId,
    });
  } catch (error) {
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String(error.code)
        : 'UNKNOWN';
    console.error('approveFitmentReview failed:', code);
    return;
  }
  revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/');
}

/** تسعير عرض وارد من بوابة المورد (DRAFT بسعر خام) → عرض مكتمل ACTIVE.
 * سعر المورد الحالي في finalPrice يُعامل مدخلاً لمحرك Landed Cost. */
export async function priceIncomingQuote(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('QUOTE_WRITE');
  const quoteId = String(fd.get('quoteId') ?? '');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!quoteId || !rfqId) return;
  const risk = String(fd.get('riskLevel') ?? '').trim();
  const result = await priceIncomingSupplierQuote({
    actorId: admin.userId,
    quoteId,
    rfqId,
    localShipping: parseIncomingQuoteCurrencyAmount(fd.get('localShipping')),
    riskBuffer: parseIncomingQuoteCurrencyAmount(fd.get('riskBuffer')),
    platformMargin: parseIncomingQuoteCurrencyAmount(fd.get('platformMargin')),
    fitmentConfidence: num(fd, 'fitmentConfidence'),
    riskLevel: risk,
    vatRate: resolveVatRate(process.env.VAT_RATE),
  });
  if (result.outcome !== 'APPLIED') return;

  revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/');
}
