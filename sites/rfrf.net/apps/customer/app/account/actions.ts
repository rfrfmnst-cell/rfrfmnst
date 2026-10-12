'use server';

import { prisma } from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { customerSettingsProfilePath } from './account-navigation';
import { normalizeCustomerEmail } from '../../lib/customer-profile';
import { getSessionCustomerId } from '../../lib/session';

class DuplicateCustomerEmail extends Error {}
class CustomerUnavailable extends Error {}

function textField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === 'string' ? value.trim() : '';
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

export async function updateCustomerProfile(formData: FormData) {
  const customerId = await getSessionCustomerId();
  if (!customerId) redirect('/login');

  const fullName = textField(formData, 'fullName');
  const city = textField(formData, 'city');
  const email = normalizeCustomerEmail(formData.get('email'));
  if (
    fullName.length < 2 ||
    fullName.length > 120 ||
    city.length > 80 ||
    !email
  ) {
    redirect(customerSettingsProfilePath('invalid'));
  }

  try {
    await prisma.$transaction(async (tx) => {
      const customer = await tx.customer.findFirst({
        where: { id: customerId, user: { isActive: true } },
        select: { userId: true },
      });
      if (!customer) throw new CustomerUnavailable();

      const duplicate = await tx.user.findFirst({
        where: {
          id: { not: customer.userId },
          email: { equals: email, mode: 'insensitive' },
        },
        select: { id: true },
      });
      if (duplicate) throw new DuplicateCustomerEmail();

      await tx.customer.update({
        where: { id: customerId },
        data: { fullName, city: city || null },
      });
      await tx.user.update({
        where: { id: customer.userId },
        data: { fullName, email },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: 'CUSTOMER',
          action: 'customer.profile.updated',
          entityType: 'customer',
          entityId: customerId,
          after: { emailPresent: true, cityPresent: Boolean(city) },
        },
      });
    });
  } catch (error) {
    if (error instanceof CustomerUnavailable) redirect('/login');
    if (error instanceof DuplicateCustomerEmail || isUniqueViolation(error)) {
      redirect(customerSettingsProfilePath('duplicate'));
    }
    console.error('[customer-profile] update failed', {
      code: 'PROFILE_UPDATE_FAILED',
    });
    redirect(customerSettingsProfilePath('failed'));
  }

  revalidatePath('/account');
  revalidatePath('/account/settings');
  redirect(customerSettingsProfilePath('saved'));
}
