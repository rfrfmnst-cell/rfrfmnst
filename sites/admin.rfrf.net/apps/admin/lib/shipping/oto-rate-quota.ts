import { ActorType, prisma, type Prisma } from '@rafraf/db';

export const OTO_RATE_QUOTA_LIMITS = {
  globalPerMinute: 60,
  perAdminPerMinute: 20,
} as const;

const OTO_RATE_QUOTA_ACTION = 'oto.rate.requested';
const OTO_RATE_QUOTA_ENTITY_TYPE = 'oto_rate_quota';
const GLOBAL_SUBJECT = 'global:oto-rates';
const ADMIN_USER_ID_PATTERN = /^[A-Za-z0-9_-]{1,191}$/u;

export type OtoRateQuotaDimension = 'global' | 'admin';

export interface OtoRateQuotaCountQuery {
  action: typeof OTO_RATE_QUOTA_ACTION;
  entityType: typeof OTO_RATE_QUOTA_ENTITY_TYPE;
  entityId: string;
  since: Date;
}

export interface OtoRateQuotaReservation {
  action: typeof OTO_RATE_QUOTA_ACTION;
  entityType: typeof OTO_RATE_QUOTA_ENTITY_TYPE;
  entityId: string;
  dimension: OtoRateQuotaDimension;
}

export interface OtoRateQuotaLedger {
  acquireLock(lockKey: string): Promise<void>;
  count(query: OtoRateQuotaCountQuery): Promise<number>;
  reserve(reservations: readonly OtoRateQuotaReservation[]): Promise<void>;
}

export class OtoRateQuotaExceededError extends Error {
  readonly code = 'OTO_RATE_QUOTA_EXCEEDED';
  readonly dimension: OtoRateQuotaDimension;

  constructor(dimension: OtoRateQuotaDimension) {
    super(`OTO_RATE_QUOTA_EXCEEDED:${dimension}`);
    this.name = 'OtoRateQuotaExceededError';
    this.dimension = dimension;
  }
}

export class OtoRateQuotaUnavailableError extends Error {
  readonly code = 'OTO_RATE_QUOTA_UNAVAILABLE';

  constructor() {
    super('OTO_RATE_QUOTA_UNAVAILABLE');
    this.name = 'OtoRateQuotaUnavailableError';
  }
}

/**
 * Atomically reserves a global and per-admin OTO rate attempt. All locks are
 * acquired before any count, and the ledger stores only quota subjects and
 * dimensions: never cities, provider bodies, or tokens.
 */
export async function reserveOtoRateQuota(
  ledger: OtoRateQuotaLedger,
  input: { adminUserId: string; now?: Date },
): Promise<void> {
  if (!ADMIN_USER_ID_PATTERN.test(input.adminUserId)) {
    throw new Error('OTO_RATE_QUOTA_ADMIN_INVALID');
  }

  const now = input.now ?? new Date();
  const minuteAgo = new Date(now.getTime() - 60_000);
  const subjects = {
    global: GLOBAL_SUBJECT,
    admin: `admin:${input.adminUserId}`,
  } as const;

  const lockKeys = (
    Object.entries(subjects) as Array<[OtoRateQuotaDimension, string]>
  )
    .map(([dimension, entityId]) => `oto-rate:${dimension}:${entityId}`)
    .sort();
  for (const lockKey of lockKeys) await ledger.acquireLock(lockKey);

  const count = (entityId: string) =>
    ledger.count({
      action: OTO_RATE_QUOTA_ACTION,
      entityType: OTO_RATE_QUOTA_ENTITY_TYPE,
      entityId,
      since: minuteAgo,
    });
  const [globalCount, adminCount] = await Promise.all([
    count(subjects.global),
    count(subjects.admin),
  ]);

  if (globalCount >= OTO_RATE_QUOTA_LIMITS.globalPerMinute) {
    throw new OtoRateQuotaExceededError('global');
  }
  if (adminCount >= OTO_RATE_QUOTA_LIMITS.perAdminPerMinute) {
    throw new OtoRateQuotaExceededError('admin');
  }

  await ledger.reserve(
    (Object.entries(subjects) as Array<[OtoRateQuotaDimension, string]>).map(
      ([dimension, entityId]) => ({
        action: OTO_RATE_QUOTA_ACTION,
        entityType: OTO_RATE_QUOTA_ENTITY_TYPE,
        entityId,
        dimension,
      }),
    ),
  );
}

/**
 * The transaction-scoped advisory locks make the quota distributed across
 * Vercel instances. Any database error fails closed before OTO is contacted.
 */
export async function reserveOtoRateQuotaForAdmin(
  adminUserId: string,
  now = new Date(),
): Promise<void> {
  try {
    await prisma.$transaction(async (tx) => {
      const ledger: OtoRateQuotaLedger = {
        async acquireLock(lockKey) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        },
        count(query) {
          return tx.auditLog.count({
            where: {
              action: query.action,
              entityType: query.entityType,
              entityId: query.entityId,
              createdAt: { gte: query.since },
            },
          });
        },
        async reserve(reservations) {
          const data: Prisma.AuditLogCreateManyInput[] = reservations.map(
            (reservation) => ({
              actorId: adminUserId,
              actorType: ActorType.ADMIN,
              action: reservation.action,
              entityType: reservation.entityType,
              entityId: reservation.entityId,
              after: {
                window: 'minute',
                dimension: reservation.dimension,
              },
            }),
          );
          await tx.auditLog.createMany({ data });
        },
      };
      await reserveOtoRateQuota(ledger, { adminUserId, now });
    });
  } catch (error) {
    if (error instanceof OtoRateQuotaExceededError) throw error;
    console.error('[shipping-rate] OTO quota unavailable', {
      code: 'OTO_RATE_QUOTA_UNAVAILABLE',
    });
    throw new OtoRateQuotaUnavailableError();
  }
}
