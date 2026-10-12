'use server';

import { ActorType, Prisma, prisma, SupplierStatus } from '@rafraf/db';
import { createHash, randomUUID } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { getSessionSupplierId } from '../../../lib/session';
import {
  type CatalogHeader,
  type CatalogImportState,
  MAX_CATALOG_FILE_BYTES,
  MAX_CATALOG_ROWS,
  type ParsedInventoryRow,
} from './catalog-import';
import { parseCatalogUpload } from './catalog-import-parser';
import {
  buildImportInventoryRows,
  findImportDuplicateIssues,
  resolveImportWarehouses,
} from './catalog-import-persistence';
import {
  catalogImportErrorState,
  catalogImportSuccessState,
  catalogImportValidationState,
  safeCatalogImportClientToken,
  safeCatalogImportFileName,
} from './catalog-import-state';

type ImportTransactionArgs = {
  supplierId: string;
  clientToken: string | null;
  fileName: string;
  fileSize: number;
  fileHash: string;
  headers: CatalogHeader[];
  rows: ParsedInventoryRow[];
  batchId: string;
};

async function runImportTransaction(
  args: ImportTransactionArgs,
): Promise<CatalogImportState> {
  return prisma.$transaction(
    async (tx) => {
      const supplier = await tx.supplier.findUnique({
        where: { id: args.supplierId },
        select: { status: true },
      });
      if (!supplier || supplier.status !== SupplierStatus.APPROVED) {
        return catalogImportErrorState(
          args.clientToken,
          args.fileName,
          args.fileSize,
          'لا يملك هذا الحساب صلاحية استيراد المخزون.',
        );
      }

      const resolved = await resolveImportWarehouses(
        tx,
        args.supplierId,
        args.rows,
      );
      const duplicateIssues = await findImportDuplicateIssues(
        tx,
        args.supplierId,
        resolved.rows,
      );
      const databaseErrors = [...resolved.errors, ...duplicateIssues];
      if (databaseErrors.length > 0) {
        return catalogImportValidationState(
          args.clientToken,
          args.fileName,
          args.fileSize,
          args.rows.length,
          databaseErrors,
        );
      }

      const { inventoryRows, warnings } = await buildImportInventoryRows(
        tx,
        args.supplierId,
        resolved.rows,
        args.batchId,
      );
      await tx.supplierInventory.createMany({ data: inventoryRows });
      await tx.auditLog.create({
        data: {
          actorType: ActorType.SUPPLIER,
          actorId: args.supplierId,
          action: 'supplier.inventory.csv_imported',
          entityType: 'supplier_inventory_batch',
          entityId: args.batchId,
          after: {
            fileName: args.fileName,
            fileSize: args.fileSize,
            fileSha256: args.fileHash,
            headers: args.headers,
            totalRows: args.rows.length,
            importedRows: inventoryRows.length,
            flaggedRows: warnings.length,
            rowLimit: MAX_CATALOG_ROWS,
          },
        },
      });
      return catalogImportSuccessState({
        clientToken: args.clientToken,
        fileName: args.fileName,
        fileSize: args.fileSize,
        totalRows: inventoryRows.length,
        warnings,
        batchId: args.batchId,
      });
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}

function isSerializationConflict(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }
  return (error as { code?: unknown }).code === 'P2034';
}

export async function importSupplierCatalog(
  _previousState: CatalogImportState,
  formData: FormData,
): Promise<CatalogImportState> {
  const clientToken = safeCatalogImportClientToken(formData.get('clientToken'));
  const candidate = formData.get('catalogFile');
  const file = candidate instanceof File ? candidate : null;
  const fileName = file ? safeCatalogImportFileName(file.name) : null;
  const fileSize = file?.size ?? null;
  const supplierId = await getSessionSupplierId();

  if (!supplierId) {
    return catalogImportErrorState(
      clientToken,
      fileName,
      fileSize,
      'انتهت الجلسة. سجّل الدخول ثم أعد المحاولة.',
    );
  }

  const parsed = await parseCatalogUpload(file, clientToken, {
    maxFileBytes: MAX_CATALOG_FILE_BYTES,
    maxRows: MAX_CATALOG_ROWS,
  });
  if (!parsed.ok) return parsed.state;

  const transactionArgs: ImportTransactionArgs = {
    supplierId,
    clientToken,
    fileName: parsed.fileName,
    fileSize: parsed.fileSize,
    fileHash: createHash('sha256').update(parsed.bytes).digest('hex'),
    headers: parsed.headers,
    rows: parsed.rows,
    batchId: randomUUID(),
  };

  try {
    let result: CatalogImportState | null = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        result = await runImportTransaction(transactionArgs);
        break;
      } catch (error) {
        if (!isSerializationConflict(error) || attempt === 1) throw error;
      }
    }
    if (!result)
      throw new Error('catalog import transaction returned no result');
    if (result.status === 'success') {
      revalidatePath('/catalog/import');
      revalidatePath('/');
    }
    return result;
  } catch {
    console.error('supplier catalog import failed');
    return catalogImportErrorState(
      clientToken,
      fileName,
      fileSize,
      'تعذّر تنفيذ الاستيراد بأمان. لم تُحفظ أي صفوف.',
    );
  }
}
