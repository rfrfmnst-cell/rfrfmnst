'use server';

import { ActorType, Prisma, prisma } from '@rafraf/db';
import {
  OtpQuotaExceededError,
  reserveOtpRequestQuota,
} from '@rafraf/shared/security/otp-request-quota';
import { requestIpSubject } from '@rafraf/shared/security/request-subject';
import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  SUPPLIER_EMAIL_BROWSER_COOKIE,
  SUPPLIER_EMAIL_REGISTRATION_COOKIE,
  createSupplierEmailChallenge,
  normalizeSupplierEmail,
  sendSupplierEmailLink,
  supplierEmailBrowserCookieOptions,
  supplierEmailConfigured,
  supplierEmailRegistrationCookieOptions,
  supplierEmailQuotaSubjectKey,
  supplierEmailSubjectKey,
} from '../../lib/supplier-email-auth';
import {
  createSupplierEmailRegistrationDraft,
  normalizeSupplierEmailRegistration,
} from '../../lib/supplier-email-registration';
import { supplierSessionStatusAllowed } from '../../lib/session-access';
import {
  SupplierRegistrationQuotaExceededError,
  reserveSupplierRegistrationQuota,
} from '../../lib/public-registration-quota';
import { supplierOtpSubjectKey } from '../../lib/supplier-otp';
import { reserveSupplierTurnstileSiteverify } from '../../lib/turnstile-quota';

async function humanVerified(
  formData: FormData,
  action: 'supplier_email_login' | 'supplier_email_register',
): Promise<{ ok: true; ipSubject: string } | { ok: false }> {
  const ipSubject = requestIpSubject(await headers());
  const result = await verifyTurnstileToken({
    token: formData.get('turnstileToken'),
    expectedAction: action,
    reserveSiteverify: () => reserveSupplierTurnstileSiteverify(ipSubject),
  });
  return result.ok && ipSubject ? { ok: true, ipSubject } : { ok: false };
}

async function reserveEmailLoginQuota(
  email: string,
  ipSubject: string,
): Promise<'reserved' | 'rate_limited' | 'unavailable'> {
  try {
    await prisma.$transaction(async (tx) => {
      await reserveOtpRequestQuota(
        {
          acquireLock: async (lockKey) => {
            await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          },
          count: ({ action, entityType, entityId, since }) =>
            tx.auditLog.count({
              where: {
                action,
                entityType,
                entityId,
                createdAt: { gte: since },
              },
            }),
          reserve: async (reservations) => {
            await tx.auditLog.createMany({
              data: reservations.map((reservation) => ({
                actorType: ActorType.SYSTEM,
                action: reservation.action,
                entityType: reservation.entityType,
                entityId: reservation.entityId,
                after: {
                  provider: 'RESEND',
                  channel: 'EMAIL',
                  dimension: reservation.dimension,
                  reservation: true,
                },
              })),
            });
          },
        },
        {
          portalNamespace: 'supplier-email',
          action: 'supplier.email_link.requested',
          entityType: 'supplier_email_auth',
          phoneSubject: supplierEmailQuotaSubjectKey(email),
          ipSubject: supplierOtpSubjectKey('ip', ipSubject),
        },
      );
    });
    return 'reserved';
  } catch (error) {
    return error instanceof OtpQuotaExceededError
      ? 'rate_limited'
      : 'unavailable';
  }
}

async function deliverChallenge(input: {
  email: string;
  purpose: 'login' | 'register';
  supplierId?: string;
  registrationDraft?: string;
}): Promise<boolean> {
  const challenge = createSupplierEmailChallenge(input);
  const cookieStore = await cookies();
  cookieStore.set(
    SUPPLIER_EMAIL_BROWSER_COOKIE,
    challenge.browserSecret,
    supplierEmailBrowserCookieOptions,
  );
  if (input.registrationDraft) {
    cookieStore.set(
      SUPPLIER_EMAIL_REGISTRATION_COOKIE,
      input.registrationDraft,
      supplierEmailRegistrationCookieOptions,
    );
  } else {
    cookieStore.delete(SUPPLIER_EMAIL_REGISTRATION_COOKIE);
  }
  const delivered = await sendSupplierEmailLink({
    email: input.email,
    token: challenge.token,
    purpose: input.purpose,
  });
  if (!delivered) {
    cookieStore.delete(SUPPLIER_EMAIL_BROWSER_COOKIE);
    cookieStore.delete(SUPPLIER_EMAIL_REGISTRATION_COOKIE);
  }
  return delivered;
}

export async function requestSupplierEmailLogin(formData: FormData) {
  const email = normalizeSupplierEmail(formData.get('email'));
  if (!email) redirect('/login?err=invalid_email');
  if (!supplierEmailConfigured()) redirect('/login?err=unavailable');
  const human = await humanVerified(formData, 'supplier_email_login');
  if (!human.ok) redirect('/login?err=verification_failed');
  const quota = await reserveEmailLoginQuota(email, human.ipSubject);
  if (quota !== 'reserved') redirect(`/login?err=${quota}`);

  try {
    const suppliers = await prisma.supplier.findMany({
      where: { contactEmail: { equals: email, mode: 'insensitive' } },
      select: { id: true, status: true },
      take: 2,
    });
    const [onlySupplier] = suppliers;
    const supplier =
      onlySupplier &&
      suppliers.length === 1 &&
      supplierSessionStatusAllowed(onlySupplier.status)
        ? onlySupplier
        : null;

    // The response is deliberately identical for unknown, duplicate, suspended,
    // and valid addresses so the public form cannot enumerate suppliers.
    if (supplier) {
      const delivered = await deliverChallenge({
        email,
        purpose: 'login',
        supplierId: supplier.id,
      });
      await prisma.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: delivered
            ? 'supplier.email_link.delivered'
            : 'supplier.email_link.delivery_failed',
          entityType: 'supplier_email_auth',
          entityId: supplierEmailSubjectKey(email),
          after: { provider: 'RESEND', channel: 'EMAIL' },
        },
      });
    }
  } catch {
    console.warn('[supplier-email-auth]', { code: 'LOGIN_UNAVAILABLE' });
    redirect('/login?err=unavailable');
  }
  redirect('/login?step=check_email');
}

export async function requestSupplierEmailRegistration(formData: FormData) {
  const normalized = normalizeSupplierEmailRegistration({
    businessName: formData.get('businessName'),
    city: formData.get('city'),
    countryCode: formData.get('countryCode'),
    legalRegistrationNumber: formData.get('legalRegistrationNumber'),
    phone: formData.get('phone'),
    email: formData.get('email'),
  });
  if (!normalized) redirect('/login?mode=register&err=invalid_registration');
  if (!supplierEmailConfigured())
    redirect('/login?mode=register&err=unavailable');
  const human = await humanVerified(formData, 'supplier_email_register');
  if (!human.ok) redirect('/login?mode=register&err=verification_failed');
  const emailQuota = await reserveEmailLoginQuota(
    normalized.email,
    human.ipSubject,
  );
  if (emailQuota !== 'reserved')
    redirect(`/login?mode=register&err=${emailQuota}`);

  const phoneKey = supplierOtpSubjectKey('phone', normalized.phone);
  const ipKey = supplierOtpSubjectKey('ip', human.ipSubject);
  try {
    await prisma.$transaction(
      async (tx) => {
        await reserveSupplierRegistrationQuota(
          {
            acquireLock: async (lockKey) => {
              await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
            },
            count: ({ action, entityType, entityId, since }) =>
              tx.auditLog.count({
                where: {
                  action,
                  entityType,
                  entityId,
                  createdAt: { gte: since },
                },
              }),
            reserve: async (reservations) => {
              await tx.auditLog.createMany({
                data: reservations.map((reservation) => ({
                  actorType: ActorType.SYSTEM,
                  action: reservation.action,
                  entityType: reservation.entityType,
                  entityId: reservation.entityId,
                  after: {
                    dimension: reservation.dimension,
                    reservation: true,
                  },
                })),
              });
            },
          },
          { phoneSubject: phoneKey, ipSubject: ipKey },
        );
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );
  } catch (error) {
    redirect(
      `/login?mode=register&err=${
        error instanceof SupplierRegistrationQuotaExceededError
          ? 'rate_limited'
          : 'unavailable'
      }`,
    );
  }

  let destination = '/login?step=check_email';
  try {
    const matches = await prisma.supplier.findMany({
      where: {
        OR: [
          { contactPhone: normalized.phone },
          { contactEmail: { equals: normalized.email, mode: 'insensitive' } },
        ],
      },
      select: { id: true, status: true, contactEmail: true },
      take: 3,
    });
    const existingByEmail = matches.find(
      (item) => item.contactEmail?.toLowerCase() === normalized.email,
    );
    const phoneOwnedElsewhere = matches.some(
      (item) => item.id !== existingByEmail?.id,
    );
    if (
      existingByEmail &&
      !phoneOwnedElsewhere &&
      supplierSessionStatusAllowed(existingByEmail.status)
    ) {
      await deliverChallenge({
        email: normalized.email,
        purpose: 'login',
        supplierId: existingByEmail.id,
      });
    } else if (!matches.length) {
      const registrationDraft =
        createSupplierEmailRegistrationDraft(normalized);
      const delivered = await deliverChallenge({
        email: normalized.email,
        purpose: 'register',
        registrationDraft,
      });
      await prisma.auditLog.create({
        data: {
          actorType: ActorType.SYSTEM,
          action: delivered
            ? 'supplier.registration.email_delivered'
            : 'supplier.registration.email_delivery_failed',
          entityType: 'supplier_registration',
          entityId: supplierEmailSubjectKey(normalized.email),
          after: { provider: 'RESEND', channel: 'EMAIL' },
        },
      });
      destination = delivered
        ? '/login?step=check_email&registration=1'
        : '/login?mode=register&err=delivery';
    }
  } catch {
    console.warn('[supplier-email-auth]', { code: 'REGISTRATION_UNAVAILABLE' });
    destination = '/login?mode=register&err=unavailable';
  }
  redirect(destination);
}
