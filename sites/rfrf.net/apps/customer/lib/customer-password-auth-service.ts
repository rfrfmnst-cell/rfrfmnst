import { authenticationCoreConfigured } from './auth-configuration';
import { prisma } from '@rafraf/db';
import { verifyCustomerHumanProof } from './customer-auth-abuse';
import {
  DUMMY_CUSTOMER_PASSWORD_HASH,
  customerCredentialSubjectKey,
  normalizeCustomerEmail,
  verifyCustomerPassword,
} from './customer-password';

export type CustomerPasswordSignInResult =
  | { status: 'authenticated'; customerId: string }
  | { status: 'invalid' | 'rate_limited' | 'unavailable' };

async function reserveCredentialAttempt(
  email: string,
): Promise<'reserved' | 'rate_limited' | 'unavailable'> {
  const subject = customerCredentialSubjectKey(email);
  try {
    return await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subject}))`;
      const attempts = await tx.auditLog.count({
        where: {
          action: 'customer.password.attempt_reserved',
          entityType: 'customer_credential',
          entityId: subject,
          createdAt: { gte: new Date(Date.now() - 15 * 60 * 1000) },
        },
      });
      if (attempts >= 10) return 'rate_limited' as const;
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'customer.password.attempt_reserved',
          entityType: 'customer_credential',
          entityId: subject,
          after: { reservation: true },
        },
      });
      return 'reserved' as const;
    });
  } catch {
    return 'unavailable';
  }
}

export async function signInCustomerWithPassword(input: {
  email: unknown;
  password: unknown;
  turnstileToken: unknown;
  requestIpSubject: string | null;
}): Promise<CustomerPasswordSignInResult> {
  const email = normalizeCustomerEmail(input.email);
  const password = typeof input.password === 'string' ? input.password : '';
  if (!email || password.length > 128) return { status: 'invalid' };
  if (!authenticationCoreConfigured()) return { status: 'unavailable' };
  const human = await verifyCustomerHumanProof(
    input.turnstileToken,
    'customer_password',
    input.requestIpSubject,
  );
  if (human !== 'verified') return { status: human };
  const reservation = await reserveCredentialAttempt(email);
  if (reservation !== 'reserved') return { status: reservation };

  try {
    const account = await prisma.user.findUnique({
      where: { emailNormalized: email },
      include: { role: true, customer: true },
    });
    const passwordValid = await verifyCustomerPassword(
      password,
      account?.passwordHash ?? DUMMY_CUSTOMER_PASSWORD_HASH,
    );
    if (
      !passwordValid ||
      !account ||
      !account.isActive ||
      account.role.name !== 'CUSTOMER' ||
      !account.emailVerifiedAt ||
      !account.customer
    ) {
      return { status: 'invalid' };
    }
    await prisma.$transaction([
      prisma.user.update({
        where: { id: account.id },
        data: { lastLoginAt: new Date() },
      }),
      prisma.auditLog.create({
        data: {
          actorId: account.customer.id,
          actorType: 'CUSTOMER',
          action: 'customer.password.authenticated',
          entityType: 'customer',
          entityId: account.customer.id,
          after: { sessionVersion: 3 },
        },
      }),
    ]);
    return { status: 'authenticated', customerId: account.customer.id };
  } catch {
    return { status: 'unavailable' };
  }
}
