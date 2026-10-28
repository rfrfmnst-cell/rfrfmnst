import { normalizeOtpCode } from './auth-input';
import { normalizeSaudiPhone } from './customer-phone';
export { normalizeSaudiPhone } from './customer-phone';
import { prisma } from '@rafraf/db';
import { PLACEHOLDER_CUSTOMER_NAME } from './customer-profile';
import {
  OtpQuotaExceededError,
  reserveOtpRequestQuota,
} from '@rafraf/shared/security/otp-request-quota';
import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import {
  checkTwilioVerification,
  sendTwilioVerification,
  twilioVerifyConfigured,
  twilioVerifyReady,
} from '@rafraf/shared/twilio-verify';
import {
  CUSTOMER_OTP_TTL_SECONDS,
  MAX_OTP_ATTEMPTS,
  createCustomerOtpChallenge,
  customerOtpChallengeKey,
  customerOtpSubjectKey,
  incrementCustomerOtpAttempts,
  maskCustomerPhone,
  parseCustomerOtpChallenge,
  verifyCustomerOtpCode,
} from './customer-otp';
import { createCustomerRegistrationProof } from './customer-registration-proof';
import { CUSTOMER_SESSION_TTL_SECONDS } from './session';
import { reserveCustomerTurnstileSiteverify } from './turnstile-quota';

export type OtpRequestResult =
  | {
      status: 'sent';
      challengeCookie: string;
      expiresAt: number;
      maskedPhone: string;
      developmentCode?: string;
    }
  | {
      status:
        | 'invalid_phone'
        | 'unavailable'
        | 'verification_failed'
        | 'rate_limited'
        | 'delivery_failed';
    };

export type OtpVerifyResult =
  | { status: 'verified'; customerId: string }
  | { status: 'registration_required'; registrationProof: string }
  | { status: 'invalid'; challengeCookie: string; remainingSeconds: number }
  | { status: 'expired' | 'locked' | 'used' | 'not_allowed' | 'unavailable' };

export function otpSecurityConfigured(): boolean {
  if (localOtpEnabled()) return true;
  return (
    (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    twilioVerifyConfigured()
  );
}

export async function otpSecurityReady(): Promise<boolean> {
  if (localOtpEnabled()) return true;
  return (
    (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32 &&
    (await twilioVerifyReady())
  );
}

function localOtpEnabled(): boolean {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.OTP_DELIVERY_PROVIDER === 'local'
  );
}

function otpAuditChannel(): string {
  return localOtpEnabled() ? 'LOCAL' : 'SMS';
}

export async function requestCustomerOtpFlow(
  phoneInput: string,
  turnstileToken: unknown,
  requestIpSubject: string | null,
): Promise<OtpRequestResult> {
  const phone = normalizeSaudiPhone(phoneInput);
  if (!phone) return { status: 'invalid_phone' };
  if (!otpSecurityConfigured()) return { status: 'unavailable' };

  const humanProof = await verifyTurnstileToken({
    token: turnstileToken,
    expectedAction: 'customer_otp',
    reserveSiteverify: () =>
      reserveCustomerTurnstileSiteverify(requestIpSubject),
  });
  if (!humanProof.ok) {
    return {
      status:
        humanProof.reason === 'configuration' ||
        humanProof.reason === 'unavailable'
          ? 'unavailable'
          : 'verification_failed',
    };
  }
  if (!requestIpSubject) return { status: 'unavailable' };

  const phoneKey = customerOtpSubjectKey('phone', phone);
  const ipKey = customerOtpSubjectKey('ip', requestIpSubject);
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
                  provider: localOtpEnabled() ? 'LOCAL' : 'TWILIO_VERIFY',
                  channel: otpAuditChannel(),
                  dimension: reservation.dimension,
                  reservation: true,
                },
              })),
            });
          },
        },
        {
          portalNamespace: 'customer',
          action: 'customer.otp.requested',
          entityType: 'customer_otp',
          phoneSubject: phoneKey,
          ipSubject: ipKey,
        },
      );
    });
  } catch (error) {
    if (error instanceof OtpQuotaExceededError) {
      return { status: 'rate_limited' };
    }
    console.error('[auth:customer] OTP rate-limit database error', {
      code: 'OTP_DATABASE_UNAVAILABLE',
    });
    return { status: 'unavailable' };
  }

  // Reserve the request quota before any provider call. This bounds outbound
  // readiness probes even while an attacker keeps retrying a valid number.
  if (!(await otpSecurityReady())) return { status: 'unavailable' };

  const challenge = createCustomerOtpChallenge(phone);
  const localDelivery = localOtpEnabled();
  const delivered = localDelivery || (await sendTwilioVerification(phone));
  try {
    await prisma.auditLog.create({
      data: {
        actorType: 'SYSTEM',
        action: delivered
          ? 'customer.otp.delivered'
          : 'customer.otp.delivery_failed',
        entityType: 'customer_otp',
        entityId: phoneKey,
        after: {
          provider: localDelivery ? 'LOCAL' : 'TWILIO_VERIFY',
          channel: otpAuditChannel(),
        },
      },
    });
  } catch {
    console.error('[auth:customer] OTP delivery audit failed', {
      code: 'OTP_DELIVERY_AUDIT_ERROR',
    });
    return { status: 'unavailable' };
  }
  if (!delivered) return { status: 'delivery_failed' };
  return {
    status: 'sent',
    challengeCookie: challenge.cookie,
    expiresAt: challenge.expiresAt,
    maskedPhone: maskCustomerPhone(phone),
    ...(localDelivery ? { developmentCode: challenge.code } : {}),
  };
}

export async function verifyCustomerOtpFlow(
  challengeCookie: string | undefined,
  code: string,
): Promise<OtpVerifyResult> {
  if (!otpSecurityConfigured()) return { status: 'unavailable' };
  const challenge = parseCustomerOtpChallenge(challengeCookie);
  if (!challenge) return { status: 'expired' };
  if (challenge.attempts >= MAX_OTP_ATTEMPTS) return { status: 'locked' };

  const challengeKey = customerOtpChallengeKey(challenge.nonce);
  const phoneKey = customerOtpSubjectKey('phone', challenge.phone);
  let reservation:
    { status: 'reserved'; attempt: number } | { status: 'used' | 'locked' };
  try {
    reservation = await prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`;
      const [reservedAttempts, failedAttempts, consumedChallenges] =
        await Promise.all([
          tx.auditLog.count({
            where: {
              entityType: 'customer_otp_challenge',
              entityId: challengeKey,
              action: 'customer.otp.verification_attempt_reserved',
            },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'customer_otp_challenge',
              entityId: challengeKey,
              action: 'customer.otp.failed',
            },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'customer_otp_challenge',
              entityId: challengeKey,
              action: 'customer.otp.challenge_consumed',
            },
          }),
        ]);
      if (consumedChallenges > 0) return { status: 'used' } as const;
      const attempts = Math.max(
        reservedAttempts,
        failedAttempts,
        challenge.attempts,
      );
      if (attempts >= MAX_OTP_ATTEMPTS) return { status: 'locked' } as const;
      const attempt = attempts + 1;
      await tx.auditLog.create({
        data: {
          actorType: 'SYSTEM',
          action: 'customer.otp.verification_attempt_reserved',
          entityType: 'customer_otp_challenge',
          entityId: challengeKey,
          after: { attempt, phoneSubject: phoneKey },
        },
      });
      return { status: 'reserved', attempt } as const;
    });
  } catch {
    console.error('[auth:customer] OTP verification reservation failed', {
      code: 'OTP_DATABASE_UNAVAILABLE',
    });
    return { status: 'unavailable' };
  }
  if (reservation.status !== 'reserved') return reservation;

  code = normalizeOtpCode(code);
  const verification = localOtpEnabled()
    ? verifyCustomerOtpCode(challenge, code.trim())
      ? 'approved'
      : 'pending'
    : await checkTwilioVerification(challenge.phone, code.trim());
  if (verification === 'unavailable') return { status: 'unavailable' };
  if (verification === 'expired') return { status: 'expired' };
  const valid = verification === 'approved';
  const result = await prisma
    .$transaction(async (tx) => {
      for (const key of [challengeKey, phoneKey].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
      const [failed, consumed, reserved] = await Promise.all([
        tx.auditLog.count({
          where: {
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            action: 'customer.otp.failed',
          },
        }),
        tx.auditLog.count({
          where: {
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            action: 'customer.otp.challenge_consumed',
          },
        }),
        tx.auditLog.count({
          where: {
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            action: 'customer.otp.verification_attempt_reserved',
          },
        }),
      ]);
      if (consumed > 0) return { status: 'used' } as const;
      // Recheck after provider latency and database lock waits.
      if (challenge.expiresAt <= Date.now()) return { status: 'expired' } as const;
      if (failed >= MAX_OTP_ATTEMPTS) return { status: 'locked' } as const;
      if (!valid) {
        const attempts = Math.max(reserved, failed + 1, reservation.attempt);
        await tx.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            action: 'customer.otp.failed',
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            after: { attempt: attempts, phoneSubject: phoneKey },
          },
        });
        if (attempts >= MAX_OTP_ATTEMPTS) return { status: 'locked' } as const;
        return { status: 'invalid', attempts } as const;
      }

      const existing = await tx.user.findUnique({
        where: { phone: challenge.phone },
        include: { customer: true, role: true },
      });
      if (
        existing &&
        (!existing.isActive || existing.role.name !== 'CUSTOMER')
      ) {
        await tx.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            action: 'customer.otp.challenge_consumed',
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            after: { outcome: 'NOT_ALLOWED', phoneSubject: phoneKey },
          },
        });
        return { status: 'not_allowed' } as const;
      }
      const now = new Date();
      if (!existing) {
        await tx.auditLog.create({
          data: {
            actorType: 'SYSTEM',
            action: 'customer.otp.challenge_consumed',
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            after: { outcome: 'REGISTRATION_REQUIRED', phoneSubject: phoneKey },
          },
        });
        return { status: 'registration_required' } as const;
      }
      const user = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: { lastLoginAt: now, phoneVerifiedAt: now },
            include: { customer: true },
          })
        : await tx.user.create({
            data: {
              phone: challenge.phone,
              lastLoginAt: now,
              role: { connect: { name: 'CUSTOMER' } },
            },
            include: { customer: true },
          });
      const customer =
        user.customer ??
        (await tx.customer.create({
          data: { userId: user.id, fullName: PLACEHOLDER_CUSTOMER_NAME },
        }));
      await tx.auditLog.createMany({
        data: [
          {
            actorType: 'SYSTEM',
            action: 'customer.otp.challenge_consumed',
            entityType: 'customer_otp_challenge',
            entityId: challengeKey,
            after: { outcome: 'VERIFIED', phoneSubject: phoneKey },
          },
          {
            actorId: customer.id,
            actorType: 'CUSTOMER',
            action: 'customer.otp.verified',
            entityType: 'customer',
            entityId: customer.id,
            after: { sessionVersion: 3 },
          },
        ],
      });
      return { status: 'verified', customerId: customer.id } as const;
    })
    .catch(() => {
      console.error('[auth:customer] OTP completion unavailable', {
        code: 'OTP_VERIFICATION_COMPLETION_ERROR',
      });
      return { status: 'unavailable' } as const;
    });

  if (result.status === 'invalid') {
    const remainingSeconds = Math.max(
      1,
      Math.ceil((challenge.expiresAt - Date.now()) / 1000),
    );
    return {
      status: 'invalid',
      remainingSeconds,
      challengeCookie: incrementCustomerOtpAttempts(challenge, result.attempts),
    };
  }
  if (result.status === 'registration_required') {
    return {
      status: 'registration_required',
      registrationProof: createCustomerRegistrationProof({
        provider: 'phone',
        phone: challenge.phone,
      }),
    };
  }
  return result;
}

export {
  signInCustomerWithPassword,
  type CustomerPasswordSignInResult,
} from './customer-password-auth-service';
export {
  registerCustomerAccount,
  verifyCustomerEmail,
  type CustomerRegistrationResult,
} from './customer-registration-service';
export { authenticateCustomerWithGoogle } from './customer-google-auth-service';
export const customerOtpCookieOptions = (
  maxAge = CUSTOMER_OTP_TTL_SECONDS,
) => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'strict' as const,
  path: '/',
  maxAge,
});

export const customerSessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax' as const,
  path: '/',
  maxAge: CUSTOMER_SESSION_TTL_SECONDS,
};
