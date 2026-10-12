import { reviewedCommerceRiskLevel } from '@rafraf/shared/product-os/reviewed-commerce-risk';
import type { Prisma } from '@rafraf/db';
import { lockReviewedRisks } from '@rafraf/orders/src/risk-assessment-writer.ts';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import {
  customerQuoteEligibilityBlockReason,
  type CustomerQuoteEligibilityBlockReason,
  type CustomerQuoteEligibilityFacts,
} from '@rafraf/shared/product-os/customer-quote-eligibility';

export type PaymentIntakeEligibilityBlockReason =
  | CustomerQuoteEligibilityBlockReason
  | 'ORDER_QUOTE_MISMATCH'
  | 'ORDER_PRICE_MISMATCH';

export interface PaymentIntakeEligibilityFacts extends CustomerQuoteEligibilityFacts {
  order: {
    quoteId: string;
    supplierId: string | null;
    totalAmount: string;
    currency: string;
  };
  selectedQuote: {
    id: string;
    supplierId: string | null;
    finalPrice: string;
    currency: string;
  };
}

/**
 * Revalidates the immutable order/quote price contract and every mutable
 * commerce gate immediately before a payment intake row can be reserved.
 */
export function paymentIntakeEligibilityBlockReason(
  facts: PaymentIntakeEligibilityFacts,
  now = new Date(),
): PaymentIntakeEligibilityBlockReason | null {
  if (
    facts.order.quoteId !== facts.selectedQuote.id ||
    facts.order.supplierId !== facts.selectedQuote.supplierId
  ) {
    return 'ORDER_QUOTE_MISMATCH';
  }
  if (
    facts.order.currency !== facts.selectedQuote.currency ||
    facts.order.totalAmount !== facts.selectedQuote.finalPrice
  ) {
    return 'ORDER_PRICE_MISMATCH';
  }
  return customerQuoteEligibilityBlockReason(facts, now, {
    allowConvertedRfq: true,
  });
}

/**
 * Loads the complete, mutable payment policy snapshot from one transaction.
 * Checkout and provider settlement deliberately share this loader so a hosted
 * checkout URL cannot outlive a supplier, risk, quote, or part-policy change.
 */
export async function loadPaymentIntakeEligibilityBlockReason(
  tx: Prisma.TransactionClient,
  orderId: string,
  now = new Date(),
): Promise<PaymentIntakeEligibilityBlockReason | null> {
  const order = await tx.order.findUnique({
    where: { id: orderId },
    select: {
      quoteId: true,
      supplierId: true,
      totalAmount: true,
      currency: true,
      quote: {
        select: {
          id: true,
          supplierId: true,
          partId: true,
          fitmentConfidence: true,
          status: true,
          expiresAt: true,
          riskLevel: true,
          finalPrice: true,
          currency: true,
          supplier: { select: { status: true } },
          rfqItem: {
            select: {
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
              rfq: { select: { status: true } },
            },
          },
        },
      },
    },
  });
  if (!order) throw new Error('Payment order no longer exists');

  await lockReviewedRisks(tx, {
    supplierId: order.quote.supplierId,
    quoteId: order.quote.id,
  });
  const [latestQuoteRisk, latestSupplierRisk] = await Promise.all([
    tx.riskAssessment.findFirst({
      where: { entityType: 'quote', entityId: order.quote.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { riskLevel: true, assessedBy: true, reasons: true },
    }),
    order.quote.supplierId
      ? tx.riskAssessment.findFirst({
          where: {
            entityType: 'supplier',
            entityId: order.quote.supplierId,
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { riskLevel: true, assessedBy: true, reasons: true },
        })
      : Promise.resolve(null),
  ]);

  return paymentIntakeEligibilityBlockReason(
    {
      order: {
        quoteId: order.quoteId,
        supplierId: order.supplierId,
        totalAmount: order.totalAmount.toString(),
        currency: order.currency,
      },
      selectedQuote: {
        id: order.quote.id,
        supplierId: order.quote.supplierId,
        finalPrice: order.quote.finalPrice.toString(),
        currency: order.quote.currency,
      },
      quote: {
        partId: order.quote.partId,
        fitmentConfidence: order.quote.fitmentConfidence,
        status: order.quote.status,
        expiresAt: order.quote.expiresAt,
        riskLevel: order.quote.riskLevel,
        finalPrice: Number(order.quote.finalPrice),
      },
      item: order.quote.rfqItem,
      rfqStatus: order.quote.rfqItem.rfq.status,
      supplierStatus: order.quote.supplier?.status ?? null,
      latestRiskLevel: reviewedCommerceRiskLevel(latestQuoteRisk),
      latestSupplierRiskLevel: reviewedCommerceRiskLevel(latestSupplierRisk),
      partRestricted: isPartCommerceRestricted(order.quote.rfqItem.part),
    },
    now,
  );
}
