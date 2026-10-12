import {
  redirectOrigin,
  requestOriginAllowed,
} from '@rafraf/shared/public-origin';
import { NextResponse, type NextRequest } from 'next/server';
import {
  clearAdminMfaCookie,
  clearAdminSessionCookie,
} from '../../lib/admin-cookies';

/** Ends both the long-lived admin session and any unfinished MFA challenge. */
export async function POST(request: NextRequest) {
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.ADMIN_PUBLIC_URL,
      request.url,
    )
  )
    return NextResponse.json({ error: 'origin' }, { status: 403 });

  const origin = redirectOrigin(process.env.ADMIN_PUBLIC_URL, request.url);
  const response = NextResponse.redirect(new URL('/login', origin), {
    status: 303,
  });
  clearAdminSessionCookie(response);
  clearAdminMfaCookie(response);
  return response;
}
