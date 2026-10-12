import { ActorType, type Prisma } from '@rafraf/db';

export const PUBLIC_INTAKE_LIMITS = {
  perIpPerHour: 8,
  perPhonePerHour: 5,
  globalPerHour: 120,
} as const;

const ACTIONS = {
  ip: 'public.intake.ip_reserved',
  phone: 'public.intake.phone_reserved',
  global: 'public.intake.global_reserved',
} as const;

export type PublicIntakeLimitReason = 'ip' | 'phone' | 'global';

export class PublicIntakeRateLimitError extends Error {
  readonly reason: PublicIntakeLimitReason;

  constructor(reason: PublicIntakeLimitReason) {
    super(`PUBLIC_INTAKE_RATE_LIMIT:${reason}`);
    this.name = 'PublicIntakeRateLimitError';
    this.reason = reason;
  }
}

/**
 * Atomically reserves one public intake attempt before any customer/RFQ/SMS
 * side effect. The opaque HMAC subjects are safe to persist and indexed by the
 * existing AuditLog entity tuple; raw phone/IP values never enter this ledger.
 */
export async function reservePublicIntake(
  tx: Prisma.TransactionClient,
  input: { ipSubject: string; phoneSubject: string; now?: Date },
): Promise<void> {
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
  const subjects = [
    {
      dimension: 'global' as const,
      entityId: 'global',
      action: ACTIONS.global,
    },
    { dimension: 'ip' as const, entityId: input.ipSubject, action: ACTIONS.ip },
    {
      dimension: 'phone' as const,
      entityId: input.phoneSubject,
      action: ACTIONS.phone,
    },
  ];

  // All callers acquire the same dimension order, preventing cross-subject
  // deadlocks while closing parallel count-then-create races.
  for (const subject of subjects) {
    const lockKey = `public-intake:${subject.dimension}:${subject.entityId}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
  }

  const counts = await Promise.all(
    subjects.map((subject) =>
      tx.auditLog.count({
        where: {
          action: subject.action,
          entityType: 'rate_limit_subject',
          entityId: subject.entityId,
          createdAt: { gte: hourAgo },
        },
      }),
    ),
  );
  const globalCount = counts[0] ?? 0;
  const ipCount = counts[1] ?? 0;
  const phoneCount = counts[2] ?? 0;
  if (globalCount >= PUBLIC_INTAKE_LIMITS.globalPerHour) {
    throw new PublicIntakeRateLimitError('global');
  }
  if (ipCount >= PUBLIC_INTAKE_LIMITS.perIpPerHour) {
    throw new PublicIntakeRateLimitError('ip');
  }
  if (phoneCount >= PUBLIC_INTAKE_LIMITS.perPhonePerHour) {
    throw new PublicIntakeRateLimitError('phone');
  }

  for (const subject of subjects) {
    await tx.auditLog.create({
      data: {
        actorType: ActorType.SYSTEM,
        action: subject.action,
        entityType: 'rate_limit_subject',
        entityId: subject.entityId,
        after: { window: 'hour', dimension: subject.dimension },
      },
    });
  }
}
