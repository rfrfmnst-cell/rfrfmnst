import { NextResponse, type NextRequest } from 'next/server';
import { redirectOrigin } from '@rafraf/shared/public-origin';
import {
  clientWriteFenceResponse,
  isProxyStaticPath,
} from '@rafraf/shared/client-write-fence';
import { adminAuthConfigured, verifyAdminSession } from './lib/admin-session';

/**
 * The operations console is never public. The edge proxy verifies a short-lived
 * HMAC session; every server action and page additionally resolves the named
 * operator and their current database permissions.
 */
export async function proxy(req: NextRequest) {
  const fenced = clientWriteFenceResponse(
    req,
    process.env.RAFRAF_CLIENT_WRITE_FENCE,
  );
  if (fenced) return fenced;
  if (isProxyStaticPath(req.nextUrl.pathname)) return NextResponse.next();

  if (
    req.nextUrl.pathname === '/api/liveness' ||
    req.nextUrl.pathname === '/api/webhooks/oto'
  ) {
    return NextResponse.next();
  }

  // The route performs its own constant-time probe-key authorization and
  // returns only a shallow availability response to unauthenticated callers.
  if (req.nextUrl.pathname === '/api/readiness') {
    return NextResponse.next();
  }

  if (!adminAuthConfigured()) {
    return new NextResponse('لوحة الإدارة غير مُهيّأة.', { status: 503 });
  }

  if (req.nextUrl.pathname.startsWith('/login')) {
    return NextResponse.next();
  }

  const session = await verifyAdminSession(
    req.cookies.get('ops_session')?.value,
  );
  if (session) return NextResponse.next();

  const wantsHtml = req.headers.get('accept')?.includes('text/html');
  if (wantsHtml)
    return NextResponse.redirect(
      new URL('/login', redirectOrigin(process.env.ADMIN_PUBLIC_URL, req.url)),
    );
  return new NextResponse('مطلوب تسجيل الدخول', { status: 401 });
}

export const config = {
  matcher: ['/(.*)'],
};
