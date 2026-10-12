/**
 * Seed roles and, only when explicitly requested by environment variables, a
 * local/CI operations account. Production operators are provisioned through
 * the documented controlled procedure, never from a committed default secret.
 */
import { pbkdf2Sync, randomBytes } from 'node:crypto';
import { PrismaClient, RoleName } from '@prisma/client';

const prisma = new PrismaClient();
const ADMIN_PERMISSIONS = [
  'OPERATIONS_READ',
  'RFQ_WRITE',
  'QUOTE_WRITE',
  'FITMENT_APPROVE',
  'PAYMENT_WRITE',
  'MESSAGING_SEND',
  'RISK_REVIEW',
  'CATALOG_WRITE',
  'SUPPLIER_WRITE',
  'SHIPMENT_WRITE',
  'PAYOUT_MAKER',
  'PAYOUT_CHECKER',
  'EINVOICE_WRITE',
];

function passwordHash(password: string): string {
  const salt = randomBytes(16);
  const digest = pbkdf2Sync(password, salt, 310_000, 64, 'sha512');
  return [
    'pbkdf2-sha512',
    '310000',
    salt.toString('base64url'),
    digest.toString('base64url'),
  ].join('$');
}

async function main() {
  for (const name of [RoleName.CUSTOMER, RoleName.SUPPLIER, RoleName.ADMIN]) {
    await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
  }

  const phone = process.env.ADMIN_SEED_PHONE?.trim() ?? '';
  const password = process.env.ADMIN_SEED_PASSWORD ?? '';
  if (Boolean(phone) !== Boolean(password)) {
    throw new Error(
      'ADMIN_SEED_PHONE and ADMIN_SEED_PASSWORD must be supplied together',
    );
  }

  if (phone && password) {
    if (!/^\+9665\d{8}$/.test(phone) || password.length < 16) {
      throw new Error('Invalid controlled admin seed configuration');
    }

    const adminRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleName.ADMIN },
    });
    await prisma.user.upsert({
      where: { phone },
      update: {
        roleId: adminRole.id,
        passwordHash: passwordHash(password),
        adminPermissions: ADMIN_PERMISSIONS,
        isActive: true,
      },
      create: {
        phone,
        fullName: 'Rafraf CI Operator',
        roleId: adminRole.id,
        passwordHash: passwordHash(password),
        adminPermissions: ADMIN_PERMISSIONS,
      },
    });
    console.log('Seed complete: roles + controlled operations account.');
  } else {
    console.log('Seed complete: roles only.');
  }

  const customerPhone = process.env.CUSTOMER_SEED_PHONE?.trim() ?? '';
  if (customerPhone) {
    if (!/^\+9665\d{8}$/.test(customerPhone)) {
      throw new Error('Invalid controlled customer seed configuration');
    }
    const customerRole = await prisma.role.findUniqueOrThrow({
      where: { name: RoleName.CUSTOMER },
    });
    const customerUser = await prisma.user.upsert({
      where: { phone: customerPhone },
      update: {
        roleId: customerRole.id,
        isActive: true,
        phoneVerifiedAt: new Date(),
      },
      create: {
        phone: customerPhone,
        phoneVerifiedAt: new Date(),
        fullName: 'Rafraf CI Customer',
        roleId: customerRole.id,
      },
      include: { customer: true },
    });
    if (!customerUser.customer) {
      await prisma.customer.create({
        data: {
          userId: customerUser.id,
          fullName: 'Rafraf CI Customer',
        },
      });
    }
    console.log('Seed complete: controlled customer account.');
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
