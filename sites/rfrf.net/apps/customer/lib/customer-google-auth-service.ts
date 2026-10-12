import { prisma } from '@rafraf/db';
import {
  decideGoogleCustomerAccount,
  type CustomerAccountMatch,
} from './customer-account-linking';
import type { VerifiedGoogleIdentity } from './customer-google-oauth';
import { customerCredentialSubjectKey } from './customer-password';
import { createCustomerRegistrationProof } from './customer-registration-proof';

function accountMatch(
  account: {
    id: string;
    isActive: boolean;
    emailVerifiedAt: Date | null;
    googleSubject: string | null;
    role: { name: string };
  } | null,
): CustomerAccountMatch | null {
  return account
    ? {
        id: account.id,
        active: account.isActive,
        role: account.role.name,
        emailVerified: Boolean(account.emailVerifiedAt),
        googleSubject: account.googleSubject,
      }
    : null;
}

export async function authenticateCustomerWithGoogle(
  identity: VerifiedGoogleIdentity,
): Promise<
  | { status: 'authenticated'; customerId: string }
  | { status: 'registration_required'; registrationProof: string }
  | { status: 'invalid' | 'unavailable' }
> {
  const subjectKey = customerCredentialSubjectKey(identity.email);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${subjectKey}))`;
      const [bySubject, byEmail] = await Promise.all([
        tx.user.findUnique({
          where: { googleSubject: identity.subject },
          include: { role: true, customer: true },
        }),
        tx.user.findUnique({
          where: { emailNormalized: identity.email },
          include: { role: true, customer: true },
        }),
      ]);
      const decision = decideGoogleCustomerAccount({
        bySubject: accountMatch(bySubject),
        byEmail: accountMatch(byEmail),
      });
      if (decision.action === 'register' || decision.action === 'deny') {
        return { action: decision.action } as const;
      }
      const account = decision.action === 'sign_in' ? bySubject : byEmail;
      if (!account?.customer) return { action: 'deny' } as const;
      const now = new Date();
      await tx.user.update({
        where: { id: decision.userId },
        data: {
          lastLoginAt: now,
          ...(decision.action === 'link'
            ? { googleSubject: identity.subject, emailVerifiedAt: now }
            : {}),
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: account.customer.id,
          actorType: 'CUSTOMER',
          action:
            decision.action === 'link'
              ? 'customer.google.linked'
              : 'customer.google.authenticated',
          entityType: 'customer',
          entityId: account.customer.id,
          after: { sessionVersion: 3 },
        },
      });
      return {
        action: 'authenticated',
        customerId: account.customer.id,
      } as const;
    });
    if (result.action === 'authenticated') {
      return { status: 'authenticated', customerId: result.customerId };
    }
    if (result.action === 'register') {
      return {
        status: 'registration_required',
        registrationProof: createCustomerRegistrationProof({
          provider: 'google',
          googleSubject: identity.subject,
          email: identity.email,
          suggestedName: identity.name,
        }),
      };
    }
    return { status: 'invalid' };
  } catch {
    return { status: 'unavailable' };
  }
}
