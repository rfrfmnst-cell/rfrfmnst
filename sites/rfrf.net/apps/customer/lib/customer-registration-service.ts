import { prisma } from '@rafraf/db';
import { verifyCustomerHumanProof } from './customer-auth-abuse';
import {
  createEmailVerificationChallenge,
  customerEmailConfiguration,
  emailVerificationBrowserHash,
  emailVerificationTokenHash,
  sendCustomerVerificationEmail,
} from './customer-email-verification';
import {
  customerCredentialSubjectKey,
  hashCustomerPassword,
  normalizeCustomerEmail,
  normalizeCustomerName,
  validateCustomerPassword,
} from './customer-password';
import { customerOtpSubjectKey } from './customer-otp';
import { parseCustomerRegistrationProof } from './customer-registration-proof';
import { cleanupExpiredCustomerRegistrationIntents } from './customer-registration-intent-cleanup';

export type CustomerRegistrationResult =
  | {
      status: 'verification_sent';
      browserSecret?: string;
      authenticatedCustomerId?: string;
    }
  | { status: 'invalid' | 'rate_limited' | 'unavailable' };

export async function registerCustomerAccount(input: {
  name: unknown;
  email: unknown;
  password: unknown;
  turnstileToken?: unknown;
  requestIpSubject?: string | null;
  registrationProof?: string;
}): Promise<CustomerRegistrationResult> {
  const name = normalizeCustomerName(input.name);
  const email = normalizeCustomerEmail(input.email);
  const password = input.password;
  const providerProof = parseCustomerRegistrationProof(input.registrationProof);
  if (!name || !email || !validateCustomerPassword(password)) {
    return { status: 'invalid' };
  }
  if (providerProof?.provider === 'google' && providerProof.email !== email) {
    return { status: 'invalid' };
  }
  if (!providerProof) {
    const human = await verifyCustomerHumanProof(
      input.turnstileToken,
      'customer_register',
      input.requestIpSubject ?? null,
    );
    if (human !== 'verified') return { status: human };
  }

  const passwordHash = await hashCustomerPassword(password);
  const emailSubject = customerCredentialSubjectKey(email);

  if (providerProof?.provider !== 'google') {
    const emailConfiguration = customerEmailConfiguration();
    if (!emailConfiguration) return { status: 'unavailable' };
    const challenge = createEmailVerificationChallenge();
    const phone =
      providerProof?.provider === 'phone' ? providerProof.phone : null;
    try {
      const prepared = await prisma.$transaction(async (tx) => {
        await cleanupExpiredCustomerRegistrationIntents(tx);
        const lockKeys = [
          emailSubject,
          ...(phone ? [customerOtpSubjectKey('phone', phone)] : []),
        ].sort();
        for (const lockKey of lockKeys) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        }
        const [existingEmail, existingPhone] = await Promise.all([
          tx.user.findUnique({
            where: { emailNormalized: email },
            select: {
              id: true,
              emailVerifiedAt: true,
              phone: true,
              phoneVerifiedAt: true,
              googleSubject: true,
              isActive: true,
              role: { select: { name: true } },
              customer: { select: { id: true } },
            },
          }),
          phone
            ? tx.user.findUnique({
                where: { phone },
                select: { id: true },
              })
            : Promise.resolve(null),
        ]);
        const reclaimableLegacy = Boolean(
          existingEmail &&
          !existingEmail.emailVerifiedAt &&
          !existingEmail.googleSubject &&
          existingEmail.isActive &&
          existingEmail.role.name === 'CUSTOMER' &&
          existingEmail.customer &&
          (!existingEmail.phoneVerifiedAt ||
            (phone !== null && existingEmail.phone === phone)),
        );
        if (
          (existingEmail && !reclaimableLegacy) ||
          (existingPhone && existingPhone.id !== existingEmail?.id)
        ) {
          return false;
        }
        // Multiple pending attempts are intentional: a later registration must
        // never rotate or invalidate a verification link already delivered.
        await tx.customerRegistrationIntent.create({
          data: {
            email,
            emailNormalized: email,
            fullName: name,
            passwordHash,
            phone,
            emailVerificationTokenHash: challenge.tokenHash,
            emailVerificationBrowserHash: challenge.browserHash,
            emailVerificationExpiresAt: challenge.expiresAt,
          },
        });
        return true;
      });
      if (!prepared) {
        return { status: 'verification_sent' };
      }
      const delivered = await sendCustomerVerificationEmail({
        email,
        name,
        token: challenge.token,
        configuration: emailConfiguration,
      });
      if (!delivered) {
        await prisma.customerRegistrationIntent.deleteMany({
          where: {
            emailNormalized: email,
            emailVerificationTokenHash: challenge.tokenHash,
          },
        });
        await prisma.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            action: 'customer.email.verification_failed',
            entityType: 'customer_registration',
            entityId: emailSubject,
            after: { provider: 'RESEND', identityReserved: false },
          },
        });
        return { status: 'unavailable' };
      }
      await prisma.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'customer.email.verification_delivered',
          entityType: 'customer_registration',
          entityId: emailSubject,
          after: { provider: 'RESEND', identityReserved: false },
        },
      });
      return {
        status: 'verification_sent',
        browserSecret: challenge.browserSecret,
      };
    } catch {
      return { status: 'unavailable' };
    }
  }

  // Google has already proved email ownership. It is the only registration
  // path that may create a User before a separate Rafraf email challenge.
  try {
    const created = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${emailSubject}))`;
      const existingEmail = await tx.user.findUnique({
        where: { emailNormalized: email },
        select: { id: true },
      });
      if (existingEmail) return null;
      const existingGoogle = await tx.user.findUnique({
        where: { googleSubject: providerProof.googleSubject },
        select: { id: true },
      });
      if (existingGoogle) return null;
      const now = new Date();
      return tx.user.create({
        data: {
          email,
          emailNormalized: email,
          emailVerifiedAt: now,
          googleSubject: providerProof.googleSubject,
          passwordHash,
          fullName: name,
          role: { connect: { name: 'CUSTOMER' } },
          customer: { create: { fullName: name } },
        },
        include: { customer: true },
      });
    });

    // Existing and concurrently-created identities intentionally receive the
    // same response as a fresh email registration.
    if (!created) return { status: 'verification_sent' };
    if (!created.customer) return { status: 'unavailable' };
    await prisma.auditLog.create({
      data: {
        actorId: created.customer.id,
        actorType: 'CUSTOMER',
        action: 'customer.google.registered',
        entityType: 'customer',
        entityId: created.customer.id,
        after: { emailVerified: true },
      },
    });
    return {
      status: 'verification_sent',
      authenticatedCustomerId: created.customer.id,
    };
  } catch {
    return { status: 'unavailable' };
  }
}

export async function verifyCustomerEmail(input: {
  token: string;
  browserSecret: string | undefined;
}): Promise<
  | { status: 'verified'; customerId: string }
  | { status: 'invalid' | 'unavailable' }
> {
  if (
    !/^[A-Za-z0-9_-]{43}$/.test(input.token) ||
    !input.browserSecret ||
    !/^[A-Za-z0-9_-]{43}$/.test(input.browserSecret)
  ) {
    return { status: 'invalid' };
  }
  try {
    const tokenHash = emailVerificationTokenHash(input.token);
    const browserHash = emailVerificationBrowserHash(input.browserSecret);
    const intent = await prisma.customerRegistrationIntent.findUnique({
      where: { emailVerificationTokenHash: tokenHash },
    });
    if (intent) {
      if (
        intent.emailVerificationBrowserHash !== browserHash ||
        intent.emailVerificationExpiresAt <= new Date()
      ) {
        return { status: 'invalid' };
      }
      const emailSubject = customerCredentialSubjectKey(intent.emailNormalized);
      const phoneSubject = intent.phone
        ? customerOtpSubjectKey('phone', intent.phone)
        : null;
      const customerId = await prisma.$transaction(async (tx) => {
        for (const lockKey of [emailSubject, phoneSubject]
          .filter((value): value is string => Boolean(value))
          .sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        }
        const current = await tx.customerRegistrationIntent.findUnique({
          where: { emailVerificationTokenHash: tokenHash },
        });
        if (
          !current ||
          current.emailVerificationBrowserHash !== browserHash ||
          current.emailVerificationExpiresAt <= new Date()
        ) {
          return null;
        }
        const [existingEmail, existingPhone] = await Promise.all([
          tx.user.findUnique({
            where: { emailNormalized: current.emailNormalized },
            include: { role: true, customer: true },
          }),
          current.phone
            ? tx.user.findUnique({
                where: { phone: current.phone },
                select: { id: true },
              })
            : Promise.resolve(null),
        ]);
        const reclaimableLegacy = Boolean(
          existingEmail &&
          !existingEmail.emailVerifiedAt &&
          !existingEmail.googleSubject &&
          existingEmail.isActive &&
          existingEmail.role.name === 'CUSTOMER' &&
          existingEmail.customer &&
          (!existingEmail.phoneVerifiedAt ||
            (current.phone !== null && existingEmail.phone === current.phone)),
        );
        if (
          (existingEmail && !reclaimableLegacy) ||
          (existingPhone && existingPhone.id !== existingEmail?.id)
        ) {
          await tx.customerRegistrationIntent.delete({
            where: { id: current.id },
          });
          return null;
        }
        const now = new Date();
        const account = existingEmail
          ? await tx.user.update({
              where: { id: existingEmail.id },
              data: {
                phone: current.phone,
                phoneVerifiedAt: current.phone ? now : null,
                email: current.email,
                emailNormalized: current.emailNormalized,
                emailVerifiedAt: now,
                emailVerificationTokenHash: null,
                emailVerificationBrowserHash: null,
                emailVerificationExpiresAt: null,
                passwordHash: current.passwordHash,
                fullName: current.fullName,
                lastLoginAt: now,
                customer: { update: { fullName: current.fullName } },
              },
              include: { customer: true },
            })
          : await tx.user.create({
              data: {
                phone: current.phone,
                phoneVerifiedAt: current.phone ? now : undefined,
                email: current.email,
                emailNormalized: current.emailNormalized,
                emailVerifiedAt: now,
                passwordHash: current.passwordHash,
                fullName: current.fullName,
                lastLoginAt: now,
                role: { connect: { name: 'CUSTOMER' } },
                customer: { create: { fullName: current.fullName } },
              },
              include: { customer: true },
            });
        if (!account.customer) {
          throw new Error('CUSTOMER_PROFILE_MISSING');
        }
        await tx.customerRegistrationIntent.deleteMany({
          where: {
            OR: [
              { emailNormalized: current.emailNormalized },
              ...(current.phone ? [{ phone: current.phone }] : []),
            ],
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: account.customer.id,
            actorType: 'CUSTOMER',
            action: 'customer.email.verified',
            entityType: 'customer',
            entityId: account.customer.id,
            after: {
              sessionVersion: 3,
              phoneVerified: Boolean(current.phone),
            },
          },
        });
        return account.customer.id;
      });
      return customerId
        ? { status: 'verified', customerId }
        : { status: 'invalid' };
    }

    // Backward-compatible completion for challenges issued by the previous
    // release before registration intents were introduced.
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${tokenHash}))`;
      const account = await tx.user.findUnique({
        where: { emailVerificationTokenHash: tokenHash },
        include: { role: true, customer: true },
      });
      if (
        !account ||
        account.emailVerificationBrowserHash !== browserHash ||
        !account.emailVerificationExpiresAt ||
        account.emailVerificationExpiresAt <= new Date() ||
        !account.isActive ||
        account.role.name !== 'CUSTOMER' ||
        !account.customer
      ) {
        return null;
      }
      const now = new Date();
      await tx.user.update({
        where: { id: account.id },
        data: {
          emailVerifiedAt: now,
          emailVerificationTokenHash: null,
          emailVerificationBrowserHash: null,
          emailVerificationExpiresAt: null,
          lastLoginAt: now,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: account.customer.id,
          actorType: 'CUSTOMER',
          action: 'customer.email.verified',
          entityType: 'customer',
          entityId: account.customer.id,
          after: { sessionVersion: 3 },
        },
      });
      return account.customer.id;
    });
    return result
      ? { status: 'verified', customerId: result }
      : { status: 'invalid' };
  } catch {
    return { status: 'unavailable' };
  }
}
