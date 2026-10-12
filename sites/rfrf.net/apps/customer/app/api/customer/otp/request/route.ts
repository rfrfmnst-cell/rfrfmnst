import { NextResponse, type NextRequest } from 'next/server';
import { requestIpSubject } from '@rafraf/shared/security/request-subject';
import { requestOriginAllowed } from '@rafraf/shared/public-origin';
import { CUSTOMER_OTP_COOKIE } from '../../../../../lib/customer-otp';
import {
  customerOtpCookieOptions,
  requestCustomerOtpFlow,
} from '../../../../../lib/customer-auth-service';

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
  let body: { phone?: unknown; turnstileToken?: unknown };
  try {
    body = (await request.json()) as {
      phone?: unknown;
      turnstileToken?: unknown;
    };
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }
  const result = await requestCustomerOtpFlow(
    String(body.phone ?? ''),
    body.turnstileToken,
    requestIpSubject(request.headers),
  );
  if (result.status !== 'sent') {
    const status =
      result.status === 'rate_limited'
        ? 429
        : result.status === 'invalid_phone'
          ? 400
          : result.status === 'verification_failed'
            ? 403
            : 503;
    return NextResponse.json({ error: result.status }, { status });
  }
  const response = NextResponse.json({
    ok: true,
    expiresAt: result.expiresAt,
    maskedPhone: result.maskedPhone,
    ...(result.developmentCode
      ? { developmentCode: result.developmentCode }
      : {}),
  });
  response.cookies.set(
    CUSTOMER_OTP_COOKIE,
    result.challengeCookie,
    customerOtpCookieOptions(),
  );
  return response;
}
