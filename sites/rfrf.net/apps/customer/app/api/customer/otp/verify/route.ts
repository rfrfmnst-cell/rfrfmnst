import { NextResponse, type NextRequest } from 'next/server';
import { requestOriginAllowed } from '@rafraf/shared/public-origin';
import { CUSTOMER_OTP_COOKIE } from '../../../../../lib/customer-otp';
import {
  customerOtpCookieOptions,
  customerSessionCookieOptions,
  verifyCustomerOtpFlow,
} from '../../../../../lib/customer-auth-service';
import { signSession } from '../../../../../lib/session';
import {
  CUSTOMER_REGISTRATION_COOKIE,
  customerRegistrationCookieOptions,
} from '../../../../../lib/customer-registration-proof';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.CUSTOMER_PUBLIC_URL,
      request.url,
    )
  )
    return NextResponse.json({ error: 'origin' }, { status: 403 });
  let code = '';
  try {
    code = String(((await request.json()) as { code?: unknown }).code ?? '');
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const result = await verifyCustomerOtpFlow(
    request.cookies.get(CUSTOMER_OTP_COOKIE)?.value,
    code,
  );
  if (result.status === 'invalid') {
    const response = NextResponse.json(
      { error: 'invalid', attemptsRemain: true },
      { status: 400 },
    );
    response.cookies.set(
      CUSTOMER_OTP_COOKIE,
      result.challengeCookie,
      customerOtpCookieOptions(result.remainingSeconds),
    );
    return response;
  }
  if (result.status === 'registration_required') {
    const response = NextResponse.json(
      {
        error: 'registration_required',
        registrationUrl: '/login?step=register',
      },
      { status: 409 },
    );
    response.cookies.delete(CUSTOMER_OTP_COOKIE);
    response.cookies.set(
      CUSTOMER_REGISTRATION_COOKIE,
      result.registrationProof,
      customerRegistrationCookieOptions,
    );
    return response;
  }
  if (result.status !== 'verified') {
    const status =
      result.status === 'expired'
        ? 410
        : result.status === 'unavailable'
          ? 503
          : result.status === 'locked'
            ? 423
            : result.status === 'used'
              ? 409
              : 403;
    const response = NextResponse.json({ error: result.status }, { status });
    response.cookies.delete(CUSTOMER_OTP_COOKIE);
    return response;
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.delete(CUSTOMER_OTP_COOKIE);
  response.cookies.set(
    'cu_auth',
    await signSession(result.customerId),
    customerSessionCookieOptions,
  );
  return response;
}
