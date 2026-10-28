'use server';

import { prisma, SupplierStatus } from '@rafraf/db';
import {
  OtpQuotaExceededError,
  reserveOtpRequestQuota,
} from '@rafraf/shared/security/otp-request-quota';
import { requestIpSubject } from '@rafraf/shared/security/request-subject';
import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import {
  checkTwilioVerification,
  sendTwilioVerification,
} from '@rafraf/shared/twilio-verify';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import {
  MAX_SUPPLIER_OTP_ATTEMPTS,
  SUPPLIER_OTP_COOKIE,
  SUPPLIER_OTP_TTL_SECONDS,
  createSupplierOtpChallenge,
  parseSupplierOtpChallenge,
  setSupplierOtpAttempts,
  supplierOtpChallengeKey,
  supplierOtpSubjectKey,
  verifySupplierOtpCode,
} from '../../lib/supplier-otp';
import {
  supplierLocalOtpEnabled,
  supplierOtpAuditChannel,
  supplierOtpSecurityConfigured,
  supplierOtpSecurityReady,
} from '../../lib/supplier-otp-delivery';
import {
  SUPPLIER_REGISTRATION_COOKIE,
  parseSupplierRegistrationDraft,
} from '../../lib/supplier-registration-draft';
import { reserveSupplierTurnstileSiteverify } from '../../lib/turnstile-quota';
import { signSession } from '../../lib/session';
import { normalizeSupplierPhone } from '../../lib/supplier-phone';
import { normalizeOtpCode } from '../../lib/auth-input';
import { supplierSessionStatusAllowed } from '../../lib/session-access.ts';

function challengeCookieOptions(maxAge = SUPPLIER_OTP_TTL_SECONDS) {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict' as const,
    path: '/',
    maxAge,
  };
}

export async function requestOtp(formData: FormData) {
  const phone = normalizeSupplierPhone(formData.get('phone'));
  if (!phone) redirect('/login?mode=phone&err=invalid_phone');
  const cookieStore = await cookies();
  const retryingRegistration = formData.get('registration') === '1';
  if (
    retryingRegistration &&
    parseSupplierRegistrationDraft(
      cookieStore.get(SUPPLIER_REGISTRATION_COOKIE)?.value,
    )?.phone !== phone
  ) {
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    redirect('/login?mode=register&err=registration_expired');
  }
  if (!supplierOtpSecurityConfigured()) {
    console.error('[auth:supplier] configuration unavailable', {
      code: 'SESSION_SECRET_INVALID',
    });
    redirect('/login?mode=phone&err=unavailable');
  }

  const headerStore = await headers();
  const ipSubject = requestIpSubject(headerStore);
  const humanProof = await verifyTurnstileToken({
    token: formData.get('turnstileToken'),
    expectedAction: 'supplier_otp',
    reserveSiteverify: () => reserveSupplierTurnstileSiteverify(ipSubject),
  });
  if (!humanProof.ok) {
    redirect(
      `/login?mode=phone&err=${
        humanProof.reason === 'configuration' ||
        humanProof.reason === 'unavailable'
          ? 'unavailable'
          : 'verification_failed'
      }`,
    );
  }

  if (!ipSubject) redirect('/login?mode=phone&err=unavailable');
  const phoneKey = supplierOtpSubjectKey('phone', phone);
  const ipKey = supplierOtpSubjectKey('ip', ipSubject);

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
                actorType: 'SYSTEM' as const,
                action: reservation.action,
                entityType: reservation.entityType,
                entityId: reservation.entityId,
                after: {
                  provider: supplierLocalOtpEnabled()
                    ? 'LOCAL'
                    : 'TWILIO_VERIFY',
                  channel: supplierOtpAuditChannel(),
                  dimension: reservation.dimension,
                  reservation: true,
                },
              })),
            });
          },
        },
        {
          portalNamespace: 'supplier',
          action: 'supplier.otp.requested',
          entityType: 'supplier_otp',
          phoneSubject: phoneKey,
          ipSubject: ipKey,
        },
      );
    });
  } catch (error) {
    if (error instanceof OtpQuotaExceededError) {
      redirect('/login?mode=phone&err=rate_limited');
    }
    console.error('[auth:supplier] database unavailable', {
      code: 'OTP_RATE_LIMIT_DATABASE_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
    redirect('/login?mode=phone&err=unavailable');
  }

  // Reserve the request quota before any provider call. This bounds outbound
  // readiness probes even while an attacker keeps retrying a valid number.
  if (!(await supplierOtpSecurityReady())) {
    console.error('[auth:supplier] provider unavailable', {
      code: 'OTP_PROVIDER_UNAVAILABLE',
    });
    redirect('/login?mode=phone&err=unavailable');
  }

  const challenge = createSupplierOtpChallenge(phone);
  const localDelivery = supplierLocalOtpEnabled();
  // Send the same verification flow for every valid, rate-limited number.
  // Supplier eligibility is checked only after the phone owner proves possession.
  const delivered = localDelivery || (await sendTwilioVerification(phone));
  try {
    await prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: delivered
          ? 'supplier.otp.delivered'
          : 'supplier.otp.delivery_failed',
        entityType: 'supplier_otp',
        entityId: phoneKey,
        after: {
          provider: localDelivery ? 'LOCAL' : 'TWILIO_VERIFY',
          channel: supplierOtpAuditChannel(),
        },
      },
    });
  } catch {
    console.error('[auth:supplier] OTP delivery audit failed', {
      code: 'OTP_DELIVERY_AUDIT_ERROR',
    });
    redirect('/login?mode=phone&err=unavailable');
  }
  if (!delivered) redirect('/login?mode=phone&err=delivery');

  if (!retryingRegistration) cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
  cookieStore.set(
    SUPPLIER_OTP_COOKIE,
    challenge.cookie,
    challengeCookieOptions(),
  );
  if (retryingRegistration)
    redirect('/login?mode=phone&step=verify&registration=1');
  redirect('/login?mode=phone&step=verify');
}

export async function verifyOtp(formData: FormData) {
  if (!supplierOtpSecurityConfigured())
    redirect('/login?mode=phone&err=unavailable');

  const cookieStore = await cookies();
  const registrationCookie = cookieStore.get(
    SUPPLIER_REGISTRATION_COOKIE,
  )?.value;
  const parsedRegistrationDraft =
    parseSupplierRegistrationDraft(registrationCookie);
  if (formData.get('registration') === '1' && !parsedRegistrationDraft) {
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    redirect('/login?mode=register&err=registration_expired');
  }
  if (registrationCookie && !parsedRegistrationDraft) {
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
  }
  const challenge = parseSupplierOtpChallenge(
    cookieStore.get(SUPPLIER_OTP_COOKIE)?.value,
  );
  if (!challenge) {
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    redirect('/login?mode=phone&err=expired');
  }
  const registrationDraft =
    parsedRegistrationDraft?.phone === challenge.phone
      ? parsedRegistrationDraft
      : null;
  if (parsedRegistrationDraft && !registrationDraft) {
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
  }
  const verificationPath = registrationDraft
    ? '/login?mode=phone&step=verify&registration=1'
    : '/login?mode=phone&step=verify';

  const code = normalizeOtpCode(String(formData.get('code') ?? ''));
  const challengeKey = supplierOtpChallengeKey(challenge.nonce);
  const phoneKey = supplierOtpSubjectKey('phone', challenge.phone);
  let reservation:
    { status: 'reserved'; attempt: number } | { status: 'used' | 'locked' };
  try {
    reservation = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`;
      const [
        reservedAttempts,
        releasedAttempts,
        failedAttempts,
        consumedChallenges,
      ] =
        await Promise.all([
          tx.auditLog.count({
            where: {
              entityType: 'supplier_otp_challenge',
              entityId: challengeKey,
              action: 'supplier.otp.verification_attempt_reserved',
            },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'supplier_otp_challenge',
              entityId: challengeKey,
              action: 'supplier.otp.verification_attempt_released',
            },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'supplier_otp_challenge',
              entityId: challengeKey,
              action: 'supplier.otp.failed',
            },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'supplier_otp_challenge',
              entityId: challengeKey,
              action: 'supplier.otp.challenge_consumed',
            },
          }),
        ]);
      if (consumedChallenges > 0) return { status: 'used' } as const;
      const attempts = Math.max(
        reservedAttempts - releasedAttempts,
        failedAttempts,
        challenge.attempts,
      );
      if (attempts >= MAX_SUPPLIER_OTP_ATTEMPTS) {
        return { status: 'locked' } as const;
      }
      const attempt = attempts + 1;
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'supplier.otp.verification_attempt_reserved',
          entityType: 'supplier_otp_challenge',
          entityId: challengeKey,
          after: { attempt, phoneSubject: phoneKey },
        },
      });
      return { status: 'reserved', attempt } as const;
    });
  } catch (error) {
    console.error('[auth:supplier] OTP verification reservation failed', {
      code: 'OTP_VERIFICATION_RESERVATION_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
    redirect(`${verificationPath}&err=unavailable`);
  }
  if (reservation.status !== 'reserved') {
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    redirect(`/login?mode=phone&err=${reservation.status}`);
  }

  const verification = supplierLocalOtpEnabled()
    ? verifySupplierOtpCode(challenge, code)
      ? 'approved'
      : 'pending'
    : await checkTwilioVerification(challenge.phone, code);
  if (verification === 'unavailable') {
    try {
      await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`;
        const consumed = await tx.auditLog.count({
          where: {
            entityType: 'supplier_otp_challenge',
            entityId: challengeKey,
            action: 'supplier.otp.challenge_consumed',
          },
        });
        if (consumed === 0) {
          await tx.auditLog.create({
            data: {
              actorType: 'SYSTEM',
              action: 'supplier.otp.verification_attempt_released',
              entityType: 'supplier_otp_challenge',
              entityId: challengeKey,
              after: {
                attempt: reservation.attempt,
                reason: 'PROVIDER_UNAVAILABLE',
                phoneSubject: phoneKey,
              },
            },
          });
        }
      });
    } catch (error) {
      console.error('[auth:supplier] OTP verification reservation release failed', {
        code: 'OTP_VERIFICATION_RESERVATION_RELEASE_ERROR',
        error: error instanceof Error ? error.message : String(error),
      });
    }
    redirect(`${verificationPath}&err=unavailable`);
  }
  if (verification === 'expired') {
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    redirect('/login?mode=phone&err=expired');
  }
  const codeIsValid = verification === 'approved';
  const completion = prisma.$transaction(async (tx) => {
    for (const lockKey of [challengeKey, phoneKey].sort()) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    }

    const [
      failedAttempts,
      consumedChallenges,
      reservedAttempts,
      releasedAttempts,
    ] =
      await Promise.all([
        tx.auditLog.count({
          where: {
            entityType: 'supplier_otp_challenge',
            entityId: challengeKey,
            action: 'supplier.otp.failed',
          },
        }),
        tx.auditLog.count({
          where: {
            entityType: 'supplier_otp_challenge',
            entityId: challengeKey,
            action: 'supplier.otp.challenge_consumed',
          },
        }),
        tx.auditLog.count({
          where: {
            entityType: 'supplier_otp_challenge',
            entityId: challengeKey,
            action: 'supplier.otp.verification_attempt_reserved',
          },
        }),
        tx.auditLog.count({
          where: {
            entityType: 'supplier_otp_challenge',
            entityId: challengeKey,
            action: 'supplier.otp.verification_attempt_released',
          },
        }),
      ]);

    if (consumedChallenges > 0) return { status: 'used' } as const;
    if (challenge.expiresAt <= Date.now()) return { status: 'expired' } as const;
    if (failedAttempts >= MAX_SUPPLIER_OTP_ATTEMPTS) {
      return { status: 'locked' } as const;
    }
    if (!codeIsValid) {
      const attempts = Math.max(
        reservedAttempts - releasedAttempts,
        failedAttempts + 1,
        reservation.attempt,
      );
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'supplier.otp.failed',
          entityType: 'supplier_otp_challenge',
          entityId: challengeKey,
          after: { attempt: attempts, phoneSubject: phoneKey },
        },
      });
      return {
        status: attempts >= MAX_SUPPLIER_OTP_ATTEMPTS ? 'locked' : 'invalid',
        attempts,
      } as const;
    }

    let supplier = await tx.supplier.findUnique({
      where: { contactPhone: challenge.phone },
      select: { id: true, status: true },
    });
    let registrationCreated = false;
    if (
      !supplier &&
      registrationDraft &&
      registrationDraft.expiresAt > Date.now()
    ) {
      supplier = await tx.supplier.create({
        data: {
          businessName: registrationDraft.businessName,
          city: registrationDraft.city,
          countryCode: registrationDraft.countryCode,
          crNumber: registrationDraft.legalRegistrationNumber,
          contactPhone: challenge.phone,
          status: SupplierStatus.PENDING,
        },
        select: { id: true, status: true },
      });
      registrationCreated = true;
      await tx.auditLog.create({
        data: {
          actorId: supplier.id,
          actorType: 'SUPPLIER',
          action: 'supplier.registered',
          entityType: 'supplier',
          entityId: supplier.id,
          after: {
            businessName: registrationDraft.businessName,
            city: registrationDraft.city,
            countryCode: registrationDraft.countryCode,
            status: SupplierStatus.PENDING,
            phoneVerified: true,
          },
        },
      });
    }
    if (!supplier || !supplierSessionStatusAllowed(supplier.status)) {
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'supplier.otp.challenge_consumed',
          entityType: 'supplier_otp_challenge',
          entityId: challengeKey,
          after: { outcome: 'NOT_ALLOWED', phoneSubject: phoneKey },
        },
      });
      return { status: 'not_allowed' } as const;
    }

    await tx.auditLog.create({
      data: {
        actorId: supplier.id,
        actorType: 'SUPPLIER',
        action: 'supplier.otp.challenge_consumed',
        entityType: 'supplier_otp_challenge',
        entityId: challengeKey,
        after: {
          outcome: 'VERIFIED',
          phoneSubject: phoneKey,
          registrationCreated,
        },
      },
    });
    return { status: 'verified', supplierId: supplier.id } as const;
  });
  const result = await completion.catch(() => {
    console.error('[auth:supplier] OTP verification completion failed', {
      code: 'OTP_VERIFICATION_COMPLETION_ERROR',
    });
    // The provider may have consumed the approved code before persistence failed.
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    redirect('/login?mode=phone&err=unavailable');
  });

  if (result.status !== 'verified') {
    if (result.status === 'invalid') {
      const remainingSeconds = Math.max(
        1,
        Math.ceil((challenge.expiresAt - Date.now()) / 1000),
      );
      cookieStore.set(
        SUPPLIER_OTP_COOKIE,
        setSupplierOtpAttempts(challenge, result.attempts),
        challengeCookieOptions(remainingSeconds),
      );
      redirect(`${verificationPath}&err=invalid_otp`);
    }
    cookieStore.delete(SUPPLIER_OTP_COOKIE);
    cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
    if (result.status === 'expired') redirect('/login?mode=phone&err=expired');
    if (result.status === 'not_allowed') {
      redirect('/login?mode=phone&err=not_allowed');
    }
    redirect('/login?mode=phone&err=locked');
  }

  cookieStore.delete(SUPPLIER_OTP_COOKIE);
  cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
  const token = await signSession(result.supplierId);
  cookieStore.set('sp_auth', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
  redirect('/');
}

export async function logout() {
  const cookieStore = await cookies();
  cookieStore.delete('sp_auth');
  cookieStore.delete(SUPPLIER_OTP_COOKIE);
  cookieStore.delete(SUPPLIER_REGISTRATION_COOKIE);
  redirect('/login');
}
