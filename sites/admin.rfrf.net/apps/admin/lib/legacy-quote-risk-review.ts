import { ActorType, prisma } from '@rafraf/db';
import {
  lockReviewedRisks,
  recordReviewedRisk,
} from '@rafraf/orders/src/risk-assessment-writer.ts';
import { rfqDecisionLockKey } from '@rafraf/shared/product-os/rfq-decision-lock';
import { isRiskLevel } from './incoming-quote-pricing.ts';

export async function recordExistingQuoteReview(
  input: {
    quoteId: string;
    rfqId: string;
    actorId: string;
    expectedRiskLevel: string;
    confirmed: boolean;
  },
  client: typeof prisma = prisma,
): Promise<
  'RECORDED' | 'ALREADY_REVIEWED' | 'NOT_AVAILABLE' | 'REVIEW_CHANGED'
> {
  if (!input.confirmed || !isRiskLevel(input.expectedRiskLevel))
    return 'NOT_AVAILABLE';
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(input.rfqId)}))`;
    const quote = await tx.quote.findUnique({
      where: { id: input.quoteId },
      select: {
        id: true,
        status: true,
        riskLevel: true,
        rfqItem: { select: { rfqId: true, rfq: { select: { status: true } } } },
      },
    });
    if (
      !quote ||
      quote.rfqItem.rfqId !== input.rfqId ||
      !['ACTIVE', 'APPROVED', 'SELECTED'].includes(quote.status) ||
      quote.rfqItem.rfq.status === 'CANCELLED'
    )
      return 'NOT_AVAILABLE';
    if (quote.riskLevel !== input.expectedRiskLevel) return 'REVIEW_CHANGED';
    await lockReviewedRisks(tx, { quoteId: quote.id });
    const latest = await tx.riskAssessment.findFirst({
      where: { entityType: 'quote', entityId: quote.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true, riskLevel: true, assessedBy: true, reasons: true },
    });
    // Automated low risk does not substitute for an explicit human review.
    if (latest && ['HIGH', 'BLOCKED'].includes(latest.riskLevel))
      return 'ALREADY_REVIEWED';
    if (
      latest?.assessedBy === ActorType.ADMIN &&
      latest.reasons &&
      typeof latest.reasons === 'object' &&
      !Array.isArray(latest.reasons) &&
      latest.reasons.policy === 'manual-review-v1' &&
      typeof latest.reasons.reviewedBy === 'string' &&
      latest.reasons.reviewedBy &&
      latest.reasons.reasonCode === 'QUOTE_REVIEW'
    )
      return 'ALREADY_REVIEWED';
    const riskAssessmentId = await recordReviewedRisk(tx, {
      entityType: 'quote',
      entityId: quote.id,
      actorId: input.actorId,
      riskLevel: quote.riskLevel,
      reasonCode: 'QUOTE_REVIEW',
    });
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'quote.risk.reviewed',
        entityType: 'quote',
        entityId: quote.id,
        after: { riskAssessmentId, riskLevel: quote.riskLevel },
      },
    });
    return 'RECORDED';
  });
}
