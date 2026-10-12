import { RoleName, prisma } from '@rafraf/db';
import { cookies } from 'next/headers';
import { cache } from 'react';
import {
  isAdminPermission,
  type AdminPermission,
  verifyAdminSession,
} from './admin-session';

export interface AdminPrincipal {
  userId: string;
  fullName: string | null;
  permissions: readonly AdminPermission[];
}

type AdminResolution =
  | { status: 'required' }
  | { status: 'revoked' }
  | { status: 'permission_required' }
  | { status: 'authenticated'; principal: AdminPrincipal };

const resolveAdminSession = cache(async (): Promise<AdminResolution> => {
  const cookieStore = await cookies();
  const session = await verifyAdminSession(
    cookieStore.get('ops_session')?.value,
  );
  if (!session) return { status: 'required' };

  const user = await prisma.user.findUnique({
    where: { id: session.userId },
    select: {
      id: true,
      fullName: true,
      isActive: true,
      adminPermissions: true,
      role: { select: { name: true } },
    },
  });
  if (!user || !user.isActive || user.role.name !== RoleName.ADMIN) {
    return { status: 'revoked' };
  }

  const permissions = [
    ...new Set(user.adminPermissions.filter(isAdminPermission)),
  ];
  if (permissions.length === 0) return { status: 'permission_required' };

  return {
    status: 'authenticated',
    principal: { userId: user.id, fullName: user.fullName, permissions },
  };
});

export async function getAdminPrincipal(): Promise<AdminPrincipal | null> {
  const resolution = await resolveAdminSession();
  return resolution.status === 'authenticated' ? resolution.principal : null;
}

export async function requireAdminSession(): Promise<AdminPrincipal> {
  const resolution = await resolveAdminSession();
  if (resolution.status === 'required') {
    throw new Error('ADMIN_SESSION_REQUIRED');
  }
  if (resolution.status === 'revoked') {
    throw new Error('ADMIN_SESSION_REVOKED');
  }
  if (resolution.status === 'permission_required') {
    throw new Error('ADMIN_PERMISSION_REQUIRED');
  }
  return resolution.principal;
}

export async function requireAdminPermission(
  permission: AdminPermission,
): Promise<AdminPrincipal> {
  const principal = await requireAdminSession();
  if (!principal.permissions.includes(permission)) {
    throw new Error('ADMIN_PERMISSION_REQUIRED');
  }
  return principal;
}
