'use server';

import {
  ActorType,
  prisma,
  QuoteSourceType,
  QuoteStatus,
  RecommendationLabel,
  RFQStatus,
  SupplierStatus,
} from '@rafraf/db';
import {
  isVerifiedFitment,
  matchesVerifiedPart,
} from '@rafraf/shared/product-os/quote-policy';
import { revalidatePath } from 'next/cache';
import { requireAdminPermission } from '../../lib/require-admin-session';
import { recomputeRankingInTransaction } from '../../lib/recompute-ranking';
import { rfqDecisionLockKey } from '@rafraf/shared/product-os/rfq-decision-lock';
import {
  parseRankingSnapshot,
  RankingRollbackConflict,
  restoreRankingSnapshotInTransaction,
} from '../../lib/risk-exception-rollback';
import {
  DECISION_ACTIONS,
  DecisionConflict,
  ELIGIBLE_ALTERNATIVE_STATUSES,
  isQuoteStatus,
  isRfqStatus,
  LOCKED_RFQ_STATUSES,
  MUTABLE_RISKY_QUOTE_STATUSES,
  REVIEWABLE_RISK_LEVELS,
  ROLLBACK_WINDOW_MS,
} from '../../lib/risk-exception-policy';

function refreshRiskPaths(riskId: string, rfqId: string): void {
  revalidatePath(`/exceptions/${encodeURIComponent(riskId)}`);
  revalidatePath('/exceptions');
  revalidatePath(`/rfq/${rfqId}`);
  revalidatePath('/');
}

export async function resolveRiskException(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('RISK_REVIEW');
  const riskId = String(fd.get('riskId') ?? '');
  const quoteId = String(fd.get('quoteId') ?? '');
  const alternativeQuoteId = String(fd.get('alternativeQuoteId') ?? '');
  const alias = String(fd.get('alias') ?? riskId).slice(0, 80);
  const decision = String(fd.get('decision') ?? '');
  if (
    !riskId ||
    !quoteId ||
    !['LOCAL_OVERRIDE', 'REPRICE'].includes(decision)
  ) {
    return;
  }

  const owner = await prisma.quote.findUnique({
    where: { id: quoteId },
    select: { rfqItem: { select: { rfqId: true } } },
  });
  if (!owner) return;
  const rfqId = owner.rfqItem.rfqId;

  try {
    const changed = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${rfqDecisionLockKey(rfqId)}))`;
      const [risk, latestRisk, quote, latestDecision] = await Promise.all([
        tx.riskAssessment.findUnique({ where: { id: riskId } }),
        tx.riskAssessment.findFirst({
          where: { entityType: 'quote', entityId: quoteId },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { id: true, riskLevel: true },
        }),
        tx.quote.findUnique({
          where: { id: quoteId },
          include: {
            order: { select: { id: true } },
            rfqItem: {
              select: {
                rfqId: true,
                partId: true,
                fitmentConfidence: true,
                humanReviewRequired: true,
                rfq: { select: { status: true } },
              },
            },
          },
        }),
        tx.auditLog.findFirst({
          where: {
            entityType: 'risk_assessment',
            entityId: riskId,
            actorType: ActorType.ADMIN,
            action: { in: [...DECISION_ACTIONS] },
          },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          select: { action: true },
        }),
      ]);

      if (
        !risk ||
        risk.entityType !== 'quote' ||
        risk.entityId !== quoteId ||
        latestRisk?.id !== risk.id ||
        !REVIEWABLE_RISK_LEVELS.includes(latestRisk.riskLevel) ||
        !quote ||
        quote.rfqItem.rfqId !== rfqId ||
        quote.order ||
        LOCKED_RFQ_STATUSES.includes(quote.rfqItem.rfq.status)
      ) {
        return false;
      }

      if (decision === 'REPRICE') {
        if (
          latestDecision?.action === 'risk.exception.local_override' ||
          latestDecision?.action === 'risk.exception.repricing_requested'
        ) {
          return false;
        }

        await tx.auditLog.create({
          data: {
            actorId: admin.userId,
            actorType: ActorType.ADMIN,
            action: 'risk.exception.repricing_requested',
            entityType: 'risk_assessment',
            entityId: risk.id,
            after: {
              riskAlias: alias,
              quoteId: quote.id,
              rfqId: quote.rfqItem.rfqId,
              executionMode: 'human_requested',
            },
          },
        });
        return true;
      }

      if (
        !alternativeQuoteId ||
        latestDecision?.action === 'risk.exception.local_override' ||
        !MUTABLE_RISKY_QUOTE_STATUSES.includes(quote.status) ||
        !isVerifiedFitment(quote.rfqItem)
      ) {
        return false;
      }

      const [alternative, alternativeRisk, recommendation, rankingSnapshot] =
        await Promise.all([
          tx.quote.findUnique({
            where: { id: alternativeQuoteId },
            include: {
              order: { select: { id: true } },
              supplier: { select: { status: true } },
            },
          }),
          tx.riskAssessment.findFirst({
            where: { entityType: 'quote', entityId: alternativeQuoteId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, riskLevel: true },
          }),
          tx.recommendationResult.findFirst({
            where: { rfqItemId: quote.rfqItemId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: {
              id: true,
              bestOverallQuoteId: true,
              explanationAr: true,
            },
          }),
          tx.quote.findMany({
            where: {
              rfqItemId: quote.rfqItemId,
              status: { not: QuoteStatus.REJECTED },
            },
            select: {
              id: true,
              decisionScore: true,
              labels: true,
            },
            orderBy: { id: 'asc' },
          }),
        ]);

      const now = new Date();
      if (
        !alternative ||
        alternative.order ||
        alternative.id === quote.id ||
        alternative.rfqItemId !== quote.rfqItemId ||
        alternative.sourceType !== QuoteSourceType.LOCAL ||
        alternative.supplier?.status !== SupplierStatus.APPROVED ||
        !matchesVerifiedPart(alternative, quote.rfqItem) ||
        !ELIGIBLE_ALTERNATIVE_STATUSES.includes(alternative.status) ||
        (alternative.expiresAt != null && alternative.expiresAt <= now) ||
        REVIEWABLE_RISK_LEVELS.includes(alternative.riskLevel) ||
        (alternativeRisk != null &&
          REVIEWABLE_RISK_LEVELS.includes(alternativeRisk.riskLevel))
      ) {
        return false;
      }

      const rejected = await tx.quote.updateMany({
        where: { id: quote.id, status: quote.status },
        data: {
          status: QuoteStatus.REJECTED,
          decisionScore: null,
          labels: { set: [] },
        },
      });
      if (rejected.count !== 1) {
        throw new DecisionConflict('risky quote changed');
      }

      const approved = await tx.quote.updateMany({
        where: { id: alternative.id, status: alternative.status },
        data: { status: QuoteStatus.APPROVED },
      });
      if (approved.count !== 1) {
        throw new DecisionConflict('alternative quote changed');
      }

      const ranking = await recomputeRankingInTransaction(tx, quote.rfqItemId);
      if (!ranking?.bestOverallQuoteId)
        throw new DecisionConflict('ranking has no candidates');

      const rfqUpdated = await tx.rFQ.updateMany({
        where: {
          id: quote.rfqItem.rfqId,
          status: quote.rfqItem.rfq.status,
        },
        data: { status: RFQStatus.QUOTES_READY },
      });
      if (rfqUpdated.count !== 1) {
        throw new DecisionConflict('rfq changed');
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'risk.exception.local_override',
          entityType: 'risk_assessment',
          entityId: risk.id,
          before: {
            riskAlias: alias,
            riskyQuoteId: quote.id,
            riskyQuoteStatus: quote.status,
            alternativeQuoteId: alternative.id,
            alternativeQuoteStatus: alternative.status,
            alternativeRiskAssessmentId: alternativeRisk?.id ?? null,
            alternativeRiskLevel:
              alternativeRisk?.riskLevel ?? alternative.riskLevel,
            rfqStatus: quote.rfqItem.rfq.status,
            rankingSnapshot,
            recommendationResultId: recommendation?.id ?? null,
            recommendationBestOverallQuoteId:
              recommendation?.bestOverallQuoteId ?? null,
            recommendationExplanationAr: recommendation?.explanationAr ?? null,
          },
          after: {
            riskAlias: alias,
            rejectedQuoteId: quote.id,
            approvedLocalQuoteId: alternative.id,
            rfqStatus: RFQStatus.QUOTES_READY,
            createdRecommendationResultId: ranking.recommendationResultId,
            recommendationBestOverallQuoteId: ranking.bestOverallQuoteId,
            rollbackWindowMinutes: 15,
            executionMode: 'human_approved',
          },
        },
      });

      return true;
    });

    if (!changed) return;
  } catch (error) {
    if (error instanceof DecisionConflict) return;
    console.error('resolveRiskException failed:', error);
    return;
  }

  if (rfqId) refreshRiskPaths(riskId, rfqId);
}

export async function rollbackRiskException(fd: FormData): Promise<void> {
  const admin = await requireAdminPermission('RISK_REVIEW');
  const riskId = String(fd.get('riskId') ?? '');
  if (!riskId) return;

  let rfqId: string | null = null;

  try {
    const rolledBack = await prisma.$transaction(async (tx) => {
      const decisionLog = await tx.auditLog.findFirst({
        where: {
          entityType: 'risk_assessment',
          entityId: riskId,
          actorType: ActorType.ADMIN,
          action: 'risk.exception.local_override',
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      });
      if (
        !decisionLog ||
        Date.now() - decisionLog.createdAt.getTime() > ROLLBACK_WINDOW_MS
      ) {
        return false;
      }

      const alreadyRolledBack = await tx.auditLog.findFirst({
        where: {
          entityType: 'risk_assessment',
          entityId: riskId,
          actorType: ActorType.ADMIN,
          action: 'risk.exception.rollback',
          createdAt: { gte: decisionLog.createdAt },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (alreadyRolledBack) return false;

      const before = (decisionLog.before ?? {}) as Record<string, unknown>;
      const after = (decisionLog.after ?? {}) as Record<string, unknown>;
      const riskyQuoteId =
        typeof after.rejectedQuoteId === 'string' ? after.rejectedQuoteId : '';
      const alternativeQuoteId =
        typeof after.approvedLocalQuoteId === 'string'
          ? after.approvedLocalQuoteId
          : '';
      const riskyQuoteStatus = before.riskyQuoteStatus;
      const alternativeQuoteStatus = before.alternativeQuoteStatus;
      const previousRfqStatus = before.rfqStatus;
      const rankingSnapshot = parseRankingSnapshot(
        before.rankingSnapshot,
        Object.values(RecommendationLabel),
      );
      const createdRecommendationResultId =
        typeof after.createdRecommendationResultId === 'string'
          ? after.createdRecommendationResultId
          : '';

      if (
        !riskyQuoteId ||
        !alternativeQuoteId ||
        !isQuoteStatus(riskyQuoteStatus) ||
        !isQuoteStatus(alternativeQuoteStatus) ||
        !isRfqStatus(previousRfqStatus) ||
        !rankingSnapshot ||
        !rankingSnapshot.some((entry) => entry.id === riskyQuoteId) ||
        !rankingSnapshot.some((entry) => entry.id === alternativeQuoteId) ||
        !createdRecommendationResultId
      ) {
        return false;
      }

      const [risk, latestRisk, riskyQuote, alternative, recommendation] =
        await Promise.all([
          tx.riskAssessment.findUnique({ where: { id: riskId } }),
          tx.riskAssessment.findFirst({
            where: { entityType: 'quote', entityId: riskyQuoteId },
            orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
            select: { id: true, riskLevel: true },
          }),
          tx.quote.findUnique({
            where: { id: riskyQuoteId },
            include: {
              order: { select: { id: true } },
              rfqItem: {
                select: {
                  rfqId: true,
                  rfq: { select: { status: true } },
                },
              },
            },
          }),
          tx.quote.findUnique({
            where: { id: alternativeQuoteId },
            include: { order: { select: { id: true } } },
          }),
          tx.recommendationResult.findUnique({
            where: { id: createdRecommendationResultId },
            select: { id: true, rfqItemId: true },
          }),
        ]);

      if (
        !risk ||
        risk.entityType !== 'quote' ||
        risk.entityId !== riskyQuoteId ||
        latestRisk?.id !== risk.id ||
        !REVIEWABLE_RISK_LEVELS.includes(latestRisk.riskLevel) ||
        !riskyQuote ||
        riskyQuote.order ||
        !alternative ||
        alternative.order ||
        !recommendation ||
        recommendation.rfqItemId !== riskyQuote.rfqItemId ||
        riskyQuote.rfqItemId !== alternative.rfqItemId ||
        riskyQuote.status !== QuoteStatus.REJECTED ||
        alternative.status !== QuoteStatus.APPROVED ||
        riskyQuote.rfqItem.rfq.status !== RFQStatus.QUOTES_READY ||
        LOCKED_RFQ_STATUSES.includes(riskyQuote.rfqItem.rfq.status)
      ) {
        return false;
      }

      const latestRecommendation = await tx.recommendationResult.findFirst({
        where: { rfqItemId: riskyQuote.rfqItemId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      if (latestRecommendation?.id !== createdRecommendationResultId) {
        return false;
      }

      rfqId = riskyQuote.rfqItem.rfqId;

      const riskyRestored = await tx.quote.updateMany({
        where: { id: riskyQuote.id, status: QuoteStatus.REJECTED },
        data: { status: riskyQuoteStatus },
      });
      if (riskyRestored.count !== 1) {
        throw new DecisionConflict('risky quote changed');
      }

      const alternativeRestored = await tx.quote.updateMany({
        where: { id: alternative.id, status: QuoteStatus.APPROVED },
        data: { status: alternativeQuoteStatus },
      });
      if (alternativeRestored.count !== 1) {
        throw new DecisionConflict('alternative quote changed');
      }

      await restoreRankingSnapshotInTransaction(tx, {
        rfqItemId: riskyQuote.rfqItemId,
        snapshots: rankingSnapshot,
        createdRecommendationResultId,
      });

      const rfqRestored = await tx.rFQ.updateMany({
        where: {
          id: riskyQuote.rfqItem.rfqId,
          status: RFQStatus.QUOTES_READY,
        },
        data: { status: previousRfqStatus },
      });
      if (rfqRestored.count !== 1) {
        throw new DecisionConflict('rfq changed');
      }

      await tx.auditLog.create({
        data: {
          actorId: admin.userId,
          actorType: ActorType.ADMIN,
          action: 'risk.exception.rollback',
          entityType: 'risk_assessment',
          entityId: riskId,
          before: {
            decisionAuditId: decisionLog.id,
            riskyQuoteStatus: riskyQuote.status,
            alternativeQuoteStatus: alternative.status,
            rfqStatus: riskyQuote.rfqItem.rfq.status,
            removedRecommendationResultId: createdRecommendationResultId,
          },
          after: {
            restoredRiskyQuoteStatus: riskyQuoteStatus,
            restoredAlternativeQuoteStatus: alternativeQuoteStatus,
            restoredRfqStatus: previousRfqStatus,
            rankingRestored: true,
            recommendationRestored: true,
          },
        },
      });

      return true;
    });

    if (!rolledBack) return;
  } catch (error) {
    if (
      error instanceof DecisionConflict ||
      error instanceof RankingRollbackConflict
    ) {
      return;
    }
    console.error('rollbackRiskException failed:', error);
    return;
  }

  if (rfqId) refreshRiskPaths(riskId, rfqId);
}
