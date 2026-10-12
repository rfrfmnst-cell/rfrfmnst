import { NextResponse, type NextRequest } from 'next/server';
import {
  clientWriteFenceResponse,
  isProxyStaticPath,
} from '@rafraf/shared/client-write-fence';
import {
  customerLoginRedirectPath,
  decideCustomerProxyRoute,
} from './lib/customer-proxy-policy';
import { verifySession } from './lib/session';

export async function proxy(req: NextRequest) {
  const fenced = clientWriteFenceResponse(
    req,
    process.env.RAFRAF_CLIENT_WRITE_FENCE,
    process.env.RAFRAF_CLIENT_QA_KEY,
  );
  if (fenced) return fenced;
  if (isProxyStaticPath(req.nextUrl.pathname)) return NextResponse.next();

  const token = req.cookies.get('cu_auth')?.value;
  const authenticated = Boolean(await verifySession(token));
  const decision = decideCustomerProxyRoute({
    pathname: req.nextUrl.pathname,
    authenticated,
    wantsHtml: req.headers.get('accept')?.includes('text/html') ?? false,
  });

  if (decision === 'allow') {
    return NextResponse.next();
  }

  if (decision === 'redirect-login') {
    return NextResponse.redirect(
      new URL(
        customerLoginRedirectPath(req.nextUrl.pathname, req.nextUrl.search),
        req.url,
      ),
    );
  }

  return new NextResponse('مطلوب تسجيل الدخول', {
    status: 401,
  });
}

export const config = {
  matcher: ['/(.*)'],
};
