import { NextResponse, type NextRequest } from 'next/server';
import {
  clientWriteFenceResponse,
  isProxyStaticPath,
} from '@rafraf/shared/client-write-fence';
import { verifySession } from './lib/session-token.ts';

/**
 * حماية بوابة الموردين.
 * الكوكي يحمل supplierId موقّعًا عبر /lib/session.
 */

export async function proxy(req: NextRequest) {
  const fenced = clientWriteFenceResponse(
    req,
    process.env.RAFRAF_CLIENT_WRITE_FENCE,
  );
  if (fenced) return fenced;
  if (isProxyStaticPath(req.nextUrl.pathname)) return NextResponse.next();

  if (req.nextUrl.pathname.startsWith('/login')) return NextResponse.next();
  if (
    req.nextUrl.pathname === '/api/liveness' ||
    req.nextUrl.pathname === '/api/readiness'
  ) {
    return NextResponse.next();
  }

  // التسجيل هو المسار العام الوحيد داخل الجذر. نسمح به قبل فحص Accept لأن
  // Server Actions ترسل عادة Accept: text/x-component لا text/html؛ حصر السماح
  // في طلبات HTML كان يمنع POST الخاص بنموذج التسجيل قبل وصوله إلى action.
  const isRegistrationRequest =
    req.nextUrl.pathname === '/' &&
    req.nextUrl.searchParams.get('register') === '1';
  if (isRegistrationRequest) return NextResponse.next();

  const token = req.cookies.get('sp_auth')?.value;
  const supplierId = await verifySession(token);

  if (supplierId) return NextResponse.next();

  const wantsHtml = req.headers.get('accept')?.includes('text/html');
  if (wantsHtml) {
    return NextResponse.redirect(new URL('/login', req.url));
  }

  return new NextResponse('مطلوب تسجيل الدخول', {
    status: 401,
  });
}

export const config = {
  matcher: ['/(.*)'],
};
