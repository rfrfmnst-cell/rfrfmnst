import { ActorType, RoleName, prisma } from '@rafraf/db';
import {
  redirectOrigin,
  requestOriginAllowed,
} from '@rafraf/shared/public-origin';
import {
  sendTwilioVerification,
  twilioVerifyReady,
} from '@rafraf/shared/twilio-verify';
import { NextResponse, type NextRequest } from 'next/server';
import {
  adminAuthConfigured,
  adminLoginSubject,
  localAdminMfaEnabled,
  signAdminMfaChallenge,
} from '../../../lib/admin-session';
import { adminMfaCookieOptions } from '../../../lib/admin-cookies';
import { verifyAdminPassword } from '../../../lib/admin-password';

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const MAX_LOGIN_FAILURES = 5;
const MAX_MFA_REQUESTS = 3;

type PasswordOutcome =
  | { status: 'rate_limited' }
  | { status: 'invalid' }
  | { status: 'authenticated'; userId: string; phone: string };

/**
 * The client address our own edge appended, never one the caller sent.
 *
 * `X-Forwarded-For` grows left to right and the client controls the front of it,
 * so the trustworthy entry sits `TRUSTED_PROXY_HOPS` from the end. Reading the
 * front — or `X-Real-IP`, which this edge does not set — let a caller mint a
 * fresh throttle identity per attempt and probe operator identifiers without
 * ever reaching the IP failure ceiling.
 */
function requestIp(req: NextRequest): string {
  const hops = (req.headers.get('x-forwarded-for') ?? '')
    .split(',')
    .map((hop) => hop.trim())
    .filter((hop) => hop.length > 0 && hop.length <= 64);
  const configured = Number.parseInt(
    process.env.TRUSTED_PROXY_HOPS?.trim() ?? '',
    10,
  );
  const trusted =
    Number.isInteger(configured) && configured >= 1 && configured <= 8
      ? configured
      : 1;
  const index = hops.length - trusted;
  return ((index >= 0 ? hops[index] : undefined) ?? 'unknown').slice(0, 128);
}

/** The browser-reachable origin; `req.url` carries the container address
 * in standalone output, so a redirect built on it is unfollowable. */
function adminOrigin(req: NextRequest): string {
  return redirectOrigin(process.env.ADMIN_PUBLIC_URL, req.url);
}

function loginRedirect(req: NextRequest, error: string): NextResponse {
  return NextResponse.redirect(
    new URL(`/login?e=${encodeURIComponent(error)}`, adminOrigin(req)),
    { status: 303 },
  );
}

function normalizeIdentifier(value: FormDataEntryValue | null): string | null {
  const raw = String(value ?? '').trim();
  if (!raw) return null;
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) return raw.toLowerCase();

  const phone = raw.replace(/[\s()-]/g, '');
  const normalized = phone.startsWith('05')
    ? `+9665${phone.slice(2)}`
    : phone.startsWith('9665')
      ? `+${phone}`
      : phone;
  return /^\+9665\d{8}$/.test(normalized) ? normalized : null;
}

/**
 * Password factor only. A successful request sends a second factor and issues
 * a short-lived signed challenge; it never creates an operations session.
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
    console.error('[auth:admin] configuration unavailable', {
      code: 'ADMIN_AUTH_CONFIG_MISSING',
    });
    return new NextResponse('غير مُهيّأة', { status: 503 });
  }

  const form = await req.formData();
  const identifier = normalizeIdentifier(form.get('identifier'));
  const password = String(form.get('password') ?? '');
  const subject = await adminLoginSubject(requestIp(req));
  const since = new Date(Date.now() - LOGIN_WINDOW_MS);

  const account = identifier
    ? await prisma.user.findFirst({
        where: {
          isActive: true,
          role: { is: { name: RoleName.ADMIN } },
          OR: [{ phone: identifier }, { email: identifier }],
        },
        select: { id: true, phone: true, passwordHash: true },
      })
    : null;

  let outcome: PasswordOutcome;
  try {
    outcome = await prisma.$transaction(
      async (tx): Promise<PasswordOutcome> => {
        // Serialize both the source and the named account. The account lock closes
        // distributed-password attempts that rotate IP addresses, while the IP
        // lock throttles enumeration and unknown-account traffic.
        const accountLock = account ? `admin-account:${account.id}` : null;
        const lockKeys = [subject, accountLock].filter(
          (value): value is string => Boolean(value),
        );
        for (const lockKey of lockKeys.sort()) {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
        }

        const [ipFailures, accountFailures] = await Promise.all([
          tx.auditLog.count({
            where: {
              entityType: 'admin_login',
              entityId: subject,
              action: 'admin.login.failed',
              createdAt: { gte: since },
            },
          }),
          account
            ? tx.auditLog.count({
                where: {
                  actorId: account.id,
                  entityType: 'admin_login',
                  action: 'admin.login.failed',
                  createdAt: { gte: since },
                },
              })
            : Promise.resolve(0),
        ]);
        // Reject as `invalid`, not `rate_limited`. `accountFailures` can only
        // climb for an identifier that resolves to a live operator, so a
        // distinguishable throttle response at this stage answers "does this
        // account exist?" for anyone willing to spend six attempts — and the
        // rejection is what enforces the limit, not the wording. The MFA stage
        // below still reports throttling plainly: the identifier is already
        // proven there, so saying so leaks nothing.
        if (
          ipFailures >= MAX_LOGIN_FAILURES ||
          accountFailures >= MAX_LOGIN_FAILURES
        ) {
          return { status: 'invalid' };
        }

        // Run the expensive password derivation only after both rate limits pass,
        // and while the account lock prevents parallel brute-force work.
        const passwordMatches = account
          ? await verifyAdminPassword(password, account.passwordHash)
          : false;
        if (!account || !passwordMatches || !account.phone) {
          await tx.auditLog.create({
            data: {
              actorId: account?.id,
              actorType: ActorType.SYSTEM,
              action: 'admin.login.failed',
              entityType: 'admin_login',
              entityId: subject,
              after: {
                ipAttempt: ipFailures + 1,
                accountAttempt: account ? accountFailures + 1 : null,
                stage: 'password',
              },
            },
          });
          return { status: 'invalid' };
        }

        const mfaRequests = await tx.auditLog.count({
          where: {
            actorId: account.id,
            entityType: 'admin_mfa',
            action: 'admin.mfa.requested',
            createdAt: { gte: since },
          },
        });
        if (mfaRequests >= MAX_MFA_REQUESTS) return { status: 'rate_limited' };

        await tx.auditLog.create({
          data: {
            actorId: account.id,
            actorType: ActorType.ADMIN,
            action: 'admin.mfa.requested',
            entityType: 'admin_mfa',
            entityId: account.id,
            after: {
              provider: localAdminMfaEnabled() ? 'LOCAL' : 'TWILIO_VERIFY',
            },
          },
        });
        return {
          status: 'authenticated',
          userId: account.id,
          phone: account.phone,
        };
      },
    );
  } catch (error) {
    console.error('[auth:admin] database unavailable', {
      code: 'ADMIN_AUTH_DATABASE_ERROR',
      error: error instanceof Error ? error.message : String(error),
    });
    return loginRedirect(req, 'unavailable');
  }

  if (outcome.status === 'rate_limited') return loginRedirect(req, 'rate');
  if (outcome.status === 'invalid') return loginRedirect(req, 'invalid');

  const localDelivery = localAdminMfaEnabled();
  const delivered =
    localDelivery ||
    ((await twilioVerifyReady()) &&
      (await sendTwilioVerification(outcome.phone)));
  if (!delivered) {
    await prisma.auditLog.create({
      data: {
        actorId: outcome.userId,
        actorType: ActorType.SYSTEM,
        action: 'admin.mfa.delivery_failed',
        entityType: 'admin_mfa',
        entityId: outcome.userId,
        after: { provider: 'TWILIO_VERIFY' },
      },
    });
    return loginRedirect(req, 'unavailable');
  }

  const response = NextResponse.redirect(
    new URL('/login?step=verify', adminOrigin(req)),
    { status: 303 },
  );
  response.cookies.set(
    'ops_mfa',
    await signAdminMfaChallenge(outcome.userId),
    adminMfaCookieOptions(),
  );
  return response;
}
