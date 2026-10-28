import {
  ActorType,
  AdminMfaVerificationStatus,
  RoleName,
  prisma,
} from '@rafraf/db';
import {
  redirectOrigin,
  requestOriginAllowed,
} from '@rafraf/shared/public-origin';
import { checkTwilioVerification } from '@rafraf/shared/twilio-verify';
import { NextResponse, type NextRequest } from 'next/server';
import {
  adminAuthConfigured,
  isAdminPermission,
  localAdminMfaEnabled,
  localAdminOtpMatches,
  signAdminSession,
  verifyAdminMfaChallenge,
} from '../../../lib/admin-session';
import {
  adminSessionCookieOptions,
  clearAdminMfaCookie,
} from '../../../lib/admin-cookies';
import { normalizeOtpCode } from '../../../lib/auth-input';
import { adminLandingPath } from '../../../lib/admin-landing-path';

const MAX_MFA_ATTEMPTS = 5;

type MfaOutcome =
  | { status: 'verified'; permissions: string[] }
  | { status: 'invalid'; attempts: number }
  | {
      status: 'locked' | 'used' | 'not_allowed' | 'expired' | 'unavailable';
    };

type MfaReservation =
  | { status: 'reserved'; attemptId: string; sequence: number }
  | { status: 'locked' | 'used' };

/** The browser-reachable origin; `req.url` carries the container address
 * in standalone output, so a redirect built on it is unfollowable. */
function adminOrigin(req: NextRequest): string {
  return redirectOrigin(process.env.ADMIN_PUBLIC_URL, req.url);
}

function verifyRedirect(req: NextRequest, error: string): NextResponse {
  return NextResponse.redirect(
    new URL(
      `/login?step=verify&e=${encodeURIComponent(error)}`,
      adminOrigin(req),
    ),
    { status: 303 },
  );
}

function restartLogin(req: NextRequest, error: string): NextResponse {
  return clearAdminMfaCookie(
    NextResponse.redirect(
      new URL(`/login?e=${encodeURIComponent(error)}`, adminOrigin(req)),
      { status: 303 },
    ),
  );
}

/**
 * Second factor. The signed challenge is single-use by audit-log invariant and
 * is always bound to the operator who passed the password factor.
 */
export async function POST(req: NextRequest) {
  if (
    !requestOriginAllowed(
      req.headers.get('origin'),
      process.env.ADMIN_PUBLIC_URL,
      req.url,
    )
  )
    return NextResponse.json({ error: 'origin' }, { status: 403 });

  if (!adminAuthConfigured()) {
    return new NextResponse('غير مُهيّأة', { status: 503 });
  }

  const challenge = await verifyAdminMfaChallenge(
    req.cookies.get('ops_mfa')?.value,
  );
  if (!challenge) return restartLogin(req, 'expired');

  const account = await prisma.user.findUnique({
    where: { id: challenge.userId },
    select: {
      id: true,
      phone: true,
      isActive: true,
      adminPermissions: true,
      role: { select: { name: true } },
    },
  });
  const eligible = Boolean(
    account &&
    account.isActive &&
    account.role.name === RoleName.ADMIN &&
    account.adminPermissions.some(isAdminPermission),
  );
  if (!account?.phone || !eligible) return restartLogin(req, 'invalid');

  const form = await req.formData();
  const code = normalizeOtpCode(String(form.get('code') ?? ''));
  const challengeKey = `admin_mfa:${challenge.nonce}`;
  let reservation: MfaReservation;
  try {
    reservation = await prisma.$transaction(
      async (tx): Promise<MfaReservation> => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`;

        const [attempts, consumed] = await Promise.all([
          tx.adminMfaVerificationAttempt.count({
            where: { challengeKey },
          }),
          tx.auditLog.count({
            where: {
              entityType: 'admin_mfa_challenge',
              entityId: challengeKey,
              action: 'admin.mfa.consumed',
            },
          }),
        ]);
        if (consumed > 0) return { status: 'used' };
        if (attempts >= MAX_MFA_ATTEMPTS) return { status: 'locked' };

        const sequence = attempts + 1;
        const attempt = await tx.adminMfaVerificationAttempt.create({
          data: {
            challengeKey,
            userId: account.id,
            sequence,
          },
          select: { id: true },
        });
        return { status: 'reserved', attemptId: attempt.id, sequence };
      },
    );
  } catch (error) {
    console.error('[auth:admin] MFA reservation database unavailable', {
      code: 'ADMIN_MFA_RESERVATION_DATABASE_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
    return verifyRedirect(req, 'unavailable');
  }

  if (reservation.status !== 'reserved') {
    return restartLogin(req, 'locked');
  }

  // Never hold a database transaction while the external verifier is running.
  // The durable IN_FLIGHT reservation already consumes one of the five slots.
  const verification = localAdminMfaEnabled()
    ? localAdminOtpMatches(code)
      ? 'approved'
      : 'pending'
    : await checkTwilioVerification(account.phone, code);

  let outcome: MfaOutcome;
  try {
    outcome = await prisma.$transaction(async (tx): Promise<MfaOutcome> => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${challengeKey}))`;

      const attempt = await tx.adminMfaVerificationAttempt.findUnique({
        where: { id: reservation.attemptId },
        select: {
          id: true,
          challengeKey: true,
          userId: true,
          sequence: true,
          status: true,
        },
      });
      if (
        !attempt ||
        attempt.challengeKey !== challengeKey ||
        attempt.userId !== account.id ||
        attempt.sequence !== reservation.sequence ||
        attempt.status !== AdminMfaVerificationStatus.IN_FLIGHT
      ) {
        return { status: 'unavailable' };
      }

      const consumed = await tx.auditLog.count({
        where: {
          entityType: 'admin_mfa_challenge',
          entityId: challengeKey,
          action: 'admin.mfa.consumed',
        },
      });
      if (consumed > 0) {
        await tx.adminMfaVerificationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AdminMfaVerificationStatus.SUPERSEDED,
            completedAt: new Date(),
          },
        });
        return { status: 'used' };
      }

      if (verification === 'unavailable') {
        await tx.adminMfaVerificationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AdminMfaVerificationStatus.UNAVAILABLE,
            completedAt: new Date(),
          },
        });
        return { status: 'unavailable' };
      }

      if (verification === 'expired') {
        await tx.adminMfaVerificationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AdminMfaVerificationStatus.EXPIRED,
            completedAt: new Date(),
          },
        });
        return { status: 'expired' };
      }

      if (verification !== 'approved') {
        await Promise.all([
          tx.adminMfaVerificationAttempt.update({
            where: { id: attempt.id },
            data: {
              status: AdminMfaVerificationStatus.INVALID,
              completedAt: new Date(),
            },
          }),
          tx.auditLog.create({
            data: {
              actorType: ActorType.SYSTEM,
              action: 'admin.mfa.failed',
              entityType: 'admin_mfa_challenge',
              entityId: challengeKey,
              after: {
                attempt: attempt.sequence,
                verificationAttemptId: attempt.id,
                userId: account.id,
              },
            },
          }),
        ]);
        return {
          status: attempt.sequence >= MAX_MFA_ATTEMPTS ? 'locked' : 'invalid',
          attempts: attempt.sequence,
        };
      }

      const current = await tx.user.findUnique({
        where: { id: account.id },
        select: {
          id: true,
          isActive: true,
          adminPermissions: true,
          role: { select: { name: true } },
        },
      });
      if (
        !current ||
        !current.isActive ||
        current.role.name !== RoleName.ADMIN ||
        !current.adminPermissions.some(isAdminPermission)
      ) {
        await Promise.all([
          tx.adminMfaVerificationAttempt.update({
            where: { id: attempt.id },
            data: {
              status: AdminMfaVerificationStatus.NOT_ALLOWED,
              completedAt: new Date(),
            },
          }),
          tx.auditLog.create({
            data: {
              actorType: ActorType.SYSTEM,
              action: 'admin.mfa.consumed',
              entityType: 'admin_mfa_challenge',
              entityId: challengeKey,
              after: {
                outcome: 'NOT_ALLOWED',
                verificationAttemptId: attempt.id,
              },
            },
          }),
        ]);
        return { status: 'not_allowed' };
      }

      await Promise.all([
        tx.adminMfaVerificationAttempt.update({
          where: { id: attempt.id },
          data: {
            status: AdminMfaVerificationStatus.VERIFIED,
            completedAt: new Date(),
          },
        }),
        tx.auditLog.createMany({
          data: [
            {
              actorId: current.id,
              actorType: ActorType.ADMIN,
              action: 'admin.mfa.consumed',
              entityType: 'admin_mfa_challenge',
              entityId: challengeKey,
              after: {
                outcome: 'VERIFIED',
                verificationAttemptId: attempt.id,
              },
            },
            {
              actorId: current.id,
              actorType: ActorType.ADMIN,
              action: 'admin.login.succeeded',
              entityType: 'admin_login',
              entityId: current.id,
              after: { sessionVersion: 2, mfa: true, ttlHours: 8 },
            },
          ],
        }),
      ]);
      return { status: 'verified', permissions: current.adminPermissions };
    });
  } catch (error) {
    console.error('[auth:admin] MFA finalization database unavailable', {
      code: 'ADMIN_MFA_FINALIZATION_DATABASE_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
    return verifyRedirect(req, 'unavailable');
  }

  if (outcome.status !== 'verified') {
    if (outcome.status === 'unavailable') {
      return verifyRedirect(req, 'unavailable');
    }
    if (outcome.status === 'expired') {
      return restartLogin(req, 'expired');
    }
    if (outcome.status === 'invalid') {
      return verifyRedirect(req, 'invalid_otp');
    }

    const error = outcome.status === 'not_allowed' ? 'invalid' : 'locked';
    return restartLogin(req, error);
  }

  const response = NextResponse.redirect(
    new URL(adminLandingPath(outcome.permissions), adminOrigin(req)),
    { status: 303 },
  );
  clearAdminMfaCookie(response);
  response.cookies.set('ops_session', await signAdminSession(account.id), {
    ...adminSessionCookieOptions(),
  });
  return response;
}
