import { ActorType, Prisma, prisma } from '@rafraf/db';
import { otoClaimBlocksCompliance } from '@rafraf/shared/workflow/oto-claim';
import {
  assertCertificateTransition,
  assertComplianceReviewTransition,
} from '@rafraf/shared/workflow/compliance-state';
import {
  COMPLIANCE_REVIEW_ORDER_STATUSES,
  ORDER_COMPLIANCE_SELECT,
  orderComplianceLockKey,
  orderComplianceStatus,
  reviewMatchesPart,
} from '@rafraf/shared/workflow/order-compliance';

interface ReviewInput {
  actorId: string;
  orderId: string;
  rfqId: string;
  decision: string;
  expectedCaseId: string;
  expectedUpdatedAt: string;
  confirmed: boolean;
  pcocReference: string;
  scocReference: string;
}

const ID = /^[A-Za-z0-9_-]{1,128}$/;
const REFERENCE = /^[A-Za-z0-9][A-Za-z0-9._:/-]{2,119}$/;

export async function reviewOrderCompliance(
  input: ReviewInput,
  client = prisma,
) {
  if (
    ![input.actorId, input.orderId, input.rfqId].every((id) => ID.test(id)) ||
    !['START_REVIEW', 'APPROVE', 'REJECT'].includes(input.decision)
  )
    return 'INVALID_INPUT';

  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${orderComplianceLockKey(input.orderId)}))`;
    const order = await tx.order.findFirst({
      where: { id: input.orderId, rfqId: input.rfqId },
      select: {
        id: true,
        status: true,
        ...ORDER_COMPLIANCE_SELECT,
        shipments: {
          where: { provider: 'OTO' },
        },
      },
    });
    if (!order || !COMPLIANCE_REVIEW_ORDER_STATUSES.includes(order.status))
      return 'NOT_AVAILABLE';
    // OTO reserves this durable claim under the same lock before dispatching.
    // Even an uncertain provider result must be reconciled before invalidation.
    if (order.shipments.some(otoClaimBlocksCompliance))
      return 'SHIPMENT_CLAIMED';
    const state = orderComplianceStatus(order);
    const part = state.part;
    if (!part) return 'PART_REQUIRED';
    const latest = order.complianceCases[0];
    const sameClassification = reviewMatchesPart(latest, part);
    const required = part.saberRequired || part.sasoScheme !== null;

    if (input.decision === 'START_REVIEW') {
      if (latest?.reviewStatus === 'UNDER_REVIEW' && sameClassification)
        return 'REPLAYED';
      if (
        (latest?.id ?? '') !== input.expectedCaseId ||
        (latest && latest.updatedAt.toISOString() !== input.expectedUpdatedAt)
      )
        return 'REVIEW_CHANGED';
      assertComplianceReviewTransition('PENDING', 'UNDER_REVIEW');
      const created = await tx.complianceCase.create({
        data: {
          orderId: order.id,
          partId: part.id,
          saberRequired: part.saberRequired,
          sasoScheme: part.sasoScheme as 'SCHEME_1A' | 'SCHEME_3' | null,
          reviewStatus: 'UNDER_REVIEW',
          pcocStatus: required ? 'PENDING' : 'NOT_REQUIRED',
          scocStatus: required ? 'PENDING' : 'NOT_REQUIRED',
          assignedTo: input.actorId,
          createdAt: new Date(
            Math.max(Date.now(), (latest?.createdAt.getTime() ?? 0) + 1),
          ),
        },
      });
      await auditReview(tx, input, created.id, 'UNDER_REVIEW');
      return 'RECORDED';
    }
    if (
      !input.confirmed ||
      !latest ||
      latest.id !== input.expectedCaseId ||
      !sameClassification
    )
      return 'REVIEW_CHANGED';
    const status = input.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED';
    if (
      status === 'APPROVED' &&
      required &&
      (!REFERENCE.test(input.pcocReference) ||
        !REFERENCE.test(input.scocReference) ||
        input.pcocReference.normalize('NFKC').trim().toUpperCase() ===
          input.scocReference.normalize('NFKC').trim().toUpperCase())
    )
      return 'CERTIFICATES_REQUIRED';
    const notes =
      status === 'APPROVED' && required
        ? JSON.stringify({
            pcoc: input.pcocReference,
            scoc: input.scocReference,
          })
        : null;
    if (
      latest.reviewStatus === status &&
      latest.assignedTo === input.actorId &&
      latest.notes === notes
    )
      return 'REPLAYED';
    if (
      latest.reviewStatus !== 'UNDER_REVIEW' ||
      latest.updatedAt.toISOString() !== input.expectedUpdatedAt
    )
      return 'REVIEW_CHANGED';
    assertComplianceReviewTransition('UNDER_REVIEW', status);
    if (required && status === 'APPROVED') {
      if (latest.pcocStatus !== 'PENDING' || latest.scocStatus !== 'PENDING')
        return 'REVIEW_CHANGED';
      assertCertificateTransition('PENDING', 'SUBMITTED');
      await tx.complianceCase.update({
        where: { id: latest.id },
        data: { pcocStatus: 'SUBMITTED', scocStatus: 'SUBMITTED', notes },
      });
      await tx.auditLog.create({
        data: {
          actorType: ActorType.ADMIN,
          actorId: input.actorId,
          action: 'order.compliance.certificates_submitted',
          entityType: 'order',
          entityId: input.orderId,
          after: { caseId: latest.id, evidenceSource: 'MANUAL_REVIEW' },
        },
      });
      assertCertificateTransition('SUBMITTED', 'APPROVED');
    }
    await tx.complianceCase.update({
      where: { id: latest.id },
      data: {
        reviewStatus: status,
        assignedTo: input.actorId,
        notes,
        ...(required && status === 'APPROVED'
          ? { pcocStatus: 'APPROVED', scocStatus: 'APPROVED' }
          : {}),
      },
    });
    await auditReview(tx, input, latest.id, status);
    return 'RECORDED';
  });
}

async function auditReview(
  tx: Prisma.TransactionClient,
  input: ReviewInput,
  caseId: string,
  status: string,
) {
  await tx.auditLog.create({
    data: {
      actorType: ActorType.ADMIN,
      actorId: input.actorId,
      action: 'order.compliance.reviewed',
      entityType: 'order',
      entityId: input.orderId,
      after: { caseId, reviewStatus: status, evidenceSource: 'MANUAL_REVIEW' },
    },
  });
}
