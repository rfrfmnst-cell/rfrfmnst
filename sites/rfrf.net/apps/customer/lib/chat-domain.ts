import { randomInt } from 'node:crypto';
import {
  ActorType,
  AIDecisionKind,
  ChatThreadStatus,
  Prisma,
  RFQStatus,
  RfqChannel,
  prisma,
} from '@rafraf/db';
import { triageRfqIntake } from '@rafraf/shared/ai/intake-triage';
import {
  compareSourcingMarkets,
  quoteOriginCountry,
  resolveSourcingMarket,
  SOURCING_MARKETS,
} from '@rafraf/shared/product-os/sourcing-market';
import { evaluateFitmentGate } from '@rafraf/shared/workflow/fitment-gate';
import { cleanChatDraft } from './chat-draft';
import { assertConfirmedChatPartNumber } from './chat-part-provenance';
export { updateOwnedDraft, validateOwnedVehicle } from './chat-draft-service';
export type { ChatDraft } from './chat-draft';
import { CHAT_ATTACHMENT_PATH } from './chat-image-parts';
import { summarizeChatTriageDecision } from './chat-decision-summary';
import { approveCustomerQuote } from './customer-quote-approval';
import {
  customerPaymentExperience,
  paymentLaunchStatus,
} from './payments/payment-launch';
import {
  filterCustomerVisibleQuotes,
  loadLatestQuoteRiskLevels,
  loadLatestSupplierRiskLevels,
} from './customer-quote-visibility';

async function createRfqCode(
  tx: Prisma.TransactionClient,
  data: Omit<Prisma.RFQCreateInput, 'code'>,
) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const now = new Date();
    const code = `RFQ-${String(now.getFullYear()).slice(2)}${String(now.getMonth() + 1).padStart(2, '0')}-${randomInt(10000, 100000)}`;
    try {
      return await tx.rFQ.create({ data: { ...data, code } });
    } catch (error) {
      if (
        !(error instanceof Prisma.PrismaClientKnownRequestError) ||
        error.code !== 'P2002' ||
        attempt === 3
      )
        throw error;
    }
  }
  throw new Error('RFQ_CODE_FAILED');
}

export async function createRfqFromOwnedThread(
  customerId: string,
  threadId: string,
) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-customer:${customerId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-rfq:${threadId}`}))`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`chat-attachment:${threadId}`}))`;
    const thread = await tx.chatThread.findFirst({
      where: { id: threadId, customerId, status: ChatThreadStatus.ACTIVE },
      include: { rfq: true, customer: { include: { user: true } } },
    });
    if (!thread) throw new Error('THREAD_NOT_FOUND');
    if (thread.rfq) return { code: thread.rfq.code, created: false };
    const draft = cleanChatDraft(thread.draft);
    assertConfirmedChatPartNumber(draft);
    if (!draft.partText || !draft.make || !draft.model || !draft.year)
      throw new Error('DRAFT_INCOMPLETE');
    const year = Number(draft.year);
    if (
      !Number.isInteger(year) ||
      year < 1980 ||
      year > new Date().getFullYear() + 1
    )
      throw new Error('YEAR_INVALID');
    const triage = triageRfqIntake({
      fullName: thread.customer.fullName,
      phone: thread.customer.user.phone ?? undefined,
      make: draft.make,
      model: draft.model,
      year,
      partText: draft.partText,
      oemNumber: draft.oemNumber,
      vin: draft.vin,
      notes: draft.notes,
      imagesCount: draft.attachments?.length ?? 0,
      channel: 'WEB',
    });
    if (triage.riskFlags.includes('invalid_vin_format'))
      throw new Error('VIN_INVALID');
    let vehicle = await tx.customerVehicle.findFirst({
      where: { customerId, make: draft.make, model: draft.model, year },
    });
    if (!vehicle)
      vehicle = await tx.customerVehicle.create({
        data: {
          customerId,
          make: draft.make,
          model: draft.model,
          year,
          vin: triage.normalized.vehicle.vin || null,
        },
      });
    const rfq = await createRfqCode(tx, {
      customer: { connect: { id: customerId } },
      vehicle: { connect: { id: vehicle.id } },
      status:
        triage.recommendedStatus === 'NEED_MORE_INFO'
          ? RFQStatus.NEED_MORE_INFO
          : RFQStatus.FITMENT_REVIEW,
      channel: RfqChannel.WEB,
      notes: draft.notes || null,
      items: {
        create: {
          freeTextAr: draft.partText,
          oemNumber: triage.normalized.item.oemNumber || null,
          quantity: 1,
          humanReviewRequired: triage.humanReviewRequired,
        },
      },
      evidence: {
        create: (draft.attachments ?? []).map((storageKey) => ({
          type: 'IMAGE',
          storageKey,
          uploadedBy: customerId,
        })),
      },
    });
    await tx.chatThread.update({
      where: { id: threadId },
      data: { rfqId: rfq.id },
    });
    await tx.aIDecision.create({
      data: {
        kind: AIDecisionKind.UNDERSTAND_REQUEST,
        entityType: 'rfq',
        entityId: rfq.id,
        input: {
          source: 'authenticated_chat',
          fields: {
            make: draft.make,
            model: draft.model,
            year,
            partText: draft.partText,
            hasVin: Boolean(draft.vin),
            hasOemNumber: Boolean(draft.oemNumber),
            imagesCount: draft.attachments?.length ?? 0,
          },
        },
        output: summarizeChatTriageDecision(
          triage,
          draft.attachments?.length ?? 0,
        ) as Prisma.InputJsonValue,
        model: 'rafraf-intake-triage-rules@2026-07-12',
        confidence: triage.confidence,
        humanReviewRequired: triage.humanReviewRequired,
      },
    });
    await tx.auditLog.create({
      data: {
        actorId: customerId,
        actorType: ActorType.CUSTOMER,
        action: 'rfq.created.from_chat',
        entityType: 'rfq',
        entityId: rfq.id,
        after: { threadId, status: rfq.status },
      },
    });
    return { code: rfq.code, created: true };
  });
}

export async function getOwnedQuotes(customerId: string, threadId: string) {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, customerId },
    include: {
      rfq: {
        include: {
          items: {
            include: {
              part: {
                select: {
                  nameAr: true,
                  imageUrl: true,
                  isRestricted: true,
                  sensitivity: true,
                  category: {
                    select: { isRestricted: true, sensitivity: true },
                  },
                },
              },
              quotes: {
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
            },
          },
        },
      },
    },
  });
  if (!thread?.rfq) throw new Error('RFQ_NOT_FOUND');
  const rfq = thread.rfq;
  const item = rfq.items[0];
  const part = customerPartCard(item, thread.draft);
  if (
    !item ||
    !evaluateFitmentGate(item).ready ||
    rfq.status === RFQStatus.CANCELLED
  )
    return {
      code: rfq.code,
      pending: true,
      part,
      quotes: [],
      missingMarkets: [...SOURCING_MARKETS],
    };
  const [latestRiskByQuoteId, latestSupplierRiskById] = await Promise.all([
    loadLatestQuoteRiskLevels(item.quotes.map((quote) => quote.id)),
    loadLatestSupplierRiskLevels(
      item.quotes.flatMap((quote) =>
        quote.supplier?.id ? [quote.supplier.id] : [],
      ),
    ),
  ]);
  const eligibleQuotes = filterCustomerVisibleQuotes({
    quotes: item.quotes,
    item,
    part: item.part,
    rfqStatus: rfq.status,
    latestRiskByQuoteId,
    latestSupplierRiskById,
  });
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
  return {
    code: rfq.code,
    pending: quotes.length === 0,
    part,
    missingMarkets: marketComparison.missingMarkets,
    quotes: quotes.map((quote) => ({
      quoteId: quote.id,
      finalPrice: quote.finalPrice.toFixed(2),
      currency: quote.currency,
      deliveryDaysMin: quote.deliveryDaysMin,
      deliveryDaysMax: quote.deliveryDaysMax,
      warrantyMonths: quote.warrantyMonths,
      fitmentConfidence: quote.fitmentConfidence,
      sourceType: quote.sourceType,
      market: quote.market,
      labels: quote.labels,
    })),
  };
}

export async function approveOwnedQuote(
  customerId: string,
  threadId: string,
  quoteId: string,
) {
  const thread = await prisma.chatThread.findFirst({
    where: { id: threadId, customerId },
    select: { rfqId: true },
  });
  if (!thread?.rfqId) throw new Error('RFQ_NOT_FOUND');
  const approval = await approveCustomerQuote({
    customerId,
    quoteId,
    rfqId: thread.rfqId,
    source: 'chat',
    threadId,
  });
  // الدفع يُقرأ من بيئة الخادم فقط: «احجز» عند التأجيل، و«ادفع» عند فتح التحصيل.
  const payment = customerPaymentExperience(paymentLaunchStatus(process.env));
  return {
    ...approval,
    payment: {
      kind: payment.kind,
      paymentLabel: payment.paymentLabel,
      nextActionTitle: payment.nextActionTitle,
      nextActionLinkLabel: payment.nextActionLinkLabel,
      trackHref: `/track?code=${encodeURIComponent(approval.orderCode)}`,
    },
  };
}

const CHAT_ATTACHMENT_ROUTE = CHAT_ATTACHMENT_PATH;
const EVIDENCE_KEY_PATTERN =
  /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpe?g|png|webp)$/;

function safeCatalogImageUrl(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 2048) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

/**
 * بطاقة القطعة كما يراها العميل: الاسم ورقم OEM وصورة الكتالوج إن وُجدت،
 * وإلا صورة العميل نفسه من مرفقات المحادثة عبر المسار المصادَق فقط.
 * لا تكلفة مورد ولا هامش ولا أي حقل تجاري مُختلَق.
 */
function customerPartCard(
  item:
    | {
        freeTextAr: string | null;
        oemNumber: string | null;
        part: { nameAr: string; imageUrl: string | null } | null;
      }
    | undefined,
  draft: unknown,
) {
  const attachments =
    draft && typeof draft === 'object' && !Array.isArray(draft)
      ? (draft as { attachments?: unknown }).attachments
      : undefined;
  const firstEvidenceKey = Array.isArray(attachments)
    ? attachments.find(
        (key): key is string =>
          typeof key === 'string' && EVIDENCE_KEY_PATTERN.test(key),
      )
    : undefined;
  const name = item?.part?.nameAr?.trim() || item?.freeTextAr?.trim() || null;
  const oemNumber = item?.oemNumber?.trim() || null;
  const catalogImageUrl = safeCatalogImageUrl(item?.part?.imageUrl);
  const evidenceImageUrl = firstEvidenceKey
    ? `${CHAT_ATTACHMENT_ROUTE}?key=${encodeURIComponent(firstEvidenceKey)}`
    : null;
  if (!name && !oemNumber && !catalogImageUrl && !evidenceImageUrl) return null;
  return {
    name: name ? name.slice(0, 120) : null,
    oemNumber: oemNumber ? oemNumber.slice(0, 40) : null,
    imageUrl: catalogImageUrl ?? evidenceImageUrl,
    imageSource: catalogImageUrl
      ? ('catalog' as const)
      : evidenceImageUrl
        ? ('customer' as const)
        : null,
  };
}
