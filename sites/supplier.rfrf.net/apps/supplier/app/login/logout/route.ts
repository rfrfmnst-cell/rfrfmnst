import {
  redirectOrigin,
  requestOriginAllowed,
} from '@rafraf/shared/public-origin';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
      request.url,
    )
  ) {
    return NextResponse.json({ error: 'origin' }, { status: 403 });
  }
  (await cookies()).delete('sp_auth');
  const origin = redirectOrigin(
    process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
    request.url,
  );
  return NextResponse.redirect(new URL('/login', origin), { status: 303 });
}
