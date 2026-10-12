export const SUPPLIER_REGISTRATION_LIMITS = {
  phonePerDay: 2,
  ipPerDay: 10,
  globalPerHour: 120,
  globalPerDay: 600,
} as const;

const OPAQUE_SUBJECT_PATTERN = /^(?:phone:|ip:)[A-Za-z0-9_-]{43}$/;
const REGISTRATION_ACTION = 'supplier.registration.requested';
const REGISTRATION_ENTITY_TYPE = 'supplier_registration';
const GLOBAL_SUBJECT = 'global:supplier-registration';

export type SupplierRegistrationQuotaDimension = 'phone' | 'ip' | 'global';

export interface SupplierRegistrationCountQuery {
  action: typeof REGISTRATION_ACTION;
  entityType: typeof REGISTRATION_ENTITY_TYPE;
  entityId: string;
  since: Date;
}

export interface SupplierRegistrationReservation {
  action: typeof REGISTRATION_ACTION;
  entityType: typeof REGISTRATION_ENTITY_TYPE;
  entityId: string;
  dimension: SupplierRegistrationQuotaDimension;
}

export interface SupplierRegistrationQuotaLedger {
  acquireLock(lockKey: string): Promise<void>;
  count(query: SupplierRegistrationCountQuery): Promise<number>;
  reserve(
    reservations: readonly SupplierRegistrationReservation[],
  ): Promise<void>;
}

export class SupplierRegistrationQuotaExceededError extends Error {
  readonly dimension: SupplierRegistrationQuotaDimension;

  constructor(dimension: SupplierRegistrationQuotaDimension) {
    super(`SUPPLIER_REGISTRATION_QUOTA_EXCEEDED:${dimension}`);
    this.name = 'SupplierRegistrationQuotaExceededError';
    this.dimension = dimension;
  }
}

export async function reserveSupplierRegistrationQuota(
  ledger: SupplierRegistrationQuotaLedger,
  input: { phoneSubject: string; ipSubject: string; now?: Date },
): Promise<void> {
  if (
    !OPAQUE_SUBJECT_PATTERN.test(input.phoneSubject) ||
    !OPAQUE_SUBJECT_PATTERN.test(input.ipSubject)
  ) {
    throw new Error('SUPPLIER_REGISTRATION_SUBJECT_INVALID');
  }
  const now = input.now ?? new Date();
  const hourAgo = new Date(now.getTime() - 60 * 60 * 1_000);
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1_000);
  const subjects = {
    phone: input.phoneSubject,
    ip: input.ipSubject,
    global: GLOBAL_SUBJECT,
  } as const;

  const lockKeys = (
    Object.entries(subjects) as Array<
      [SupplierRegistrationQuotaDimension, string]
    >
  )
    .map(
      ([dimension, subject]) => `supplier-registration:${dimension}:${subject}`,
    )
    .sort();
  for (const lockKey of lockKeys) await ledger.acquireLock(lockKey);

  const query = (entityId: string, since: Date) =>
    ledger.count({
      action: REGISTRATION_ACTION,
      entityType: REGISTRATION_ENTITY_TYPE,
      entityId,
      since,
    });
  const [phoneDay, ipDay, globalHour, globalDay] = await Promise.all([
    query(subjects.phone, dayAgo),
    query(subjects.ip, dayAgo),
    query(subjects.global, hourAgo),
    query(subjects.global, dayAgo),
  ]);

  if (phoneDay >= SUPPLIER_REGISTRATION_LIMITS.phonePerDay) {
    throw new SupplierRegistrationQuotaExceededError('phone');
  }
  if (ipDay >= SUPPLIER_REGISTRATION_LIMITS.ipPerDay) {
    throw new SupplierRegistrationQuotaExceededError('ip');
  }
  if (
    globalHour >= SUPPLIER_REGISTRATION_LIMITS.globalPerHour ||
    globalDay >= SUPPLIER_REGISTRATION_LIMITS.globalPerDay
  ) {
    throw new SupplierRegistrationQuotaExceededError('global');
  }

  await ledger.reserve(
    (
      Object.entries(subjects) as Array<
        [SupplierRegistrationQuotaDimension, string]
      >
    ).map(([dimension, entityId]) => ({
      action: REGISTRATION_ACTION,
      entityType: REGISTRATION_ENTITY_TYPE,
      entityId,
      dimension,
    })),
  );
}
