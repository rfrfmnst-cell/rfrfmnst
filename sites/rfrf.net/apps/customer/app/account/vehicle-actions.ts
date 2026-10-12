'use server';

import { ActorType, prisma, Prisma } from '@rafraf/db';
import { revalidatePath } from 'next/cache';
import {
  customerVehicleAuditSnapshot,
  type CustomerVehicleInput,
  validateCustomerVehicleInput,
} from '../../lib/customer-vehicle';
import { getSessionCustomerId } from '../../lib/session';

export interface VehicleActionState {
  ok?: boolean;
  message?: string;
  error?: string;
}

const VEHICLE_ID = /^[A-Za-z0-9_-]{10,64}$/;

function vehicleId(formData: FormData): string | null {
  const value = String(formData.get('vehicleId') ?? '').trim();
  return VEHICLE_ID.test(value) ? value : null;
}

function vehicleInput(formData: FormData) {
  return validateCustomerVehicleInput({
    make: formData.get('make'),
    model: formData.get('model'),
    year: formData.get('year'),
    engine: formData.get('engine'),
    marketSpec: formData.get('marketSpec'),
    vin: formData.get('vin'),
    plate: formData.get('plate'),
    isDefault: formData.get('isDefault'),
  });
}

async function withCustomerVehicleLock<T>(
  customerId: string,
  operation: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return prisma.$transaction(
    async (tx) => {
      const lockKey = `customer-vehicles:${customerId}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      return operation(tx);
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

async function findDuplicateVehicle(
  tx: Prisma.TransactionClient,
  customerId: string,
  input: CustomerVehicleInput,
  excludeId?: string,
) {
  const alternatives: Prisma.CustomerVehicleWhereInput[] = [];
  if (input.vin) alternatives.push({ vin: input.vin });
  if (input.plate) {
    alternatives.push({
      plate: { equals: input.plate, mode: 'insensitive' },
    });
  }
  if (!input.vin && !input.plate) {
    alternatives.push({
      make: { equals: input.make, mode: 'insensitive' },
      model: { equals: input.model, mode: 'insensitive' },
      year: input.year,
      engine: input.engine
        ? { equals: input.engine, mode: 'insensitive' }
        : null,
    });
  }

  return tx.customerVehicle.findFirst({
    where: {
      customerId,
      id: excludeId ? { not: excludeId } : undefined,
      OR: alternatives,
    },
    select: { id: true },
  });
}

function safeFailure(operation: string, error: unknown): VehicleActionState {
  console.error(`[customer-vehicle] ${operation} failed`, {
    error: error instanceof Error ? error.name : 'UnknownError',
  });
  return { error: 'تعذّر حفظ التغيير الآن. حاول مرة أخرى.' };
}

export async function createCustomerVehicle(
  _state: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const parsed = vehicleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const result = await withCustomerVehicleLock(customerId, async (tx) => {
      if (await findDuplicateVehicle(tx, customerId, parsed.value)) {
        return { error: 'هذه المركبة محفوظة مسبقاً في حسابك.' };
      }

      const currentDefault = await tx.customerVehicle.findFirst({
        where: { customerId, isDefault: true },
        select: { id: true },
      });
      const isDefault = parsed.value.isDefault || !currentDefault;
      if (isDefault) {
        await tx.customerVehicle.updateMany({
          where: { customerId, isDefault: true },
          data: { isDefault: false },
        });
      }

      const created = await tx.customerVehicle.create({
        data: {
          customerId,
          make: parsed.value.make,
          model: parsed.value.model,
          year: parsed.value.year,
          engine: parsed.value.engine,
          marketSpec: parsed.value.marketSpec,
          vin: parsed.value.vin,
          plate: parsed.value.plate,
          isDefault,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_vehicle.created',
          entityType: 'customer_vehicle',
          entityId: created.id,
          after: customerVehicleAuditSnapshot(created),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تمت إضافة المركبة.' };
  } catch (error) {
    return safeFailure('create', error);
  }
}

export async function updateCustomerVehicle(
  _state: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = vehicleId(formData);
  if (!id) return { error: 'تعذّر العثور على المركبة في حسابك.' };
  const parsed = vehicleInput(formData);
  if (!parsed.ok) return { error: parsed.error };

  try {
    const result = await withCustomerVehicleLock(customerId, async (tx) => {
      const current = await tx.customerVehicle.findFirst({
        where: { id, customerId },
      });
      if (!current)
        return { error: 'تعذّر العثور على المركبة في حسابك.' };
      if (await findDuplicateVehicle(tx, customerId, parsed.value, id)) {
        return { error: 'هذه المركبة محفوظة مسبقاً في حسابك.' };
      }

      const fallback = await tx.customerVehicle.findFirst({
        where: { customerId, id: { not: id } },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      const isDefault =
        parsed.value.isDefault || (current.isDefault && !fallback);
      if (parsed.value.isDefault) {
        await tx.customerVehicle.updateMany({
          where: { customerId, id: { not: id }, isDefault: true },
          data: { isDefault: false },
        });
      } else if (current.isDefault && fallback) {
        await tx.customerVehicle.update({
          where: { id: fallback.id },
          data: { isDefault: true },
        });
      }

      const updated = await tx.customerVehicle.update({
        where: { id, customerId },
        data: {
          make: parsed.value.make,
          model: parsed.value.model,
          year: parsed.value.year,
          engine: parsed.value.engine,
          marketSpec: parsed.value.marketSpec,
          vin: parsed.value.vin,
          plate: parsed.value.plate,
          isDefault,
        },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_vehicle.updated',
          entityType: 'customer_vehicle',
          entityId: updated.id,
          before: customerVehicleAuditSnapshot(current),
          after: customerVehicleAuditSnapshot(updated),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تم تحديث المركبة.' };
  } catch (error) {
    return safeFailure('update', error);
  }
}

export async function deleteCustomerVehicle(
  _state: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = vehicleId(formData);
  if (!id) return { error: 'تعذّر العثور على المركبة في حسابك.' };

  try {
    const result = await withCustomerVehicleLock(customerId, async (tx) => {
      const current = await tx.customerVehicle.findFirst({
        where: { id, customerId },
      });
      if (!current)
        return { error: 'تعذّر العثور على المركبة في حسابك.' };

      await tx.customerVehicle.delete({ where: { id, customerId } });
      const remainingDefault = await tx.customerVehicle.findFirst({
        where: { customerId, isDefault: true },
        select: { id: true },
      });
      if (!remainingDefault) {
        const replacement = await tx.customerVehicle.findFirst({
          where: { customerId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          select: { id: true },
        });
        if (replacement) {
          await tx.customerVehicle.update({
            where: { id: replacement.id },
            data: { isDefault: true },
          });
        }
      }

      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_vehicle.deleted',
          entityType: 'customer_vehicle',
          entityId: current.id,
          before: customerVehicleAuditSnapshot(current),
        },
      });
      return { ok: true as const };
    });

    if ('error' in result) return result;
    revalidatePath('/account');
    return { ok: true, message: 'تم حذف المركبة.' };
  } catch (error) {
    return safeFailure('delete', error);
  }
}

export async function setDefaultCustomerVehicle(
  _state: VehicleActionState,
  formData: FormData,
): Promise<VehicleActionState> {
  const customerId = await getSessionCustomerId();
  if (!customerId) return { error: 'انتهت الجلسة. سجّل الدخول من جديد.' };
  const id = vehicleId(formData);
  if (!id) return { error: 'تعذّر العثور على المركبة في حسابك.' };

  try {
    const result = await withCustomerVehicleLock(customerId, async (tx) => {
      const current = await tx.customerVehicle.findFirst({
        where: { id, customerId },
      });
      if (!current)
        return { error: 'تعذّر العثور على المركبة في حسابك.' };
      if (current.isDefault) return { ok: true as const, changed: false };

      await tx.customerVehicle.updateMany({
        where: { customerId, isDefault: true },
        data: { isDefault: false },
      });
      const updated = await tx.customerVehicle.update({
        where: { id, customerId },
        data: { isDefault: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: customerId,
          actorType: ActorType.CUSTOMER,
          action: 'customer_vehicle.default_changed',
          entityType: 'customer_vehicle',
          entityId: updated.id,
          before: customerVehicleAuditSnapshot(current),
          after: customerVehicleAuditSnapshot(updated),
        },
      });
      return { ok: true as const, changed: true };
    });

    if ('error' in result) return result;
    if (result.changed) revalidatePath('/account');
    return { ok: true, message: 'تم تعيين المركبة الافتراضية.' };
  } catch (error) {
    return safeFailure('set-default', error);
  }
}
