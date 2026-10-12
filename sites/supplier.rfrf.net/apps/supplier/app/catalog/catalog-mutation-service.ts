import {
  ActorType,
  InventoryRowStatus,
  PartCondition,
  Prisma,
  prisma,
  SupplierStatus,
} from '@rafraf/db';
import type { CatalogItemInput } from './catalog-policy';

export type CatalogMutationFailure =
  'auth' | 'duplicate' | 'invalid' | 'not_found' | 'save' | 'warehouse';

export type CatalogMutationResult =
  | { ok: true; replayed: boolean }
  | { ok: false; reason: CatalogMutationFailure };

const CONDITION_TO_DB: Record<CatalogItemInput['condition'], PartCondition> = {
  NEW: PartCondition.NEW,
  USED: PartCondition.USED,
  REFURBISHED: PartCondition.REFURBISHED,
};

function receiptEntityId(supplierId: string, token: string): string {
  return `${supplierId}:${token}`;
}

async function lockKeys(
  tx: Prisma.TransactionClient,
  keys: string[],
): Promise<void> {
  for (const key of [...new Set(keys)].sort()) {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;
  }
}

async function receiptState(
  tx: Prisma.TransactionClient,
  supplierId: string,
  token: string,
  action: string,
): Promise<'new' | 'replayed' | 'conflict'> {
  const receipt = await tx.auditLog.findFirst({
    where: {
      actorType: ActorType.SUPPLIER,
      actorId: supplierId,
      entityType: 'supplier_inventory_mutation',
      entityId: receiptEntityId(supplierId, token),
    },
    select: { action: true },
  });
  if (!receipt) return 'new';
  return receipt.action === action ? 'replayed' : 'conflict';
}

async function approvedSupplier(
  tx: Prisma.TransactionClient,
  supplierId: string,
): Promise<boolean> {
  const supplier = await tx.supplier.findUnique({
    where: { id: supplierId },
    select: { status: true },
  });
  return supplier?.status === SupplierStatus.APPROVED;
}

async function ownedWarehouseExists(
  tx: Prisma.TransactionClient,
  supplierId: string,
  warehouseId: string | null,
): Promise<boolean> {
  if (!warehouseId) return true;
  const warehouse = await tx.supplierWarehouse.findFirst({
    where: { id: warehouseId, supplierId },
    select: { id: true },
  });
  return Boolean(warehouse);
}

// مُصدَّرة ليختبرها استيراد أرقام القطع على قاعدة حقيقية: هي المستهلك الوحيد
// لجدول `PartNumber`، وأي مطابقة تفشل هنا تُبقي صفّ الكتالوج `FLAGGED`.
export async function resolvePart(
  tx: Prisma.TransactionClient,
  partNumber: string,
): Promise<{ partId: string | null; rowStatus: InventoryRowStatus }> {
  const matches = await tx.partNumber.findMany({
    where: { number: { equals: partNumber, mode: 'insensitive' } },
    select: { partId: true },
    take: 3,
  });
  const partIds = [...new Set(matches.map((match) => match.partId))];
  return partIds.length === 1
    ? { partId: partIds[0] ?? null, rowStatus: InventoryRowStatus.VALID }
    : { partId: null, rowStatus: InventoryRowStatus.FLAGGED };
}

async function duplicateInventoryExists(
  tx: Prisma.TransactionClient,
  args: {
    supplierId: string;
    partNumber: string;
    warehouseId: string | null;
    excludeId?: string;
    activeOnly?: boolean;
  },
): Promise<boolean> {
  const duplicate = await tx.supplierInventory.findFirst({
    where: {
      supplierId: args.supplierId,
      warehouseId: args.warehouseId,
      partNumber: { equals: args.partNumber, mode: 'insensitive' },
      ...(args.excludeId ? { NOT: { id: args.excludeId } } : {}),
      ...(args.activeOnly ? { isActive: true } : {}),
    },
    select: { id: true },
  });
  return Boolean(duplicate);
}

function auditSnapshot(input: CatalogItemInput, partId: string | null) {
  return {
    partNumber: input.partNumber,
    brand: input.brand,
    condition: input.condition,
    quantity: input.quantity,
    price: input.price,
    currency: input.currency,
    warrantyMonths: input.warrantyMonths,
    leadTimeDays: input.leadTimeDays,
    warehouseId: input.warehouseId,
    partId,
  };
}

function isRetryable(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === 'P2034';
}

async function serializable<T>(
  callback: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await prisma.$transaction(callback, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (!isRetryable(error) || attempt === 2) throw error;
    }
  }
  throw new Error('unreachable catalog transaction retry');
}

export function persistNewCatalogItem(args: {
  supplierId: string;
  token: string;
  input: CatalogItemInput;
}): Promise<CatalogMutationResult> {
  return serializable(async (tx): Promise<CatalogMutationResult> => {
    const { supplierId, token, input } = args;
    const semanticKey = `supplier-inventory:${supplierId}:${input.warehouseId ?? 'none'}:${input.partNumber}`;
    await lockKeys(tx, [
      `supplier-inventory-catalog:${supplierId}`,
      `supplier-inventory-receipt:${receiptEntityId(supplierId, token)}`,
      semanticKey,
    ]);

    if (!(await approvedSupplier(tx, supplierId))) {
      return { ok: false, reason: 'auth' };
    }
    const receipt = await receiptState(
      tx,
      supplierId,
      token,
      'supplier.inventory.created',
    );
    if (receipt === 'replayed') return { ok: true, replayed: true };
    if (receipt === 'conflict') return { ok: false, reason: 'invalid' };
    if (!(await ownedWarehouseExists(tx, supplierId, input.warehouseId))) {
      return { ok: false, reason: 'warehouse' };
    }
    if (
      await duplicateInventoryExists(tx, {
        supplierId,
        partNumber: input.partNumber,
        warehouseId: input.warehouseId,
      })
    ) {
      return { ok: false, reason: 'duplicate' };
    }

    const resolvedPart = await resolvePart(tx, input.partNumber);
    const item = await tx.supplierInventory.create({
      data: {
        supplierId,
        warehouseId: input.warehouseId,
        partId: resolvedPart.partId,
        partNumber: input.partNumber,
        brand: input.brand,
        condition: CONDITION_TO_DB[input.condition],
        quantity: input.quantity,
        price: new Prisma.Decimal(input.price),
        currency: input.currency,
        warrantyMonths: input.warrantyMonths,
        leadTimeDays: input.leadTimeDays,
        rowStatus: resolvedPart.rowStatus,
        isActive: true,
      },
      select: { id: true },
    });
    await tx.auditLog.create({
      data: {
        actorType: ActorType.SUPPLIER,
        actorId: supplierId,
        action: 'supplier.inventory.created',
        entityType: 'supplier_inventory_mutation',
        entityId: receiptEntityId(supplierId, token),
        after: {
          inventoryId: item.id,
          ...auditSnapshot(input, resolvedPart.partId),
          isActive: true,
        },
      },
    });
    return { ok: true, replayed: false };
  });
}

export function persistCatalogItemUpdate(args: {
  supplierId: string;
  itemId: string;
  token: string;
  input: CatalogItemInput;
}): Promise<CatalogMutationResult> {
  return serializable(async (tx): Promise<CatalogMutationResult> => {
    const { supplierId, itemId, token, input } = args;
    await lockKeys(tx, [
      `supplier-inventory-catalog:${supplierId}`,
      `supplier-inventory-item:${itemId}`,
      `supplier-inventory-receipt:${receiptEntityId(supplierId, token)}`,
      `supplier-inventory:${supplierId}:${input.warehouseId ?? 'none'}:${input.partNumber}`,
    ]);
    if (!(await approvedSupplier(tx, supplierId))) {
      return { ok: false, reason: 'auth' };
    }
    const receipt = await receiptState(
      tx,
      supplierId,
      token,
      'supplier.inventory.updated',
    );
    if (receipt === 'replayed') return { ok: true, replayed: true };
    if (receipt === 'conflict') return { ok: false, reason: 'invalid' };

    const current = await tx.supplierInventory.findFirst({
      where: { id: itemId, supplierId },
      select: {
        id: true,
        partId: true,
        partNumber: true,
        brand: true,
        condition: true,
        quantity: true,
        price: true,
        currency: true,
        warrantyMonths: true,
        leadTimeDays: true,
        warehouseId: true,
        rowStatus: true,
        isActive: true,
      },
    });
    if (!current) return { ok: false, reason: 'not_found' };
    if (!(await ownedWarehouseExists(tx, supplierId, input.warehouseId))) {
      return { ok: false, reason: 'warehouse' };
    }
    if (
      await duplicateInventoryExists(tx, {
        supplierId,
        partNumber: input.partNumber,
        warehouseId: input.warehouseId,
        excludeId: itemId,
      })
    ) {
      return { ok: false, reason: 'duplicate' };
    }

    const resolvedPart = await resolvePart(tx, input.partNumber);
    const updated = await tx.supplierInventory.updateMany({
      where: { id: itemId, supplierId },
      data: {
        warehouseId: input.warehouseId,
        partId: resolvedPart.partId,
        partNumber: input.partNumber,
        brand: input.brand,
        condition: CONDITION_TO_DB[input.condition],
        quantity: input.quantity,
        price: new Prisma.Decimal(input.price),
        currency: input.currency,
        warrantyMonths: input.warrantyMonths,
        leadTimeDays: input.leadTimeDays,
        rowStatus: resolvedPart.rowStatus,
      },
    });
    if (updated.count !== 1) return { ok: false, reason: 'not_found' };

    await tx.auditLog.create({
      data: {
        actorType: ActorType.SUPPLIER,
        actorId: supplierId,
        action: 'supplier.inventory.updated',
        entityType: 'supplier_inventory_mutation',
        entityId: receiptEntityId(supplierId, token),
        before: {
          inventoryId: current.id,
          partId: current.partId,
          partNumber: current.partNumber,
          brand: current.brand,
          condition: current.condition,
          quantity: current.quantity,
          price: current.price.toString(),
          currency: current.currency,
          warrantyMonths: current.warrantyMonths,
          leadTimeDays: current.leadTimeDays,
          warehouseId: current.warehouseId,
          rowStatus: current.rowStatus,
          isActive: current.isActive,
        },
        after: {
          inventoryId: itemId,
          ...auditSnapshot(input, resolvedPart.partId),
          rowStatus: resolvedPart.rowStatus,
          isActive: current.isActive,
        },
      },
    });
    return { ok: true, replayed: false };
  });
}

export function persistCatalogItemActiveState(args: {
  supplierId: string;
  itemId: string;
  token: string;
  nextActive: boolean;
}): Promise<CatalogMutationResult> {
  return serializable(async (tx): Promise<CatalogMutationResult> => {
    const { supplierId, itemId, token, nextActive } = args;
    const action = nextActive
      ? 'supplier.inventory.activated'
      : 'supplier.inventory.deactivated';
    await lockKeys(tx, [
      `supplier-inventory-catalog:${supplierId}`,
      `supplier-inventory-item:${itemId}`,
      `supplier-inventory-receipt:${receiptEntityId(supplierId, token)}`,
    ]);
    if (!(await approvedSupplier(tx, supplierId))) {
      return { ok: false, reason: 'auth' };
    }
    const receipt = await receiptState(tx, supplierId, token, action);
    if (receipt === 'replayed') return { ok: true, replayed: true };
    if (receipt === 'conflict') return { ok: false, reason: 'invalid' };

    const current = await tx.supplierInventory.findFirst({
      where: { id: itemId, supplierId },
      select: {
        id: true,
        partNumber: true,
        warehouseId: true,
        isActive: true,
      },
    });
    if (!current) return { ok: false, reason: 'not_found' };
    if (
      nextActive &&
      (await duplicateInventoryExists(tx, {
        supplierId,
        partNumber: current.partNumber,
        warehouseId: current.warehouseId,
        excludeId: itemId,
        activeOnly: true,
      }))
    ) {
      return { ok: false, reason: 'duplicate' };
    }

    const updated = await tx.supplierInventory.updateMany({
      where: { id: itemId, supplierId },
      data: { isActive: nextActive },
    });
    if (updated.count !== 1) return { ok: false, reason: 'not_found' };

    await tx.auditLog.create({
      data: {
        actorType: ActorType.SUPPLIER,
        actorId: supplierId,
        action,
        entityType: 'supplier_inventory_mutation',
        entityId: receiptEntityId(supplierId, token),
        before: { inventoryId: itemId, isActive: current.isActive },
        after: { inventoryId: itemId, isActive: nextActive },
      },
    });
    return { ok: true, replayed: false };
  });
}
