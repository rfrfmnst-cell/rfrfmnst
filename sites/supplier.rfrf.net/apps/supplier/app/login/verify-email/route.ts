import { ActorType, SupplierStatus, prisma } from '@rafraf/db';
import { redirectOrigin } from '@rafraf/shared/public-origin';
import { cookies } from 'next/headers';
import {
  SUPPLIER_EMAIL_BROWSER_COOKIE,
  SUPPLIER_EMAIL_REGISTRATION_COOKIE,
  parseSupplierEmailChallenge,
  supplierEmailChallengeKey,
  supplierEmailSubjectKey,
} from '../../../lib/supplier-email-auth';
import { parseSupplierEmailRegistrationDraft } from '../../../lib/supplier-email-registration';
import { signSession } from '../../../lib/session';
import { supplierSessionStatusAllowed } from '../../../lib/session-access';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const requestUrl = new URL(request.url);
  const origin = redirectOrigin(
    process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
    request.url,
  );
  const cookieStore = await cookies();
  const challenge = parseSupplierEmailChallenge(
    requestUrl.searchParams.get('token') ?? '',
    cookieStore.get(SUPPLIER_EMAIL_BROWSER_COOKIE)?.value,
  );
  const registrationDraft = parseSupplierEmailRegistrationDraft(
    cookieStore.get(SUPPLIER_EMAIL_REGISTRATION_COOKIE)?.value,
  );
  cookieStore.delete(SUPPLIER_EMAIL_BROWSER_COOKIE);
  cookieStore.delete(SUPPLIER_EMAIL_REGISTRATION_COOKIE);
  if (!challenge) {
    return Response.redirect(new URL('/login?err=email_verification', origin));
  }

  const challengeKey = supplierEmailChallengeKey(challenge.nonce);
  const emailKey = supplierEmailSubjectKey(challenge.email);
  let supplierId: string | null = null;
  try {
    supplierId = await prisma.$transaction(async (tx) => {
      for (const lockKey of [challengeKey, emailKey].sort()) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      }
      const consumed = await tx.auditLog.count({
        where: {
          action: 'supplier.email_link.consumed',
          entityType: 'supplier_email_challenge',
          entityId: challengeKey,
        },
      });
      if (consumed) return null;

      let supplier: { id: string; status: string } | null = null;
      let registrationCreated = false;
      if (challenge.purpose === 'login' && challenge.supplierId) {
        const account = await tx.supplier.findUnique({
          where: { id: challenge.supplierId },
          select: { id: true, status: true, contactEmail: true },
        });
        if (account?.contactEmail?.toLowerCase() === challenge.email) {
          supplier = account;
        }
      } else if (
        challenge.purpose === 'register' &&
        registrationDraft?.email === challenge.email
      ) {
        const matches = await tx.supplier.findMany({
          where: {
            OR: [
              { contactPhone: registrationDraft.phone },
              {
                contactEmail: {
                  equals: registrationDraft.email,
                  mode: 'insensitive',
                },
              },
            ],
          },
          select: { id: true, status: true, contactEmail: true },
          take: 3,
        });
        const existingByEmail = matches.find(
          (item) =>
            item.contactEmail?.toLowerCase() === registrationDraft.email,
        );
        const phoneOwnedElsewhere = matches.some(
          (item) => item.id !== existingByEmail?.id,
        );
        if (existingByEmail && !phoneOwnedElsewhere) {
          supplier = existingByEmail;
        } else if (!matches.length) {
          supplier = await tx.supplier.create({
            data: {
              businessName: registrationDraft.businessName,
              city: registrationDraft.city,
              countryCode: registrationDraft.countryCode,
              crNumber: registrationDraft.legalRegistrationNumber,
              contactPhone: registrationDraft.phone,
              contactEmail: registrationDraft.email,
              status: SupplierStatus.PENDING,
            },
            select: { id: true, status: true },
          });
          registrationCreated = true;
          await tx.auditLog.create({
            data: {
              actorId: supplier.id,
              actorType: ActorType.SUPPLIER,
              action: 'supplier.registered',
              entityType: 'supplier',
              entityId: supplier.id,
              after: {
                countryCode: registrationDraft.countryCode,
                status: SupplierStatus.PENDING,
                emailVerified: true,
                authentication: 'email_link_v1',
              },
            },
          });
        }
      }

      const allowed =
        supplier && supplierSessionStatusAllowed(supplier.status)
          ? supplier
          : null;
      await tx.auditLog.create({
        data: {
          actorId: allowed?.id,
          actorType: allowed ? ActorType.SUPPLIER : ActorType.SYSTEM,
          action: 'supplier.email_link.consumed',
          entityType: 'supplier_email_challenge',
          entityId: challengeKey,
          after: {
            outcome: allowed ? 'VERIFIED' : 'NOT_ALLOWED',
            purpose: challenge.purpose,
            registrationCreated,
          },
        },
      });
      return allowed?.id ?? null;
    });
  } catch {
    console.error('[auth:supplier] email verification failed', {
      code: 'SUPPLIER_EMAIL_VERIFICATION_ERROR',
    });
  }

  if (!supplierId) {
    return Response.redirect(new URL('/login?err=email_verification', origin));
  }
  cookieStore.set('sp_auth', await signSession(supplierId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  return Response.redirect(new URL('/', origin));
}
