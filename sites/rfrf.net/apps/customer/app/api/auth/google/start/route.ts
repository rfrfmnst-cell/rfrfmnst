import { redirectOrigin } from '@rafraf/shared/public-origin';
import { cookies } from 'next/headers';
import {
  createGoogleOAuthState,
  googleOAuthConfiguration,
  googleOAuthCookieOptions,
} from '../../../../../lib/customer-google-oauth';
import {
  CUSTOMER_AUTH_RETURN_COOKIE,
  customerAuthReturnCookieOptions,
  safePostAuthPath,
  withCustomerAuthReturnPath,
} from '../../../../../lib/customer-auth-return-path';

export const runtime = 'nodejs';

export async function GET(request: Request) {
  const next = safePostAuthPath(new URL(request.url).searchParams.get('next'));
  const configuration = googleOAuthConfiguration();
  if (!configuration) {
    return Response.redirect(
      new URL(
        withCustomerAuthReturnPath('/login?err=google_unavailable', next),
        redirectOrigin(process.env.CUSTOMER_PUBLIC_URL, request.url),
      ),
    );
  }
  const challenge = createGoogleOAuthState();
  const cookieStore = await cookies();
  cookieStore.set(
    'cu_google_oauth',
    challenge.cookie,
    googleOAuthCookieOptions,
  );
  cookieStore.set(
    CUSTOMER_AUTH_RETURN_COOKIE,
    next,
    customerAuthReturnCookieOptions,
  );
  const authorizationUrl = new URL(
    'https://accounts.google.com/o/oauth2/v2/auth',
  );
  authorizationUrl.search = new URLSearchParams({
    client_id: configuration.clientId,
    redirect_uri: configuration.redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state: challenge.state,
    code_challenge: challenge.codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
    nonce: challenge.nonce,
  }).toString();
  return Response.redirect(authorizationUrl);
}
