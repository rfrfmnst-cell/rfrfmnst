import { createClient } from '@supabase/supabase-js';
import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { isSupplierDocumentStorageKey } from '@rafraf/shared/supplier-document';
import { createPrivateBlobAdapter } from '@rafraf/shared/private-blob';
import { get } from '@vercel/blob';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const BUCKET = 'supplier-documents';

function provider():
  'filesystem' | 'local' | 'supabase' | 'r2' | 'vercel-blob' {
  const value = (
    process.env.SUPPLIER_DOCUMENT_STORAGE_PROVIDER ??
    process.env.STORAGE_PROVIDER
  )
    ?.trim()
    .toLowerCase();
  if (
    value === 'filesystem' ||
    value === 'local' ||
    value === 'supabase' ||
    value === 'r2' ||
    value === 'vercel-blob'
  ) {
    if (value === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error(
        'Local supplier document storage is forbidden in production',
      );
    }
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Supplier document storage provider is not configured');
  }
  return 'local';
}

function vercelBlob() {
  return createPrivateBlobAdapter(
    { get },
    {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: process.env.BLOB_STORE_ID,
    },
  );
}

function client() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key)
    throw new Error('Supplier document storage is not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function r2() {
  const accountId = process.env.R2_ACCOUNT_ID?.trim() ?? '';
  const accessKeyId = process.env.R2_ACCESS_KEY_ID?.trim() ?? '';
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY?.trim() ?? '';
  const bucket = process.env.R2_SUPPLIER_DOCUMENT_BUCKET?.trim() ?? '';
  if (!/^[a-f0-9]{32}$/i.test(accountId))
    throw new Error('Invalid R2 account id');
  if (!accessKeyId || /\s/.test(accessKeyId))
    throw new Error('Invalid R2 access key id');
  if (!secretAccessKey || /\s/.test(secretAccessKey))
    throw new Error('Invalid R2 secret access key');
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) {
    throw new Error('Invalid R2 supplier document bucket');
  }
  return {
    bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId, secretAccessKey },
    }),
  };
}

function safeLocalPath(storageKey: string): string {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  if (
    provider() === 'filesystem' &&
    (!process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT?.trim() ||
      !path.isAbsolute(process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT.trim()))
  ) {
    throw new Error(
      'Filesystem supplier document storage requires an absolute root',
    );
  }
  const root = path.resolve(
    /*turbopackIgnore: true*/
    process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT?.trim() ||
      path.resolve(process.cwd(), '..', 'supplier', '.data', BUCKET),
  );
  const resolved = path.resolve(
    /*turbopackIgnore: true*/ root,
    ...storageKey.split('/'),
  );
  if (!resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error('Invalid supplier document key');
  }
  return resolved;
}

export async function readPrivateSupplierDocument(
  storageKey: string,
): Promise<Uint8Array> {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  const storageProvider = provider();
  if (storageProvider === 'local' || storageProvider === 'filesystem') {
    return new Uint8Array(await readFile(safeLocalPath(storageKey)));
  }
  if (storageProvider === 'vercel-blob') {
    return vercelBlob().get(storageKey);
  }
  if (storageProvider === 'r2') {
    const { client: r2Client, bucket } = r2();
    const result = await r2Client.send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!result.Body) throw new Error('Supplier document is empty');
    return new Uint8Array(await result.Body.transformToByteArray());
  }
  const { data, error } = await client()
    .storage.from(BUCKET)
    .download(storageKey);
  if (error) throw error;
  return new Uint8Array(await data.arrayBuffer());
}
