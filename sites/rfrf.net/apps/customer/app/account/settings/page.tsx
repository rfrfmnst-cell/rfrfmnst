import { prisma } from '@rafraf/db';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getSessionCustomerId } from '../../../lib/session';
import { customerLoginRedirectPath } from '../../../lib/customer-proxy-policy';
import { AccountHeader } from '../account-header';
import { AccountSettingsContent } from '../account-settings-content';
import styles from '../account-styles';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'إعدادات الحساب — رفرف',
  description: 'أدر بيانات حسابك وعناوين الشحن ومركباتك في رفرف.',
};

export default async function CustomerSettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ profile?: string | string[] }>;
}) {
  const resolvedSearchParams = await searchParams;
  const rawProfile = resolvedSearchParams.profile;
  const profileStatus = Array.isArray(rawProfile) ? rawProfile[0] : rawProfile;
  const customerId = await getSessionCustomerId();
  if (!customerId)
    redirect(
      customerLoginRedirectPath('/account/settings', resolvedSearchParams),
    );

  const [customer, addresses, vehicles] = await Promise.all([
    prisma.customer.findUnique({
      where: { id: customerId },
      include: {
        user: {
          select: {
            email: true,
            phone: true,
            phoneVerifiedAt: true,
            isActive: true,
            createdAt: true,
            lastLoginAt: true,
            emailVerifiedAt: true,
            googleSubject: true,
          },
        },
      },
    }),
    prisma.customerAddress.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    }),
    prisma.customerVehicle.findMany({
      where: { customerId },
      orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
    }),
  ]);
  if (!customer || !customer.user.isActive)
    redirect(
      customerLoginRedirectPath('/account/settings', resolvedSearchParams),
    );

  return (
    <>
      <AccountHeader active="settings" customerName={customer.fullName} />
      <main className={`container ${styles.main} rafraf-page-enter`}>
        <AccountSettingsContent
          customer={customer}
          profileStatus={profileStatus}
          addresses={addresses.map((address) => ({
            id: address.id,
            label: address.label,
            city: address.city,
            district: address.district,
            street: address.street,
            buildingNumber: address.buildingNumber,
            postalCode: address.postalCode,
            additionalNumber: address.additionalNumber,
            unitNumber: address.unitNumber,
            isDefault: address.isDefault,
          }))}
          vehicles={vehicles.map((vehicle) => ({
            id: vehicle.id,
            make: vehicle.make,
            model: vehicle.model,
            year: vehicle.year,
            engine: vehicle.engine,
            marketSpec: vehicle.marketSpec,
            vin: vehicle.vin,
            plate: vehicle.plate,
            isDefault: vehicle.isDefault,
          }))}
        />
      </main>
    </>
  );
}
