import { timingSafeEqual } from 'node:crypto';
import { redirectOrigin } from '@rafraf/shared/public-origin';
import { cookies } from 'next/headers';
import {
  authenticateCustomerWithGoogle,
  customerSessionCookieOptions,
} from '../../../../../lib/customer-auth-service';
import {
  exchangeGoogleAuthorizationCode,
  googleOAuthConfiguration,
  parseGoogleOAuthState,
} from '../../../../../lib/customer-google-oauth';
import {
  CUSTOMER_REGISTRATION_COOKIE,
  customerRegistrationCookieOptions,
} from '../../../../../lib/customer-registration-proof';
import { signSession } from '../../../../../lib/session';
import {
  CUSTOMER_AUTH_RETURN_COOKIE,
  safePostAuthPath,
  withCustomerAuthReturnPath,
} from '../../../../../lib/customer-auth-return-path';

export const runtime = 'nodejs';

function sameState(left: string, right: string): boolean {
  const leftBytes = Buffer.from(left);
  const rightBytes = Buffer.from(right);
  return (
    leftBytes.length === rightBytes.length &&
    timingSafeEqual(leftBytes, rightBytes)
  );
}

export async function GET(request: Request) {
  const configuration = googleOAuthConfiguration();
  const cookieStore = await cookies();
  const next = safePostAuthPath(
    cookieStore.get(CUSTOMER_AUTH_RETURN_COOKIE)?.value,
  );
  const failurePath = withCustomerAuthReturnPath(
    '/login?err=google_failed',
    next,
  );
  const oauthState = parseGoogleOAuthState(
    cookieStore.get('cu_google_oauth')?.value,
  );
  cookieStore.delete('cu_google_oauth');
  const url = new URL(request.url);
  const origin = redirectOrigin(process.env.CUSTOMER_PUBLIC_URL, request.url);
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (
    !configuration ||
    !oauthState ||
    !sameState(state, oauthState.state) ||
    url.searchParams.has('error')
  ) {
    return Response.redirect(new URL(failurePath, origin));
  }
  const identity = await exchangeGoogleAuthorizationCode(
    code,
    oauthState.codeVerifier,
    configuration,
    oauthState.nonce,
  );
  if (!identity) {
    return Response.redirect(new URL(failurePath, origin));
  }
  const result = await authenticateCustomerWithGoogle(identity);
  if (result.status === 'authenticated') {
    cookieStore.set(
      'cu_auth',
      await signSession(result.customerId),
      customerSessionCookieOptions,
    );
    cookieStore.delete(CUSTOMER_AUTH_RETURN_COOKIE);
    return Response.redirect(new URL(next, origin));
  }
  if (result.status === 'registration_required') {
    cookieStore.set(
      CUSTOMER_REGISTRATION_COOKIE,
      result.registrationProof,
      customerRegistrationCookieOptions,
    );
    return Response.redirect(
      new URL(withCustomerAuthReturnPath('/login?step=register', next), origin),
    );
  }
  return Response.redirect(new URL(failurePath, origin));
}
