import { redirectOrigin } from '@rafraf/shared/public-origin';
import { cookies } from 'next/headers';
import {
  customerSessionCookieOptions,
  verifyCustomerEmail,
} from '../../../lib/customer-auth-service';
import { signSession } from '../../../lib/session';
import { customerEmailBrowserCookieOptions } from '../../../lib/customer-email-verification';
import {
  CUSTOMER_AUTH_RETURN_COOKIE,
  safePostAuthPath,
  withCustomerAuthReturnPath,
} from '../../../lib/customer-auth-return-path';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const origin = redirectOrigin(process.env.CUSTOMER_PUBLIC_URL, request.url);
  const cookieStore = await cookies();
  const next = safePostAuthPath(
    cookieStore.get(CUSTOMER_AUTH_RETURN_COOKIE)?.value,
  );
  const result = await verifyCustomerEmail({
    token: url.searchParams.get('token') ?? '',
    browserSecret: cookieStore.get('cu_email_verify')?.value,
  });
  if (result.status !== 'verified') {
    const error =
      result.status === 'unavailable'
        ? 'email_verification_unavailable'
        : 'email_verification';
    return Response.redirect(
      new URL(withCustomerAuthReturnPath(`/login?err=${error}`, next), origin),
    );
  }
  cookieStore.set('cu_email_verify', '', {
    ...customerEmailBrowserCookieOptions,
    maxAge: 0,
  });
  cookieStore.set(
    'cu_auth',
    await signSession(result.customerId),
    customerSessionCookieOptions,
  );
  cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
  return Response.redirect(new URL(next, origin));
}
