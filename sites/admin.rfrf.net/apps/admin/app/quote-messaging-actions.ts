'use server';

import { ActorType, QuoteStatus, prisma } from '@rafraf/db';
import {
  compareSourcingMarkets,
  quoteOriginCountry,
  resolveSourcingMarket,
  type SourcingMarket,
} from '@rafraf/shared/product-os/sourcing-market';
import { sendTwilioSms, twilioSmsConfigured } from '@rafraf/shared/twilio-sms';
import { revalidatePath } from 'next/cache';
import {
  filterCustomerOfferCandidates,
  loadCustomerOfferRiskLevels,
} from '../lib/customer-offer-visibility';
import { requireAdminPermission } from '../lib/require-admin-session';

const SMS_SEND_COOLDOWN_MS = 60_000;

function smsSnippet(value: string, maxCodePoints: number): string {
  return Array.from(value.replace(/\s+/gu, ' ').trim())
    .slice(0, maxCodePoints)
    .join('');
}

function smsInteger(value: number | null, max = 999): string {
  if (value == null || !Number.isFinite(value)) return '—';
  return String(Math.min(max, Math.max(0, Math.round(value))));
}
const MARKET_MSG: Record<SourcingMarket, string> = {
  SAUDI: 'سعودي',
  GCC: 'خليجي',
  GLOBAL: 'عالمي',
};

/** يبني نص رسالة العروض للعميل — ملتزم بـRule 2 (لا مورد/تكلفة/هامش). */
export async function buildCustomerMessage(rfqId: string): Promise<string> {
  await requireAdminPermission('OPERATIONS_READ');
  const rfq = await prisma.rFQ.findUnique({
    where: { id: rfqId },
    include: {
      customer: true,
      items: {
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: 1,
        select: {
          id: true,
          freeTextAr: true,
          partId: true,
          fitmentConfidence: true,
          humanReviewRequired: true,
          part: {
            select: {
              isRestricted: true,
              sensitivity: true,
              category: {
                select: { isRestricted: true, sensitivity: true },
              },
            },
          },
        },
      },
    },
  });
  if (!rfq) return '';

  const item = rfq.items[0];
  if (!item) return '';

  const eligibleStatuses = [
    QuoteStatus.ACTIVE,
    QuoteStatus.APPROVED,
    QuoteStatus.SELECTED,
  ];
  const candidates = await prisma.quote.findMany({
    where: {
      rfqItemId: item.id,
      status: { in: eligibleStatuses },
    },
    orderBy: [
      { decisionScore: { sort: 'desc', nulls: 'last' } },
      { id: 'asc' },
    ],
    take: 60,
    include: {
      supplier: { select: { id: true, status: true, countryCode: true } },
      sourceRegistry: { select: { country: true } },
    },
  });
  const { quoteRisks, supplierRisks } =
    await loadCustomerOfferRiskLevels(candidates);
  const selectedQuotes = filterCustomerOfferCandidates({
    quotes: candidates,
    item,
    part: item.part,
    rfqStatus: rfq.status,
    quoteRisks,
    supplierRisks,
  });
  const marketComparison = compareSourcingMarkets(
    selectedQuotes.map((quote) => ({
      ...quote,
      market: resolveSourcingMarket(
        quote.sourceType,
        quoteOriginCountry(quote),
      ),
    })),
  );
  const quotes = marketComparison.quotes;
  if (!quotes.length) return '';

  const customerName = smsSnippet(rfq.customer.fullName, 20);
  const partName = smsSnippet(item.freeTextAr ?? 'قطعة غيار', 30);
  const lines = quotes.map((quote, index) => {
    const recommended = quote.labels.includes('BEST_OVERALL') ? ' ★' : '';
    const numericPrice = Number(quote.finalPrice);
    const price =
      Number.isFinite(numericPrice) && numericPrice > 0
        ? Math.min(9_999_999_999, numericPrice).toFixed(0)
        : '—';
    const fitment =
      quote.fitmentConfidence == null
        ? ''
        : ` | ط${Math.round(
            Math.min(1, Math.max(0, quote.fitmentConfidence)) * 100,
          )}%`;
    return `${index + 1}) ${MARKET_MSG[quote.market]}${recommended}: ${price}ر | ${smsInteger(
      quote.deliveryDaysMax,
    )}ي | ض${smsInteger(quote.warrantyMonths)}ش${fitment}`;
  });
  const missingCoverage = marketComparison.missingMarkets.length
    ? `\nبانتظار: ${marketComparison.missingMarkets
        .map((market) => MARKET_MSG[market])
        .join('، ')}`
    : '';

  return (
    `مرحباً ${customerName}، عروض رفرف ${rfq.code}\n` +
    `${partName}\n` +
    lines.join('\n') +
    missingCoverage +
    '\nاعتمد العرض من حسابك. السعر نهائي واصل.'
  );
}
/** إرسال رسالة العروض للعميل (زر يدوي بقرار المشغّل). */
export async function sendQuotes(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('MESSAGING_SEND');
  const rfqId = String(fd.get('rfqId') ?? '');
  if (!rfqId) return;

  // The UI hides the send affordance when no sender is configured. Refuse here
  // too, before the cooldown reservation, so a crafted post cannot burn the
  // per-RFQ window on a send that can only end in a `configuration` rejection.
  if (!twilioSmsConfigured()) return;

  const rfq = await prisma.rFQ.findUnique({
    where: { id: rfqId },
    include: { customer: { include: { user: true } } },
  });
  if (!rfq || !rfq.customer.user.isActive) return;
  const customerPhone = rfq.customer.user.phone;
  if (!customerPhone) return;

  const text = await buildCustomerMessage(rfqId);
  if (!text) return;

  const cutoff = new Date(Date.now() - SMS_SEND_COOLDOWN_MS);
  const reserved = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`admin:quotes-sms:${rfqId}`}))`;
    const recent = await tx.auditLog.findFirst({
      where: {
        entityType: 'rfq',
        entityId: rfqId,
        action: 'customer.notification.requested',
        createdAt: { gte: cutoff },
      },
      select: { id: true },
    });
    if (recent) return false;

    await tx.auditLog.create({
      data: {
        actorId: admin.userId,
        actorType: ActorType.ADMIN,
        action: 'customer.notification.requested',
        entityType: 'rfq',
        entityId: rfqId,
        after: { channel: 'sms' },
      },
    });
    return true;
  });
  if (!reserved) {
    revalidatePath(`/rfq/${rfqId}`);
    return;
  }

  const result = await sendTwilioSms(customerPhone, text);
  await prisma.auditLog.create({
    data: {
      actorId: admin.userId,
      actorType: ActorType.ADMIN,
      action: `customer.notification.${result.status}`,
      entityType: 'rfq',
      entityId: rfqId,
      after: {
        channel: 'sms',
        status: result.status,
        segmentCount: result.segments,
        ...(result.status === 'accepted'
          ? {}
          : { failureClass: result.reason }),
      },
    },
  });
  revalidatePath(`/rfq/${rfqId}`);
}
