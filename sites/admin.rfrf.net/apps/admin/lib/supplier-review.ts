import { ActorType, prisma, RiskLevel, SupplierStatus } from '@rafraf/db';
import {
  lockReviewedRisks,
  recordReviewedRisk,
} from '@rafraf/orders/src/risk-assessment-writer.ts';
import {
  assertSupplierTransition,
  SupplierTransitionError,
  type SupplierState,
} from '@rafraf/shared';
import { QUALIFYING_SUPPLIER_DOCUMENT_TYPES } from '@rafraf/shared/supplier-document';

const SUPPLIER_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
export const MAX_SUPPLIER_DECISION_REASON_LENGTH = 500;

const DECISION_REASON_REQUIRED = new Set<SupplierStatus>([
  SupplierStatus.LIMITED,
  SupplierStatus.REJECTED,
]);

const REVIEW_ACTION: Readonly<Record<string, string>> = Object.freeze({
  [SupplierStatus.UNDER_REVIEW]: 'supplier.review.started',
  [SupplierStatus.APPROVED]: 'supplier.review.approved',
  [SupplierStatus.LIMITED]: 'supplier.review.limited',
  [SupplierStatus.REJECTED]: 'supplier.review.rejected',
});

export type SupplierReviewOutcome =
  | { outcome: 'APPLIED'; status: SupplierStatus }
  | { outcome: 'REPLAYED'; status: SupplierStatus }
  | { outcome: 'CONFLICT'; status: SupplierStatus }
  | { outcome: 'INVALID_TRANSITION'; status: SupplierStatus }
  | { outcome: 'DOCUMENT_REQUIRED'; status: SupplierStatus }
  | { outcome: 'RISK_REVIEW_REQUIRED'; status: SupplierStatus }
  | { outcome: 'NOT_FOUND' };

export interface SupplierReviewInput {
  supplierId: string;
  actorId: string;
  expectedStatus: SupplierStatus;
  targetStatus: SupplierStatus;
  reason?: string | null;
  documentId?: string | null;
  riskLevel?: string | null;
}

export class SupplierReviewValidationError extends Error {
  readonly code: 'INVALID_ID' | 'REASON_REQUIRED' | 'REASON_TOO_LONG';

  constructor(code: SupplierReviewValidationError['code']) {
    super(code);
    this.name = 'SupplierReviewValidationError';
    this.code = code;
  }
}

/**
 * سبب تشغيلي فقط، بلا بيانات اتصال. الرفض والتقييد لا يكتملان دون سبب،
 * ويُحفظ السبب في سجل التدقيق لا في حقل ملاحظات المورد العام.
 */
export function normalizeSupplierDecisionReason(
  targetStatus: SupplierStatus,
  value?: string | null,
): string | null {
  const normalized = (value ?? '').replace(/\s+/g, ' ').trim();
  if (DECISION_REASON_REQUIRED.has(targetStatus) && normalized.length === 0) {
    throw new SupplierReviewValidationError('REASON_REQUIRED');
  }
  if (normalized.length > MAX_SUPPLIER_DECISION_REASON_LENGTH) {
    throw new SupplierReviewValidationError('REASON_TOO_LONG');
  }
  return normalized || null;
}

/**
 * يغيّر حالة مورد واحد داخل معاملة قابلة للتدقيق:
 * - advisory lock يسلسل القرارات المتزامنة على المورد نفسه.
 * - expectedStatus + updateMany يقدمان CAS دفاعياً حتى لو تغيّر السجل.
 * - الوصول إلى targetStatus مسبقاً إعادة آمنة ولا ينشئ audit مكرراً.
 */
export async function reviewSupplierStatus(
  input: SupplierReviewInput,
  client: typeof prisma = prisma,
): Promise<SupplierReviewOutcome> {
  if (
    !SUPPLIER_ID_PATTERN.test(input.supplierId) ||
    !SUPPLIER_ID_PATTERN.test(input.actorId)
  ) {
    throw new SupplierReviewValidationError('INVALID_ID');
  }

  return client.$transaction(async (tx) => {
    const lockKey = `supplier-review:${input.supplierId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;

    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, status: true },
    });
    if (!supplier) return { outcome: 'NOT_FOUND' };

    // القرار نفسه نجح سابقاً: لا نعيد الكتابة أو سجل التدقيق.
    if (supplier.status === input.targetStatus) {
      return { outcome: 'REPLAYED', status: supplier.status };
    }
    if (supplier.status !== input.expectedStatus) {
      return { outcome: 'CONFLICT', status: supplier.status };
    }
    try {
      assertSupplierTransition(
        supplier.status as SupplierState,
        input.targetStatus as SupplierState,
      );
    } catch (error) {
      if (error instanceof SupplierTransitionError) {
        return { outcome: 'INVALID_TRANSITION', status: supplier.status };
      }
      throw error;
    }
    if (input.targetStatus === SupplierStatus.UNDER_REVIEW) {
      const qualifyingDocument = await tx.supplierDocument.findFirst({
        where: {
          supplierId: supplier.id,
          type: { in: [...QUALIFYING_SUPPLIER_DOCUMENT_TYPES] },
          status: { not: 'REJECTED' },
        },
        select: { id: true },
      });
      if (!qualifyingDocument) {
        return { outcome: 'DOCUMENT_REQUIRED', status: supplier.status };
      }
    }

    let approvedDocumentId: string | null = null;
    if (input.targetStatus === SupplierStatus.APPROVED) {
      const documentId = input.documentId ?? '';
      if (!SUPPLIER_ID_PATTERN.test(documentId)) {
        return { outcome: 'DOCUMENT_REQUIRED', status: supplier.status };
      }
      const qualifyingDocument = await tx.supplierDocument.findFirst({
        where: {
          id: documentId,
          supplierId: supplier.id,
          type: { in: [...QUALIFYING_SUPPLIER_DOCUMENT_TYPES] },
          status: 'PENDING',
        },
        select: { id: true },
      });
      if (!qualifyingDocument) {
        return { outcome: 'DOCUMENT_REQUIRED', status: supplier.status };
      }
      approvedDocumentId = qualifyingDocument.id;
      if (
        input.riskLevel !== RiskLevel.LOW &&
        input.riskLevel !== RiskLevel.MEDIUM
      ) {
        return { outcome: 'RISK_REVIEW_REQUIRED', status: supplier.status };
      }
    }

    const reason = normalizeSupplierDecisionReason(
      input.targetStatus,
      input.reason,
    );
    const action = REVIEW_ACTION[input.targetStatus];
    if (!action) {
      return { outcome: 'INVALID_TRANSITION', status: supplier.status };
    }

    const changed = await tx.supplier.updateMany({
      where: { id: supplier.id, status: supplier.status },
      data: { status: input.targetStatus },
    });
    if (changed.count !== 1) {
      const latest = await tx.supplier.findUnique({
        where: { id: supplier.id },
        select: { status: true },
      });
      if (latest?.status === input.targetStatus) {
        return { outcome: 'REPLAYED', status: latest.status };
      }
      return latest
        ? { outcome: 'CONFLICT', status: latest.status }
        : { outcome: 'NOT_FOUND' };
    }

    if (approvedDocumentId) {
      const approvedDocument = await tx.supplierDocument.updateMany({
        where: {
          id: approvedDocumentId,
          supplierId: supplier.id,
          status: 'PENDING',
        },
        data: { status: 'APPROVED' },
      });
      if (approvedDocument.count !== 1) {
        throw new Error('SUPPLIER_DOCUMENT_APPROVAL_CONFLICT');
      }
    }

    const riskLevel =
      input.targetStatus === SupplierStatus.APPROVED
        ? (input.riskLevel as RiskLevel)
        : input.targetStatus === SupplierStatus.LIMITED
          ? RiskLevel.HIGH
          : input.targetStatus === SupplierStatus.REJECTED
            ? RiskLevel.BLOCKED
            : null;
    const riskAssessmentId = riskLevel
      ? await recordReviewedRisk(tx, {
          entityType: 'supplier',
          entityId: supplier.id,
          actorId: input.actorId,
          riskLevel,
          reasonCode:
            input.targetStatus === SupplierStatus.APPROVED
              ? 'SUPPLIER_APPROVAL'
              : 'SUPPLIER_REVIEW',
        })
      : null;
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action,
        entityType: 'supplier',
        entityId: supplier.id,
        before: { status: supplier.status },
        after: {
          status: input.targetStatus,
          reason,
          ...(approvedDocumentId ? { approvedDocumentId } : {}),
          ...(riskAssessmentId ? { riskAssessmentId } : {}),
        },
      },
    });

    return { outcome: 'APPLIED', status: input.targetStatus };
  });
}

/** Existing approved suppliers need a real review too; no historical backfill. */
export async function reviewApprovedSupplierRisk(
  input: {
    supplierId: string;
    actorId: string;
    riskLevel: string;
    expectedAssessmentId: string | null;
  },
  client: typeof prisma = prisma,
): Promise<SupplierReviewOutcome> {
  if (
    !SUPPLIER_ID_PATTERN.test(input.supplierId) ||
    !SUPPLIER_ID_PATTERN.test(input.actorId)
  ) {
    throw new SupplierReviewValidationError('INVALID_ID');
  }
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-review:${input.supplierId}`}))`;
    const supplier = await tx.supplier.findUnique({
      where: { id: input.supplierId },
      select: { id: true, status: true },
    });
    if (!supplier) return { outcome: 'NOT_FOUND' };
    if (supplier.status !== SupplierStatus.APPROVED)
      return { outcome: 'CONFLICT', status: supplier.status };
    if (!(Object.values(RiskLevel) as string[]).includes(input.riskLevel)) {
      return { outcome: 'RISK_REVIEW_REQUIRED', status: supplier.status };
    }
    await lockReviewedRisks(tx, { supplierId: supplier.id });
    const previous = await tx.riskAssessment.findFirst({
      where: { entityType: 'supplier', entityId: supplier.id },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    if ((previous?.id ?? null) !== input.expectedAssessmentId)
      return { outcome: 'CONFLICT', status: supplier.status };
    const riskAssessmentId = await recordReviewedRisk(tx, {
      entityType: 'supplier',
      entityId: supplier.id,
      actorId: input.actorId,
      riskLevel: input.riskLevel as RiskLevel,
      reasonCode: 'SUPPLIER_REVIEW',
    });
    if (previous?.id === riskAssessmentId)
      return { outcome: 'REPLAYED', status: supplier.status };
    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'supplier.review.risk',
        entityType: 'supplier',
        entityId: supplier.id,
        after: { riskAssessmentId, riskLevel: input.riskLevel },
      },
    });
    return { outcome: 'APPLIED', status: supplier.status };
  });
}
