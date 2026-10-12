import { authorizeSupplierSession } from './session-access.ts';
import { verifySession } from './session-token.ts';

export { signSession, verifySession } from './session-token.ts';

export async function getSessionSupplierId(): Promise<string | null> {
  const { cookies } = await import('next/headers');
  const cookieStore = await cookies();
  return authorizeSupplierSession(
    cookieStore.get('sp_auth')?.value,
    verifySession,
    async (supplierId) => {
      const { prisma } = await import('@rafraf/db');
      return prisma.supplier.findUnique({
        where: { id: supplierId },
        select: { status: true },
      });
    },
  );
}
