import { randomUUID } from 'node:crypto';
import { ActorType, prisma, SupplierStatus } from '@rafraf/db';
import {
  isSupplierDocumentTypeAllowedForCountry,
  type DetectedSupplierDocument,
  type SupplierDocumentType,
} from '@rafraf/shared/supplier-document';

const BLOCKED_STATUSES = new Set<SupplierStatus>([
  SupplierStatus.REJECTED,
  SupplierStatus.SUSPENDED,
]);

export interface SupplierDocumentPersistenceInput {
  supplierId: string;
  documentType: SupplierDocumentType;
  bytes: Uint8Array;
  detected: DetectedSupplierDocument;
}

export interface SupplierDocumentPersistenceDependencies {
  prismaClient: Pick<typeof prisma, '$transaction'>;
  putPrivateSupplierDocument: (
    storageKey: string,
    bytes: Uint8Array,
    contentType: string,
  ) => Promise<void>;
  deletePrivateSupplierDocument: (storageKey: string) => Promise<void>;
}

export type SupplierDocumentPersistenceResult =
  | { outcome: 'CREATED'; document: unknown }
  | { outcome: 'DOCUMENT_LIMIT' }
  | { outcome: 'PERSISTENCE_FAILED' }
  | { outcome: 'STORAGE_UNAVAILABLE' };

async function cleanup(
  storageKey: string,
  deleteDocument: SupplierDocumentPersistenceDependencies['deletePrivateSupplierDocument'],
) {
  try {
    await deleteDocument(storageKey);
  } catch {
    // Persistence still fails closed even if best-effort object cleanup fails.
  }
}

/**
 * تكتب الكائن الخاص أولاً ثم تربطه داخل معاملة. فشل أي كتابة قاعدة بيانات
 * يعيد حذف الكائن كي لا يبقى ملف يتيم خارج عقد الوصول الخاص.
 */
export async function persistSupplierDocument(
  input: SupplierDocumentPersistenceInput,
  dependencies: SupplierDocumentPersistenceDependencies,
): Promise<SupplierDocumentPersistenceResult> {
  const {
    prismaClient,
    putPrivateSupplierDocument,
    deletePrivateSupplierDocument,
  } = dependencies;
  const storageKey = `${input.supplierId}/${input.documentType}/${randomUUID()}.${input.detected.extension}`;

  try {
    await putPrivateSupplierDocument(
      storageKey,
      input.bytes,
      input.detected.contentType,
    );
  } catch {
    return { outcome: 'STORAGE_UNAVAILABLE' };
  }

  try {
    const document = await prismaClient.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`supplier-document:${input.supplierId}`}))`;
      const latest = await tx.supplier.findUnique({
        where: { id: input.supplierId },
        select: { status: true, countryCode: true },
      });
      if (!latest || BLOCKED_STATUSES.has(latest.status)) {
        throw new Error('SUPPLIER_UNAVAILABLE');
      }
      if (
        !isSupplierDocumentTypeAllowedForCountry(
          latest.countryCode,
          input.documentType,
        )
      ) {
        throw new Error('INVALID_DOCUMENT_TYPE');
      }
      const latestCount = await tx.supplierDocument.count({
        where: { supplierId: input.supplierId, type: input.documentType },
      });
      if (latestCount >= 3) throw new Error('DOCUMENT_LIMIT');
      const created = await tx.supplierDocument.create({
        data: {
          supplierId: input.supplierId,
          type: input.documentType,
          fileUrl: storageKey,
          status: 'PENDING',
        },
        select: { id: true, type: true, status: true, createdAt: true },
      });
      await tx.auditLog.create({
        data: {
          actorId: input.supplierId,
          actorType: ActorType.SUPPLIER,
          action: 'supplier.document.uploaded',
          entityType: 'supplier_document',
          entityId: created.id,
          after: {
            type: input.documentType,
            contentType: input.detected.contentType,
            sizeBytes: input.bytes.length,
            status: 'PENDING',
          },
        },
      });
      return created;
    });
    return { outcome: 'CREATED', document };
  } catch (error) {
    await cleanup(storageKey, deletePrivateSupplierDocument);
    return {
      outcome:
        error instanceof Error && error.message === 'DOCUMENT_LIMIT'
          ? 'DOCUMENT_LIMIT'
          : 'PERSISTENCE_FAILED',
    };
  }
}
