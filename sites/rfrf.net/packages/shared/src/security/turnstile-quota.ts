export const TURNSTILE_VERIFICATION_LIMITS = Object.freeze({
  ipPerMinute: 12,
  ipPerHour: 120,
  globalPerMinute: 600,
  globalPerHour: 10_000,
} as const);

const ACTION = 'security.turnstile.siteverify_reserved';
const ENTITY_TYPE = 'turnstile_verification';
const GLOBAL_SUBJECT = 'global:turnstile-siteverify';
const OPAQUE_IP_SUBJECT_PATTERN = /^[a-f0-9]{64}$/;

export type TurnstileQuotaDimension = 'ip' | 'global';

export interface TurnstileQuotaCountQuery {
  action: typeof ACTION;
  entityType: typeof ENTITY_TYPE;
  entityId: string;
  since: Date;
}

export interface TurnstileQuotaReservation {
  action: typeof ACTION;
  entityType: typeof ENTITY_TYPE;
  entityId: string;
  dimension: TurnstileQuotaDimension;
}

export interface TurnstileQuotaTransaction {
  count(query: TurnstileQuotaCountQuery): Promise<number>;
  reserve(reservations: readonly TurnstileQuotaReservation[]): Promise<void>;
}

/**
 * The application adapter must hold every advisory lock for the complete
 * callback and commit the reservations in the same durable transaction.
 */
export interface TurnstileQuotaLedger {
  withLockedTransaction<T>(
    lockKeys: readonly string[],
    operation: (transaction: TurnstileQuotaTransaction) => Promise<T>,
  ): Promise<T>;
}

export class TurnstileQuotaConfigurationError extends Error {
  constructor() {
    super('TURNSTILE_QUOTA_CONFIGURATION');
    this.name = 'TurnstileQuotaConfigurationError';
  }
}

export class TurnstileQuotaExceededError extends Error {
  readonly dimension: TurnstileQuotaDimension;

  constructor(dimension: TurnstileQuotaDimension) {
    super(`TURNSTILE_QUOTA_EXCEEDED:${dimension}`);
    this.name = 'TurnstileQuotaExceededError';
    this.dimension = dimension;
  }
}

export class TurnstileQuotaContentionError extends Error {
  constructor() {
    super('TURNSTILE_QUOTA_CONTENDED');
    this.name = 'TurnstileQuotaContentionError';
  }
}

/**
 * Atomically reserves the cheap database gate that precedes Cloudflare's
 * siteverify connection. Only an opaque request-IP HMAC may enter the ledger.
 */
export async function reserveTurnstileVerificationQuota(
  ledger: TurnstileQuotaLedger,
  input: { ipSubject: string; now?: Date },
): Promise<void> {
  if (!OPAQUE_IP_SUBJECT_PATTERN.test(input.ipSubject)) {
    throw new TurnstileQuotaConfigurationError();
  }
  const now = input.now ?? new Date();
  const minuteAgo = new Date(now.getTime() - 60 * 1_000);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
  const subjects = { ip: input.ipSubject, global: GLOBAL_SUBJECT } as const;
  const lockKeys = (
    Object.entries(subjects) as Array<[TurnstileQuotaDimension, string]>
  )
    .map(([dimension, subject]) => `turnstile:${dimension}:${subject}`)
    .sort();

  await ledger.withLockedTransaction(lockKeys, async (transaction) => {
    const query = (entityId: string, since: Date) =>
      transaction.count({
        action: ACTION,
        entityType: ENTITY_TYPE,
        entityId,
        since,
      });
    const [ipMinute, ipHour, globalMinute, globalHour] = await Promise.all([
      query(subjects.ip, minuteAgo),
      query(subjects.ip, hourAgo),
      query(subjects.global, minuteAgo),
      query(subjects.global, hourAgo),
    ]);

    if (
      ipMinute >= TURNSTILE_VERIFICATION_LIMITS.ipPerMinute ||
      ipHour >= TURNSTILE_VERIFICATION_LIMITS.ipPerHour
    ) {
      throw new TurnstileQuotaExceededError('ip');
    }
    if (
      globalMinute >= TURNSTILE_VERIFICATION_LIMITS.globalPerMinute ||
      globalHour >= TURNSTILE_VERIFICATION_LIMITS.globalPerHour
    ) {
      throw new TurnstileQuotaExceededError('global');
    }

    await transaction.reserve(
      (
        Object.entries(subjects) as Array<[TurnstileQuotaDimension, string]>
      ).map(([dimension, entityId]) => ({
        action: ACTION,
        entityType: ENTITY_TYPE,
        entityId,
        dimension,
      })),
    );
  });
}
