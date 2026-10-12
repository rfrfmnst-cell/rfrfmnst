import { reviewedCommerceRiskLevel } from '@rafraf/shared/product-os/reviewed-commerce-risk';
import { randomInt } from 'node:crypto';
import { ActorType, RFQStatus, prisma } from '@rafraf/db';
import { lockReviewedRisks } from '@rafraf/orders/src/risk-assessment-writer.ts';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import { rfqDecisionLockKey } from '@rafraf/shared/product-os/rfq-decision-lock';
import {
  customerQuoteEligibilityBlockReason,
  isCustomerQuoteEligible,
  type CustomerQuoteEligibilityBlockReason,
  type CustomerQuoteEligibilityFacts,
} from '@rafraf/shared/product-os/customer-quote-eligibility';

export {
  customerQuoteEligibilityBlockReason as customerQuoteApprovalBlockReason,
  isCustomerQuoteEligible,
};
export type {
  CustomerQuoteEligibilityBlockReason as CustomerQuoteApprovalBlockReason,
  CustomerQuoteEligibilityFacts as CustomerQuoteApprovalFacts,
};

const MAX_ORDER_CREATE_ATTEMPTS = 3;

export type CustomerQuoteApprovalSource = 'chat' | 'comparison';

export interface CustomerQuoteApprovalInput {
  customerId: string;
  quoteId: string;
  rfqId?: string;
  rfqCode?: string;
  source: CustomerQuoteApprovalSource;
  threadId?: string;
}

export interface CustomerQuoteApprovalResult {
  orderCode: string;
  created: boolean;
  rfqCode: string;
  totalAmount: string;
  currency: string;
}

export type CustomerQuoteApprovalErrorCode =
  | 'QUOTE_NOT_AVAILABLE'
  | 'ORDER_OWNERSHIP_CONFLICT'
  | 'RFQ_ALREADY_ORDERED'
  | CustomerQuoteEligibilityBlockReason;

export class CustomerQuoteApprovalError extends Error {
  readonly code: CustomerQuoteApprovalErrorCode;

  constructor(code: CustomerQuoteApprovalErrorCode) {
    super(code);
    this.name = 'CustomerQuoteApprovalError';
    this.code = code;
  }
}

export function isPrismaUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function orderCode(): string {
  return `ORD-${Date.now().toString(36).toUpperCase()}-${randomInt(100, 1000)}`;
}

function resultFromOrder(
  order: {
    code: string;
    totalAmount: { toFixed(fractionDigits: number): string };
    currency: string;
  },
  rfqCode: string,
  created: boolean,
): CustomerQuoteApprovalResult {
  return {
    orderCode: order.code,
    created,
    rfqCode,
    totalAmount: order.totalAmount.toFixed(2),
    currency: order.currency,
  };
}

/**
 * المسار الوحيد لاعتماد العميل عرضاً. تعاد كل شروط الملكية والسياسة بعد قفل RFQ
 * داخل المعاملة؛ وقيد orders.rfqId هو خط الدفاع الأخير ضد السباقات العابرة للمسارات.
 */
export async function approveCustomerQuote(
  input: CustomerQuoteApprovalInput,
  client: typeof prisma = prisma,
): Promise<CustomerQuoteApprovalResult> {
  const ownedQuote = await client.quote.findFirst({
    where: {
      id: input.quoteId,
      rfqItem: {
        ...(input.rfqId ? { rfqId: input.rfqId } : {}),
        rfq: {
          customerId: input.customerId,
          customer: { user: { isActive: true } },
          ...(input.rfqCode ? { code: input.rfqCode } : {}),
        },
      },
    },
    select: {
      rfqItem: {
        select: {
          rfqId: true,
          rfq: { select: { code: true } },
        },
      },
    },
  });
  if (!ownedQuote) throw new CustomerQuoteApprovalError('QUOTE_NOT_AVAILABLE');

  const rfqId = ownedQuote.rfqItem.rfqId;
  const rfqCode = ownedQuote.rfqItem.rfq.code;

  for (let attempt = 0; attempt < MAX_ORDER_CREATE_ATTEMPTS; attempt += 1) {
    try {
      return await client.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(rfqId)}))`;

        const existing = await tx.order.findFirst({
          where: { rfqId },
          select: {
            code: true,
            customerId: true,
            quoteId: true,
            totalAmount: true,
            currency: true,
          },
        });
        if (existing) {
          if (existing.customerId !== input.customerId) {
            throw new CustomerQuoteApprovalError('ORDER_OWNERSHIP_CONFLICT');
          }
          if (existing.quoteId !== input.quoteId) {
            throw new CustomerQuoteApprovalError('RFQ_ALREADY_ORDERED');
          }
          return resultFromOrder(existing, rfqCode, false);
        }

        const quote = await tx.quote.findFirst({
          where: {
            id: input.quoteId,
            rfqItem: {
              rfqId,
              rfq: {
                customerId: input.customerId,
                customer: { user: { isActive: true } },
              },
            },
          },
          include: {
            supplier: { select: { status: true } },
            rfqItem: {
              select: {
                rfqId: true,
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
                rfq: {
                  select: { customerId: true, status: true, code: true },
                },
              },
            },
          },
        });
        if (!quote) {
          throw new CustomerQuoteApprovalError('QUOTE_NOT_AVAILABLE');
        }

        await lockReviewedRisks(tx, {
          supplierId: quote.supplierId,
          quoteId: quote.id,
        });
        const [latestRisk, latestSupplierRisk] = await Promise.all([
          tx.riskAssessment.findFirst({
            where: { entityType: 'quote', entityId: quote.id },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              riskLevel: true,
              assessedBy: true,
              reasons: true,
            },
          }),
          quote.supplierId
            ? tx.riskAssessment.findFirst({
                where: { entityType: 'supplier', entityId: quote.supplierId },
                orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
                select: {
                  id: true,
                  riskLevel: true,
                  assessedBy: true,
                  reasons: true,
                },
              })
            : Promise.resolve(null),
        ]);
        const blockReason = customerQuoteEligibilityBlockReason({
          quote: {
            partId: quote.partId,
            fitmentConfidence: quote.fitmentConfidence,
            status: quote.status,
            expiresAt: quote.expiresAt,
            riskLevel: quote.riskLevel,
            finalPrice: Number(quote.finalPrice),
          },
          item: quote.rfqItem,
          rfqStatus: quote.rfqItem.rfq.status,
          supplierStatus: quote.supplier?.status ?? null,
          latestRiskLevel: reviewedCommerceRiskLevel(latestRisk),
          latestSupplierRiskLevel:
            reviewedCommerceRiskLevel(latestSupplierRisk),
          partRestricted: isPartCommerceRestricted(quote.rfqItem.part),
        });
        if (blockReason) throw new CustomerQuoteApprovalError(blockReason);

        await tx.quote.update({
          where: { id: quote.id },
          data: { status: 'SELECTED' },
        });
        await tx.rFQ.update({
          where: { id: rfqId },
          data: { status: RFQStatus.CONVERTED_TO_ORDER },
        });
        const order = await tx.order.create({
          data: {
            code: orderCode(),
            customerId: input.customerId,
            rfqId,
            quoteId: quote.id,
            supplierId: quote.supplierId,
            status: 'AWAITING_PAYMENT',
            totalAmount: quote.finalPrice,
            currency: quote.currency,
            events: {
              create: {
                toStatus: 'AWAITING_PAYMENT',
                actorType: ActorType.CUSTOMER,
                actorId: input.customerId,
                note:
                  input.source === 'chat'
                    ? 'اعتماد صريح من دردشة العميل'
                    : 'اعتماد العميل من صفحة المقارنة',
              },
            },
          },
          select: {
            id: true,
            code: true,
            totalAmount: true,
            currency: true,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: input.customerId,
            actorType: ActorType.CUSTOMER,
            action: 'quote.approved.by_customer',
            entityType: 'quote',
            entityId: quote.id,
            after: {
              orderId: order.id,
              rfqId,
              source: input.source,
              latestRiskAssessmentId: latestRisk?.id ?? null,
              latestSupplierRiskAssessmentId: latestSupplierRisk?.id ?? null,
              ...(input.threadId ? { threadId: input.threadId } : {}),
            },
          },
        });
        return resultFromOrder(order, rfqCode, true);
      });
    } catch (error) {
      if (!isPrismaUniqueViolation(error)) throw error;

      const existing = await client.order.findFirst({
        where: { rfqId },
        select: {
          code: true,
          customerId: true,
          quoteId: true,
          totalAmount: true,
          currency: true,
        },
      });
      if (existing) {
        if (existing.customerId !== input.customerId) {
          throw new CustomerQuoteApprovalError('ORDER_OWNERSHIP_CONFLICT');
        }
        if (existing.quoteId !== input.quoteId) {
          throw new CustomerQuoteApprovalError('RFQ_ALREADY_ORDERED');
        }
        return resultFromOrder(existing, rfqCode, false);
      }
      if (attempt === MAX_ORDER_CREATE_ATTEMPTS - 1) throw error;
    }
  }

  throw new Error('ORDER_CREATE_FAILED');
}
