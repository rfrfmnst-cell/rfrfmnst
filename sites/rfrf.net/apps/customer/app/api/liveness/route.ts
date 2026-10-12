import { readReleaseSha } from '@rafraf/shared/release-identity';

export const dynamic = 'force-dynamic';

export function GET() {
  const release = readReleaseSha();
  return Response.json(
    {
      service: 'rafraf-customer',
      status: 'alive',
      release: release?.slice(0, 12) ?? null,
    },
    { headers: { 'Cache-Control': 'no-store, max-age=0' } },
  );
}
