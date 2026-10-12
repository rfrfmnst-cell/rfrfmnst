import type { NextResponse } from 'next/server';
import {
  ADMIN_MFA_TTL_SECONDS,
  ADMIN_SESSION_TTL_SECONDS,
} from './admin-session';

export const ADMIN_MFA_COOKIE_PATH = '/login';
export const ADMIN_SESSION_COOKIE_PATH = '/';

function secureCookie(): boolean {
  return process.env.NODE_ENV === 'production';
}

export function adminMfaCookieOptions() {
  return {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict' as const,
    path: ADMIN_MFA_COOKIE_PATH,
    maxAge: ADMIN_MFA_TTL_SECONDS,
  };
}

export function adminSessionCookieOptions() {
  return {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: 'strict' as const,
    path: ADMIN_SESSION_COOKIE_PATH,
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  };
}

export function clearAdminMfaCookie(response: NextResponse): NextResponse {
  response.cookies.set('ops_mfa', '', {
    ...adminMfaCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}

export function clearAdminSessionCookie(response: NextResponse): NextResponse {
  response.cookies.set('ops_session', '', {
    ...adminSessionCookieOptions(),
    maxAge: 0,
    expires: new Date(0),
  });
  return response;
}
