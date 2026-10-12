import { RoleName, type Prisma } from '@rafraf/db';

export class CustomerIdentityVerificationRequired extends Error {
  constructor() {
    super('CUSTOMER_IDENTITY_VERIFICATION_REQUIRED');
    this.name = 'CustomerIdentityVerificationRequired';
  }
}

export async function requireVerifiedPublicIntakeCustomer(
  client: Pick<Prisma.TransactionClient, 'customer'>,
  customerId: string,
  phone: string,
) {
  const customer = await client.customer.findUnique({
    where: { id: customerId },
    include: {
      user: {
        select: {
          phone: true,
          isActive: true,
          role: { select: { name: true } },
        },
      },
    },
  });
  if (
    !customer ||
    customer.user.phone !== phone ||
    !customer.user.isActive ||
    customer.user.role.name !== RoleName.CUSTOMER
  ) {
    // New and existing numbers intentionally share this exact outcome. Only
    // an OTP-backed session for the submitted phone may attach intake data.
    throw new CustomerIdentityVerificationRequired();
  }
  return customer;
}
