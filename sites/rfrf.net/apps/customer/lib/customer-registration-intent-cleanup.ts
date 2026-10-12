import type { Prisma } from '@rafraf/db';

export const CUSTOMER_REGISTRATION_INTENT_CLEANUP_LIMIT = 100;

type CleanupClient = Pick<
  Prisma.TransactionClient,
  'customerRegistrationIntent'
>;

export async function cleanupExpiredCustomerRegistrationIntents(
  client: CleanupClient,
  cutoff = new Date(),
): Promise<{ scanned: number; deleted: number; limit: number }> {
  const expired = await client.customerRegistrationIntent.findMany({
    where: { emailVerificationExpiresAt: { lte: cutoff } },
    orderBy: [{ emailVerificationExpiresAt: 'asc' }, { id: 'asc' }],
    select: { id: true },
    take: CUSTOMER_REGISTRATION_INTENT_CLEANUP_LIMIT,
  });
  if (expired.length === 0) {
    return {
      scanned: 0,
      deleted: 0,
      limit: CUSTOMER_REGISTRATION_INTENT_CLEANUP_LIMIT,
    };
  }
  const deleted = await client.customerRegistrationIntent.deleteMany({
    where: {
      id: { in: expired.map(({ id }) => id) },
      emailVerificationExpiresAt: { lte: cutoff },
    },
  });
  return {
    scanned: expired.length,
    deleted: deleted.count,
    limit: CUSTOMER_REGISTRATION_INTENT_CLEANUP_LIMIT,
  };
}
