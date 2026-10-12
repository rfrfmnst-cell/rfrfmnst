export const OTP_REQUEST_LIMITS = {
  phonePerTenMinutes: 3,
  ipPerTenMinutes: 12,
  phonePerDay: 8,
  ipPerDay: 40,
  globalPerHour: 300,
  globalPerDay: 2_000,
} as const;

const OPAQUE_SUBJECT_PATTERN =
  /^(?:phone:|ip:)?(?:[A-Za-z0-9_-]{43}|[a-f0-9]{64})$/;
const NAMESPACE_PATTERN = /^[a-z][a-z0-9_-]{1,31}$/;
const ACTION_PATTERN = /^[a-z][a-z0-9_.-]{2,95}$/;

export type OtpQuotaDimension = 'phone' | 'ip' | 'global';

export interface OtpQuotaCountQuery {
  action: string;
  entityType: string;
  entityId: string;
  since: Date;
}

export interface OtpQuotaReservation {
  action: string;
  entityType: string;
  entityId: string;
  dimension: OtpQuotaDimension;
}

/**
 * Application adapters keep Prisma out of this package while this helper owns
 * the lock -> count -> reservation order. Every subject accepted here must
 * already be an opaque HMAC; raw phone numbers and addresses fail closed.
 */
export interface OtpQuotaLedger {
  acquireLock(lockKey: string): Promise<void>;
  count(query: OtpQuotaCountQuery): Promise<number>;
  reserve(reservations: readonly OtpQuotaReservation[]): Promise<void>;
}

export class OtpQuotaConfigurationError extends Error {
  constructor() {
    super('OTP_QUOTA_CONFIGURATION');
    this.name = 'OtpQuotaConfigurationError';
  }
}

export class OtpQuotaExceededError extends Error {
  readonly dimension: OtpQuotaDimension;

  constructor(dimension: OtpQuotaDimension) {
    super(`OTP_QUOTA_EXCEEDED:${dimension}`);
    this.name = 'OtpQuotaExceededError';
    this.dimension = dimension;
  }
}

function assertConfiguration(input: {
  portalNamespace: string;
  action: string;
  entityType: string;
  phoneSubject: string;
  ipSubject: string;
}) {
  if (
    !NAMESPACE_PATTERN.test(input.portalNamespace) ||
    !ACTION_PATTERN.test(input.action) ||
    !NAMESPACE_PATTERN.test(input.entityType) ||
    !OPAQUE_SUBJECT_PATTERN.test(input.phoneSubject) ||
    !OPAQUE_SUBJECT_PATTERN.test(input.ipSubject)
  ) {
    throw new OtpQuotaConfigurationError();
  }
}

export async function reserveOtpRequestQuota(
  ledger: OtpQuotaLedger,
  input: {
    portalNamespace: string;
    action: string;
    entityType: string;
    phoneSubject: string;
    ipSubject: string;
    now?: Date;
  },
): Promise<void> {
  assertConfiguration(input);
  const now = input.now ?? new Date();
  const tenMinutesAgo = new Date(now.getTime() - 10 * 60 * 1_000);
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const globalSubject = `global:${input.portalNamespace}`;
  const subjects = {
    phone: input.phoneSubject,
    ip: input.ipSubject,
    global: globalSubject,
  } as const;

  const lockKeys = (
    Object.entries(subjects) as Array<[OtpQuotaDimension, string]>
  )
    .map(
      ([dimension, subject]) =>
        `otp-request:${input.portalNamespace}:${dimension}:${subject}`,
    )
    .sort();
  for (const lockKey of lockKeys) await ledger.acquireLock(lockKey);

  const query = (entityId: string, since: Date) =>
    ledger.count({
      action: input.action,
      entityType: input.entityType,
      entityId,
      since,
    });
  const [
    phoneTenMinutes,
    ipTenMinutes,
    phoneDay,
    ipDay,
    globalHour,
    globalDay,
  ] = await Promise.all([
    query(subjects.phone, tenMinutesAgo),
    query(subjects.ip, tenMinutesAgo),
    query(subjects.phone, dayAgo),
    query(subjects.ip, dayAgo),
    query(subjects.global, hourAgo),
    query(subjects.global, dayAgo),
  ]);

  if (
    phoneTenMinutes >= OTP_REQUEST_LIMITS.phonePerTenMinutes ||
    phoneDay >= OTP_REQUEST_LIMITS.phonePerDay
  ) {
    throw new OtpQuotaExceededError('phone');
  }
  if (
    ipTenMinutes >= OTP_REQUEST_LIMITS.ipPerTenMinutes ||
    ipDay >= OTP_REQUEST_LIMITS.ipPerDay
  ) {
    throw new OtpQuotaExceededError('ip');
  }
  if (
    globalHour >= OTP_REQUEST_LIMITS.globalPerHour ||
    globalDay >= OTP_REQUEST_LIMITS.globalPerDay
  ) {
    throw new OtpQuotaExceededError('global');
  }

  await ledger.reserve(
    (Object.entries(subjects) as Array<[OtpQuotaDimension, string]>).map(
      ([dimension, entityId]) => ({
        action: input.action,
        entityType: input.entityType,
        entityId,
        dimension,
      }),
    ),
  );
}
