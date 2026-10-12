import { InventoryRowStatus, Prisma } from '@rafraf/db';
import type { CatalogImportIssue, ParsedInventoryRow } from './catalog-import';

export type ResolvedInventoryRow = ParsedInventoryRow & {
  warehouseId: string | null;
};

function normalizeLookup(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLocaleUpperCase('en-US');
}

function duplicateKey(partNumber: string, warehouseId: string | null): string {
  return `${normalizeLookup(partNumber)}::${warehouseId ?? '__NO_WAREHOUSE__'}`;
}

function chunks<T>(values: T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    output.push(values.slice(index, index + size));
  }
  return output;
}

export async function resolveImportWarehouses(
  tx: Prisma.TransactionClient,
  supplierId: string,
  rows: ParsedInventoryRow[],
): Promise<{
  rows: ResolvedInventoryRow[];
  errors: CatalogImportIssue[];
}> {
  const warehouses = await tx.supplierWarehouse.findMany({
    where: { supplierId },
    select: { id: true, name: true, isDefault: true },
  });
  const warehouseById = new Map(warehouses.map((item) => [item.id, item]));
  const warehousesByName = new Map<string, typeof warehouses>();
  for (const warehouse of warehouses) {
    const key = normalizeLookup(warehouse.name);
    warehousesByName.set(key, [
      ...(warehousesByName.get(key) ?? []),
      warehouse,
    ]);
  }
  const defaultWarehouseId =
    warehouses.find((warehouse) => warehouse.isDefault)?.id ?? null;

  const resolvedRows: ResolvedInventoryRow[] = [];
  const errors: CatalogImportIssue[] = [];
  for (const row of rows) {
    let warehouseId = defaultWarehouseId;
    if (row.warehouseRef) {
      const byId = warehouseById.get(row.warehouseRef);
      const byName =
        warehousesByName.get(normalizeLookup(row.warehouseRef)) ?? [];
      if (byId) {
        warehouseId = byId.id;
      } else if (byName.length === 1) {
        warehouseId = byName[0]?.id ?? null;
      } else if (byName.length > 1) {
        errors.push({
          row: row.row,
          field: 'warehouse',
          message: 'اسم المستودع مكرر؛ استخدم معرّف المستودع بدل الاسم.',
        });
        continue;
      } else {
        errors.push({
          row: row.row,
          field: 'warehouse',
          message: 'المستودع غير موجود ضمن مستودعات منشأتك.',
        });
        continue;
      }
    }
    resolvedRows.push({ ...row, warehouseId });
  }
  return { rows: resolvedRows, errors };
}

export async function findImportDuplicateIssues(
  tx: Prisma.TransactionClient,
  supplierId: string,
  rows: ResolvedInventoryRow[],
): Promise<CatalogImportIssue[]> {
  const errors: CatalogImportIssue[] = [];
  const seen = new Map<string, number>();
  for (const row of rows) {
    const key = duplicateKey(row.partNumber, row.warehouseId);
    const firstRow = seen.get(key);
    if (firstRow != null) {
      errors.push({
        row: row.row,
        field: 'part_number',
        message: `صف مكرر لنفس القطعة والمستودع (أول ظهور في الصف ${firstRow}).`,
      });
    } else {
      seen.set(key, row.row);
    }
  }

  const partNumbers = [...new Set(rows.map((row) => row.partNumber))];
  const existingInventory: Array<{
    partNumber: string;
    warehouseId: string | null;
  }> = [];
  for (const group of chunks(partNumbers, 80)) {
    const filters: Prisma.SupplierInventoryWhereInput[] = group.map(
      (partNumber) => ({
        partNumber: { equals: partNumber, mode: 'insensitive' },
      }),
    );
    existingInventory.push(
      ...(await tx.supplierInventory.findMany({
        where: { supplierId, isActive: true, OR: filters },
        select: { partNumber: true, warehouseId: true },
      })),
    );
  }
  const existingKeys = new Set(
    existingInventory.map((item) =>
      duplicateKey(item.partNumber, item.warehouseId),
    ),
  );
  for (const row of rows) {
    if (existingKeys.has(duplicateKey(row.partNumber, row.warehouseId))) {
      errors.push({
        row: row.row,
        field: 'part_number',
        message: 'هذه القطعة موجودة مسبقًا في المستودع المحدد.',
      });
    }
  }
  return errors;
}

export async function buildImportInventoryRows(
  tx: Prisma.TransactionClient,
  supplierId: string,
  rows: ResolvedInventoryRow[],
  batchId: string,
): Promise<{
  inventoryRows: Prisma.SupplierInventoryCreateManyInput[];
  warnings: CatalogImportIssue[];
}> {
  const partNumbers = [...new Set(rows.map((row) => row.partNumber))];
  const catalogMatches: Array<{ number: string; partId: string }> = [];
  for (const group of chunks(partNumbers, 80)) {
    const filters: Prisma.PartNumberWhereInput[] = group.map((number) => ({
      number: { equals: number, mode: 'insensitive' },
    }));
    catalogMatches.push(
      ...(await tx.partNumber.findMany({
        where: { OR: filters },
        select: { number: true, partId: true },
      })),
    );
  }

  const partIdsByNumber = new Map<string, Set<string>>();
  for (const match of catalogMatches) {
    const key = normalizeLookup(match.number);
    const values = partIdsByNumber.get(key) ?? new Set<string>();
    values.add(match.partId);
    partIdsByNumber.set(key, values);
  }

  const warnings: CatalogImportIssue[] = [];
  const inventoryRows: Prisma.SupplierInventoryCreateManyInput[] = rows.map(
    (row) => {
      const partIds = partIdsByNumber.get(normalizeLookup(row.partNumber));
      const partId =
        partIds && partIds.size === 1
          ? (partIds.values().next().value ?? null)
          : null;
      if (!partId) {
        warnings.push({
          row: row.row,
          field: 'part_number',
          message:
            partIds && partIds.size > 1
              ? 'رقم القطعة يطابق أكثر من سجل كتالوج؛ تم استيراده للمراجعة.'
              : 'رقم القطعة غير موجود في كتالوج رفرف؛ تم استيراده للمراجعة.',
        });
      }
      return {
        supplierId,
        warehouseId: row.warehouseId,
        partId,
        partNumber: row.partNumber,
        brand: row.brand,
        condition: row.condition,
        quantity: row.quantity,
        price: new Prisma.Decimal(row.price),
        currency: row.currency,
        warrantyMonths: row.warrantyMonths,
        leadTimeDays: row.leadTimeDays,
        rowStatus: partId
          ? InventoryRowStatus.VALID
          : InventoryRowStatus.FLAGGED,
        uploadBatchId: batchId,
        isActive: true,
      };
    },
  );
  return { inventoryRows, warnings };
}
