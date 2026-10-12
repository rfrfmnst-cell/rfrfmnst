import { prisma, SupplierStatus } from '@rafraf/db';
import {
  detectSupplierDocument,
  isSupplierDocumentTypeAllowedForCountry,
  isSupplierDocumentStorageKey,
  normalizeSupplierDocumentType,
  SUPPLIER_DOCUMENT_MAX_BYTES,
} from '@rafraf/shared/supplier-document';
import { requestOriginAllowed } from '@rafraf/shared/public-origin';
import { NextResponse, type NextRequest } from 'next/server';
import {
  deletePrivateSupplierDocument,
  getPrivateSupplierDocument,
  putPrivateSupplierDocument,
} from '../../../lib/supplier-document-storage';
import { persistSupplierDocument } from '../../../lib/supplier-document-persistence';
import { getSessionSupplierId } from '../../../lib/session';

export const dynamic = 'force-dynamic';
const MAX_MULTIPART_BYTES = SUPPLIER_DOCUMENT_MAX_BYTES + 512 * 1024;
const DOCUMENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;
const BLOCKED_STATUSES = new Set<SupplierStatus>([
  SupplierStatus.REJECTED,
  SupplierStatus.SUSPENDED,
]);

export async function POST(request: NextRequest) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (
    !requestOriginAllowed(
      request.headers.get('origin'),
      process.env.NEXT_PUBLIC_SUPPLIER_APP_URL,
      request.url,
    )
  ) {
    return NextResponse.json({ error: 'origin' }, { status: 403 });
  }
  const contentType = request.headers.get('content-type') ?? '';
  const contentLength = Number(request.headers.get('content-length'));
  if (!contentType.toLowerCase().startsWith('multipart/form-data;')) {
    return NextResponse.json(
      { error: 'invalid_content_type' },
      { status: 415 },
    );
  }
  if (!Number.isSafeInteger(contentLength) || contentLength <= 0) {
    return NextResponse.json(
      { error: 'content_length_required' },
      { status: 411 },
    );
  }
  if (contentLength > MAX_MULTIPART_BYTES) {
    return NextResponse.json({ error: 'payload_too_large' }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: 'invalid_document' }, { status: 400 });
  }
  const files = formData.getAll('file');
  const file = files.length === 1 ? files[0] : null;
  const documentType = normalizeSupplierDocumentType(
    formData.get('documentType'),
  );
  if (
    !documentType ||
    !(file instanceof File) ||
    file.size <= 0 ||
    file.size > SUPPLIER_DOCUMENT_MAX_BYTES
  ) {
    return NextResponse.json({ error: 'invalid_document' }, { status: 400 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectSupplierDocument(bytes);
  if (!detected || detected.contentType !== file.type) {
    return NextResponse.json({ error: 'invalid_document' }, { status: 400 });
  }

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, status: true, countryCode: true },
  });
  if (!supplier || BLOCKED_STATUSES.has(supplier.status)) {
    return NextResponse.json(
      { error: 'supplier_unavailable' },
      { status: 403 },
    );
  }
  if (
    !isSupplierDocumentTypeAllowedForCountry(supplier.countryCode, documentType)
  ) {
    return NextResponse.json({ error: 'invalid_document' }, { status: 400 });
  }
  const existingCount = await prisma.supplierDocument.count({
    where: { supplierId, type: documentType },
  });
  if (existingCount >= 3) {
    return NextResponse.json({ error: 'document_limit' }, { status: 409 });
  }

  const result = await persistSupplierDocument(
    {
      supplierId,
      documentType,
      bytes,
      detected,
    },
    {
      prismaClient: prisma,
      putPrivateSupplierDocument,
      deletePrivateSupplierDocument,
    },
  );
  if (result.outcome === 'STORAGE_UNAVAILABLE') {
    return NextResponse.json({ error: 'storage_unavailable' }, { status: 503 });
  }
  if (result.outcome !== 'CREATED') {
    return NextResponse.json(
      {
        error:
          result.outcome === 'DOCUMENT_LIMIT'
            ? 'document_limit'
            : 'persistence_failed',
      },
      {
        status: result.outcome === 'DOCUMENT_LIMIT' ? 409 : 503,
      },
    );
  }

  return NextResponse.json({ document: result.document }, { status: 201 });
}

export async function GET(request: NextRequest) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  const documentId = request.nextUrl.searchParams.get('id') ?? '';
  if (!DOCUMENT_ID_PATTERN.test(documentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const document = await prisma.supplierDocument.findFirst({
    where: { id: documentId, supplierId },
    select: { fileUrl: true },
  });
  if (!document || !isSupplierDocumentStorageKey(document.fileUrl)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const bytes = await getPrivateSupplierDocument(document.fileUrl);
    const detected = detectSupplierDocument(bytes);
    if (!detected) throw new Error('Invalid stored document');
    return new NextResponse(bytes, {
      headers: {
        'content-type': detected.contentType,
        'content-disposition': `attachment; filename="supplier-document.${detected.extension}"`,
        'cache-control': 'private, no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  } catch {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
}
