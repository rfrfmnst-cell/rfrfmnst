import { prisma } from '@rafraf/db';
import {
  detectSupplierDocument,
  isSupplierDocumentStorageKey,
} from '@rafraf/shared/supplier-document';
import { NextResponse } from 'next/server';
import { readPrivateSupplierDocument } from '../../../../lib/private-supplier-document';
import { requireAdminPermission } from '../../../../lib/require-admin-session';

export const dynamic = 'force-dynamic';
const ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ documentId: string }> },
) {
  await requireAdminPermission('SUPPLIER_WRITE');
  const { documentId } = await context.params;
  if (!ID_PATTERN.test(documentId)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  const document = await prisma.supplierDocument.findUnique({
    where: { id: documentId },
    select: { fileUrl: true },
  });
  if (!document || !isSupplierDocumentStorageKey(document.fileUrl)) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  try {
    const bytes = await readPrivateSupplierDocument(document.fileUrl);
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
