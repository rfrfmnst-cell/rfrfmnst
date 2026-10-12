import { ActorType, RFQStatus, prisma } from '@rafraf/db';
import { isVerifiedFitment } from '@rafraf/shared/product-os/quote-policy';
import { matchesVehiclePartCompatibility } from '@rafraf/shared/product-os/fitment-match';

const LOCKED_RFQ_STATUSES = new Set<string>([
  RFQStatus.CONVERTED_TO_ORDER,
  RFQStatus.CANCELLED,
]);

export type HumanFitmentReviewErrorCode =
  | 'RFQ_ITEM_NOT_FOUND'
  | 'RFQ_LOCKED'
  | 'PART_REQUIRED'
  | 'VEHICLE_REQUIRED'
  | 'FITMENT_NOT_VERIFIED'
  | 'FITMENT_REVIEW_CHANGED';

export class HumanFitmentReviewError extends Error {
  readonly code: HumanFitmentReviewErrorCode;

  constructor(code: HumanFitmentReviewErrorCode) {
    super(code);
    this.name = 'HumanFitmentReviewError';
    this.code = code;
  }
}

export function isValidReviewedFitment(
  partId: string | null,
  confidence: number | null,
): boolean {
  return (
    confidence != null &&
    Number.isFinite(confidence) &&
    confidence <= 1 &&
    isVerifiedFitment({
      partId,
      fitmentConfidence: confidence,
      humanReviewRequired: false,
    })
  );
}

export interface CompleteHumanFitmentReviewInput {
  rfqItemId: string;
  rfqId: string;
  actorId: string;
}

export interface CompleteHumanFitmentReviewResult {
  reviewed: boolean;
  partId: string;
  fitmentConfidence: number;
}

export async function completeHumanFitmentReview(
  input: CompleteHumanFitmentReviewInput,
  client: typeof prisma = prisma,
): Promise<CompleteHumanFitmentReviewResult> {
  return client.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`fitment-review:${input.rfqItemId}`}))`;

    const item = await tx.rFQItem.findFirst({
      where: { id: input.rfqItemId, rfqId: input.rfqId },
      select: {
        id: true,
        partId: true,
        fitmentConfidence: true,
        humanReviewRequired: true,
        rfq: {
          select: {
            status: true,
            vehicle: {
              select: {
                make: true,
                model: true,
                year: true,
                engine: true,
                marketSpec: true,
              },
            },
          },
        },
      },
    });
    if (!item) throw new HumanFitmentReviewError('RFQ_ITEM_NOT_FOUND');

    if (!item.humanReviewRequired) {
      if (!isValidReviewedFitment(item.partId, item.fitmentConfidence)) {
        throw new HumanFitmentReviewError('FITMENT_NOT_VERIFIED');
      }
      return {
        reviewed: false,
        partId: item.partId!,
        fitmentConfidence: item.fitmentConfidence!,
      };
    }
    if (LOCKED_RFQ_STATUSES.has(item.rfq.status)) {
      throw new HumanFitmentReviewError('RFQ_LOCKED');
    }
    if (!item.partId) throw new HumanFitmentReviewError('PART_REQUIRED');
    if (!item.rfq.vehicle) {
      throw new HumanFitmentReviewError('VEHICLE_REQUIRED');
    }

    const compatibilityCandidates = await tx.partCompatibility.findMany({
      where: {
        partId: item.partId,
        make: { equals: item.rfq.vehicle.make, mode: 'insensitive' },
        model: { equals: item.rfq.vehicle.model, mode: 'insensitive' },
        yearFrom: { lte: item.rfq.vehicle.year },
        yearTo: { gte: item.rfq.vehicle.year },
      },
      orderBy: [{ confidence: 'desc' }, { id: 'asc' }],
      select: {
        id: true,
        confidence: true,
        make: true,
        model: true,
        yearFrom: true,
        yearTo: true,
        engine: true,
        marketSpec: true,
      },
    });
    const compatibility = compatibilityCandidates.find((candidate) =>
      matchesVehiclePartCompatibility(item.rfq.vehicle!, candidate),
    );
    if (
      !compatibility ||
      !isValidReviewedFitment(item.partId, compatibility.confidence)
    ) {
      throw new HumanFitmentReviewError('FITMENT_NOT_VERIFIED');
    }

    const updated = await tx.rFQItem.updateMany({
      where: {
        id: item.id,
        rfqId: input.rfqId,
        partId: item.partId,
        humanReviewRequired: true,
      },
      data: {
        fitmentConfidence: compatibility.confidence,
        humanReviewRequired: false,
      },
    });
    if (updated.count !== 1) {
      throw new HumanFitmentReviewError('FITMENT_REVIEW_CHANGED');
    }

    await tx.auditLog.create({
      data: {
        actorId: input.actorId,
        actorType: ActorType.ADMIN,
        action: 'rfq.item.fitment_review.approved',
        entityType: 'rfq_item',
        entityId: item.id,
        before: {
          partId: item.partId,
          fitmentConfidence: item.fitmentConfidence,
          humanReviewRequired: true,
        },
        after: {
          partId: item.partId,
          fitmentConfidence: compatibility.confidence,
          humanReviewRequired: false,
          compatibilityId: compatibility.id,
        },
      },
    });

    return {
      reviewed: true,
      partId: item.partId,
      fitmentConfidence: compatibility.confidence,
    };
  });
}
