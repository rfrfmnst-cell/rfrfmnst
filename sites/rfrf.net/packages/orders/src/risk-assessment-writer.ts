import { ActorType, Prisma, RiskLevel } from '@rafraf/db';

export interface ReviewedRiskInput {
  entityType: 'supplier' | 'quote';
  entityId: string;
  actorId: string;
  riskLevel: RiskLevel;
  reasonCode: 'SUPPLIER_APPROVAL' | 'SUPPLIER_REVIEW' | 'QUOTE_REVIEW';
}

/** Readers and reviewers hold these locks until their transaction commits. */
export async function lockReviewedRisks(
  tx: Prisma.TransactionClient,
  input: { supplierId?: string | null; quoteId?: string | null },
): Promise<void> {
  const keys = [
    input.quoteId ? `risk-assessment:quote:${input.quoteId}` : null,
    input.supplierId ? `risk-assessment:supplier:${input.supplierId}` : null,
  ]
    .filter((value): value is string => value !== null)
    .sort();
  for (const key of keys) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

/** Persists an explicit operator decision; never invents an AI risk score. */
export async function recordReviewedRisk(
  tx: Prisma.TransactionClient,
  input: ReviewedRiskInput,
): Promise<string> {
  if (
    !input.actorId.trim() ||
    !input.entityId.trim() ||
    !(Object.values(RiskLevel) as string[]).includes(input.riskLevel)
  ) {
    throw new Error('INVALID_REVIEWED_RISK');
  }
  const lock = `risk-assessment:${input.entityType}:${input.entityId}`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lock}))`;
  const latest = await tx.riskAssessment.findFirst({
    where: { entityType: input.entityType, entityId: input.entityId },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    select: {
      id: true,
      riskLevel: true,
      reasons: true,
      createdAt: true,
      assessedBy: true,
    },
  });
  const reasons = {
    policy: 'manual-review-v1',
    reasonCode: input.reasonCode,
    reviewedBy: input.actorId,
  };
  if (
    latest?.riskLevel === input.riskLevel &&
    latest.assessedBy === ActorType.ADMIN &&
    latest.reasons &&
    typeof latest.reasons === 'object' &&
    !Array.isArray(latest.reasons) &&
    latest.reasons.policy === reasons.policy &&
    latest.reasons.reasonCode === reasons.reasonCode &&
    latest.reasons.reviewedBy === reasons.reviewedBy
  ) {
    return latest.id;
  }
  const assessment = await tx.riskAssessment.create({
    data: {
      entityType: input.entityType,
      entityId: input.entityId,
      riskLevel: input.riskLevel,
      assessedBy: ActorType.ADMIN,
      reasons,
      // A transaction may have started before the preceding reviewer committed.
      createdAt: new Date(
        Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1),
      ),
    },
    select: { id: true },
  });
  return assessment.id;
}
