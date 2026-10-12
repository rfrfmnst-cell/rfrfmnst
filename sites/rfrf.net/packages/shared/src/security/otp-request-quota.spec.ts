import {
  OTP_REQUEST_LIMITS,
  OtpQuotaConfigurationError,
  OtpQuotaExceededError,
  reserveOtpRequestQuota,
  type OtpQuotaCountQuery,
  type OtpQuotaLedger,
  type OtpQuotaReservation,
} from './otp-request-quota';

const PHONE_SUBJECT = `phone:${'a'.repeat(64)}`;
const IP_SUBJECT = `ip:${'b'.repeat(64)}`;

function fakeLedger(countFor: (query: OtpQuotaCountQuery) => number = () => 0) {
  const events: Array<
    | { type: 'lock'; key: string }
    | { type: 'count'; query: OtpQuotaCountQuery }
    | { type: 'reserve'; reservations: readonly OtpQuotaReservation[] }
  > = [];
  const ledger: OtpQuotaLedger = {
    async acquireLock(key) {
      events.push({ type: 'lock', key });
    },
    async count(query) {
      events.push({ type: 'count', query });
      return countFor(query);
    },
    async reserve(reservations) {
      events.push({ type: 'reserve', reservations });
    },
  };
  return { events, ledger };
}

const input = {
  portalNamespace: 'customer',
  action: 'customer.otp.requested',
  entityType: 'customer_otp',
  phoneSubject: PHONE_SUBJECT,
  ipSubject: IP_SUBJECT,
};

test('OTP quota acquires deterministic locks before counts and reserves all dimensions', async () => {
  const { events, ledger } = fakeLedger();
  await reserveOtpRequestQuota(ledger, {
    ...input,
    now: new Date('2026-08-22T12:00:00.000Z'),
  });

  const locks = events
    .filter((event) => event.type === 'lock')
    .map((event) => event.key);
  expect(locks).toEqual([...locks].sort());
  expect(events.findIndex((event) => event.type === 'count')).toBeGreaterThan(
    events.map((event) => event.type).lastIndexOf('lock'),
  );
  const reservation = events.find((event) => event.type === 'reserve');
  expect(reservation).toEqual({
    type: 'reserve',
    reservations: expect.arrayContaining([
      expect.objectContaining({ dimension: 'phone', entityId: PHONE_SUBJECT }),
      expect.objectContaining({ dimension: 'ip', entityId: IP_SUBJECT }),
      expect.objectContaining({
        dimension: 'global',
        entityId: 'global:customer',
      }),
    ]),
  });
});

test.each([
  [
    'phone',
    PHONE_SUBJECT,
    24 * 60 * 60 * 1_000,
    OTP_REQUEST_LIMITS.phonePerDay,
  ],
  ['ip', IP_SUBJECT, 24 * 60 * 60 * 1_000, OTP_REQUEST_LIMITS.ipPerDay],
  [
    'global',
    'global:customer',
    60 * 60 * 1_000,
    OTP_REQUEST_LIMITS.globalPerHour,
  ],
] as const)(
  'OTP quota blocks the %s cap before creating a reservation',
  async (dimension, subject, maximumWindowMs, limit) => {
    const now = new Date('2026-08-22T12:00:00.000Z');
    const { events, ledger } = fakeLedger((query) => {
      const windowMs = now.getTime() - query.since.getTime();
      return query.entityId === subject && windowMs === maximumWindowMs
        ? limit
        : 0;
    });

    await expect(
      reserveOtpRequestQuota(ledger, { ...input, now }),
    ).rejects.toMatchObject<OtpQuotaExceededError>({ dimension });
    expect(events.some((event) => event.type === 'reserve')).toBe(false);
  },
);

test('OTP quota rejects raw identifiers before locks or persistence', async () => {
  const { events, ledger } = fakeLedger();
  await expect(
    reserveOtpRequestQuota(ledger, {
      ...input,
      phoneSubject: '+966512345678',
      ipSubject: '203.0.113.10',
    }),
  ).rejects.toBeInstanceOf(OtpQuotaConfigurationError);
  expect(events).toEqual([]);
});
