import { prisma } from '@rafraf/db';
import {
  TurnstileQuotaContentionError,
  TurnstileQuotaExceededError,
  reserveTurnstileVerificationQuota,
} from '@rafraf/shared/security/turnstile-quota';

export async function reserveSupplierTurnstileSiteverify(
  ipSubject: string | null,
): Promise<'reserved' | 'rate_limited'> {
  if (!ipSubject) throw new Error('TURNSTILE_IP_SUBJECT_UNAVAILABLE');
  try {
    await reserveTurnstileVerificationQuota(
      {
        withLockedTransaction: (lockKeys, operation) =>
          prisma.$transaction(async (tx) => {
            for (const lockKey of lockKeys) {
              const rows = await tx.$queryRaw<Array<{ locked: boolean }>>`
                SELECT pg_try_advisory_xact_lock(hashtext(${lockKey})) AS "locked"
              `;
              if (rows[0]?.locked !== true) {
                throw new TurnstileQuotaContentionError();
              }
            }
            return operation({
              count: ({ action, entityType, entityId, since }) =>
                tx.auditLog.count({
                  where: {
                    action,
                    entityType,
                    entityId,
                    createdAt: { gte: since },
                  },
                }),
              reserve: async (reservations) => {
                await tx.auditLog.createMany({
                  data: reservations.map((reservation) => ({
                    actorType: 'SYSTEM' as const,
                    action: reservation.action,
                    entityType: reservation.entityType,
                    entityId: reservation.entityId,
                    after: {
                      dimension: reservation.dimension,
                      reservation: true,
                    },
                  })),
                });
              },
            });
          }),
      },
      { ipSubject },
    );
    return 'reserved';
  } catch (error) {
    if (
      error instanceof TurnstileQuotaExceededError ||
      error instanceof TurnstileQuotaContentionError
    ) {
      return 'rate_limited';
    }
    console.error('[security:turnstile] supplier quota unavailable', {
      code: 'TURNSTILE_QUOTA_ERROR',
      errorType: error instanceof Error ? error.name : 'unknown',
    });
    throw error;
  }
}
