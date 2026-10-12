'use server';

import { ActorType, prisma, Prisma } from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import {
  CUSTOMER_ADDRESS_TRANSACTION_ATTEMPTS,
  customerAddressAuditSnapshot,
  isRetryableCustomerAddressTransaction,
  MAX_CUSTOMER_ADDRESSES,
  type CustomerAddressInput,
  validateCustomerAddressInput,
} from '../../lib/customer-address';
import { getSessionCustomerId } from '../../lib/session';

export interface AddressActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const ADDRESS_ID = /^[A-Za-z0-9_-]{10,64}$/;

function addressId(formData: FormData): string | null {
  const value = String(formData.get('addressId') ?? '').trim();
  return ADDRESS_ID.test(value) ? value : null;
}

function addressInput(formData: FormData) {
  return validateCustomerAddressInput({
    label: formData.get('label'),
    city: formData.get('city'),
    district: formData.get('district'),
    street: formData.get('street'),
    buildingNumber: formData.get('buildingNumber'),
    postalCode: formData.get('postalCode'),
    additionalNumber: formData.get('additionalNumber'),
    unitNumber: formData.get('unitNumber'),
    isDefault: formData.get('isDefault'),
  });
}

async function withCustomerAddressLock<T>(
  customerId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (
    let attempt = 1;
    attempt <= CUSTOMER_ADDRESS_TRANSACTION_ATTEMPTS;
    attempt += 1
  ) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          const lockKey = `customer-addresses:${customerId}`;
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
          return operation(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (
        attempt === CUSTOMER_ADDRESS_TRANSACTION_ATTEMPTS ||
        !isRetryableCustomerAddressTransaction(error)
      ) {
        throw error;
      }
    }
  }

  throw new Error('Customer address transaction attempts exhausted');
}

async function findDuplicateAddress(
  tx: Prisma.TransactionClient,
  customerId: string,
  input: CustomerAddressInput,
  excludeId?: string,
) {
  return tx.customerAddress.findFirst({
    where: {
      customerId,
      id: excludeId ? { not: excludeId } : undefined,
      city: { equals: input.city, mode: 'insensitive' },
      district: { equals: input.district, mode: 'insensitive' },
      street: { equals: input.street, mode: 'insensitive' },
      buildingNumber: input.buildingNumber,
      postalCode: input.postalCode,
      additionalNumber: input.additionalNumber,
      unitNumber: input.unitNumber,
    },
    select: { id: true },
  });
}

function safeFailure(operation: string, error: unknown): AddressActionState {
  console.error(`[customer-address] ${operation} failed`, {
    error: error instanceof Error ? error.name : 'UnknownError',
  });
  return { error: 'تعذّر حفظ التغيير الآن. حاول مرة أخرى.' };
}

export async function createCustomerAddress(
  _state: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const parsed = addressInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const result = await withCustomerAddressLock(customerId, async (tx) => {
      const addressCount = await tx.customerAddress.count({
        where: { customerId },
      });
      if (addressCount >= MAX_CUSTOMER_ADDRESSES) {
        return { error: 'وصلت إلى الحد الأقصى وهو 10 عناوين.' };
      }
      if (await findDuplicateAddress(tx, customerId, parsed.value)) {
        return { error: 'هذا العنوان محفوظ مسبقاً في حسابك.' };
      }

      const currentDefault = await tx.customerAddress.findFirst({
        where: { customerId, isDefault: true },
        select: { id: true },
      });
      const isDefault = parsed.value.isDefault || !currentDefault;
      if (isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.customerAddress.create({
        data: { customerId, ...parsed.value, isDefault },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_address.created',
          entityType: 'customer_address',
          entityId: created.id,
          after: customerAddressAuditSnapshot(created),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تمت إضافة العنوان.' };
  } catch (error) {
    return safeFailure('create', error);
  }
}

export async function updateCustomerAddress(
  _state: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = addressId(formData);
  if (!id) return { error: 'تعذّر العثور على العنوان في حسابك.' };
  const parsed = addressInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const result = await withCustomerAddressLock(customerId, async (tx) => {
      const current = await tx.customerAddress.findFirst({
        where: { id, customerId },
      });
      if (!current) return { error: 'تعذّر العثور على العنوان في حسابك.' };
      if (await findDuplicateAddress(tx, customerId, parsed.value, id)) {
        return { error: 'هذا العنوان محفوظ مسبقاً في حسابك.' };
      }

      const fallback = await tx.customerAddress.findFirst({
        where: { customerId, id: { not: id } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const isDefault =
        parsed.value.isDefault || (current.isDefault && !fallback);
      if (parsed.value.isDefault) {
        await tx.customerAddress.updateMany({
          where: { customerId, id: { not: id }, isDefault: true },
          data: { isDefault: false },
        });
      }

      const updated = await tx.customerAddress.update({
        where: { id, customerId },
        data: { ...parsed.value, isDefault },
      });
      if (!parsed.value.isDefault && current.isDefault && fallback) {
        await tx.customerAddress.update({
          where: { id: fallback.id },
          data: { isDefault: true },
        });
      }
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_address.updated',
          entityType: 'customer_address',
          entityId: updated.id,
          before: customerAddressAuditSnapshot(current),
          after: customerAddressAuditSnapshot(updated),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تم تحديث العنوان.' };
  } catch (error) {
    return safeFailure('update', error);
  }
}

export async function deleteCustomerAddress(
  _state: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = addressId(formData);
  if (!id) return { error: 'تعذّر العثور على العنوان في حسابك.' };

  try {
    const result = await withCustomerAddressLock(customerId, async (tx) => {
      const current = await tx.customerAddress.findFirst({
        where: { id, customerId },
      });
      if (!current) return { error: 'تعذّر العثور على العنوان في حسابك.' };

      await tx.customerAddress.delete({ where: { id, customerId } });
      const remainingDefault = await tx.customerAddress.findFirst({
        where: { customerId, isDefault: true },
        select: { id: true },
      });
      if (!remainingDefault) {
        const replacement = await tx.customerAddress.findFirst({
          where: { customerId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement) {
          await tx.customerAddress.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_address.deleted',
          entityType: 'customer_address',
          entityId: current.id,
          before: customerAddressAuditSnapshot(current),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تم حذف العنوان.' };
  } catch (error) {
    return safeFailure('delete', error);
  }
}

export async function setDefaultCustomerAddress(
  _state: AddressActionState,
  formData: FormData,
): Promise<AddressActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = addressId(formData);
  if (!id) return { error: 'تعذّر العثور على العنوان في حسابك.' };

  try {
    const result = await withCustomerAddressLock(customerId, async (tx) => {
      const current = await tx.customerAddress.findFirst({
        where: { id, customerId },
      });
      if (!current) return { error: 'تعذّر العثور على العنوان في حسابك.' };
      if (current.isDefault) return { ok: true as const, changed: false };

      await tx.customerAddress.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
      const updated = await tx.customerAddress.update({
        where: { id, customerId },
        data: { isDefault: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_address.default_changed',
          entityType: 'customer_address',
          entityId: updated.id,
          before: customerAddressAuditSnapshot(current),
          after: customerAddressAuditSnapshot(updated),
        },
      });
      return { ok: true as const, changed: true };
    });

    if ('error' in result) return result;
    if (result.changed) revalidatePath('/account');
    return { ok: true, message: 'تم تعيين العنوان الافتراضي.' };
  } catch (error) {
    return safeFailure('set-default', error);
  }
}
