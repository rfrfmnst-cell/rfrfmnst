import { createClient } from '@supabase/supabase-js';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import {
  detectSupplierDocument,
  isSupplierDocumentStorageKey,
} from '@rafraf/shared/supplier-document';
import { createPrivateBlobAdapter } from '@rafraf/shared/private-blob';
import { del, get, list, put } from '@vercel/blob';
import {
  access,
  constants,
  mkdir,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import bucketPolicy from '../storage/supplier-documents-bucket.json';

export const SUPPLIER_DOCUMENT_BUCKET = bucketPolicy.id;
const LOCAL_ROOT = path.resolve(
  /*turbopackIgnore: true*/
  process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT?.trim() ||
    path.resolve(process.cwd(), '.data', SUPPLIER_DOCUMENT_BUCKET),
);

type StorageProvider =
  'filesystem' | 'local' | 'supabase' | 'r2' | 'vercel-blob';

function storageProvider(): StorageProvider {
  const configured = (
    process.env.SUPPLIER_DOCUMENT_STORAGE_PROVIDER ??
    process.env.STORAGE_PROVIDER
  )
    ?.trim()
    .toLowerCase();
  if (
    configured === 'filesystem' ||
    configured === 'local' ||
    configured === 'supabase' ||
    configured === 'r2' ||
    configured === 'vercel-blob'
  ) {
    if (configured === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error(
        'Local supplier document storage is forbidden in production',
      );
    }
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Supplier document storage provider is not configured');
  }
  return 'local';
}

function vercelBlob() {
  return createPrivateBlobAdapter(
    {
      put: (pathname, bytes, options) =>
        put(pathname, Buffer.from(bytes), options),
      get,
      del,
      list,
    },
    {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: process.env.BLOB_STORE_ID,
    },
  );
}

function supabase() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key)
    throw new Error('Supplier document storage is not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function r2Config() {
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
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function r2() {
  const config = r2Config();
  return {
    bucket: config.bucket,
    client: new S3Client({
      region: 'auto',
      endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    }),
  };
}

function validateFilesystemRoot(): void {
  if (
    storageProvider() === 'filesystem' &&
    (!process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT?.trim() ||
      !path.isAbsolute(process.env.SUPPLIER_DOCUMENT_LOCAL_ROOT.trim()))
  ) {
    throw new Error(
      'Filesystem supplier document storage requires an absolute root',
    );
  }
}

function safeLocalPath(storageKey: string): string {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  validateFilesystemRoot();
  const resolved = path.resolve(
    /*turbopackIgnore: true*/ LOCAL_ROOT,
    ...storageKey.split('/'),
  );
  if (!resolved.startsWith(`${LOCAL_ROOT}${path.sep}`)) {
    throw new Error('Invalid supplier document key');
  }
  return resolved;
}

export async function putPrivateSupplierDocument(
  storageKey: string,
  bytes: Uint8Array,
  contentType: string,
) {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  const detected = detectSupplierDocument(bytes);
  if (!detected || detected.contentType !== contentType) {
    throw new Error('Invalid supplier document');
  }
  const provider = storageProvider();
  if (provider === 'vercel-blob') {
    await vercelBlob().put(storageKey, bytes, contentType);
    return;
  }
  if (provider === 'r2') {
    const { client, bucket } = r2();
    await client.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: storageKey,
        Body: bytes,
        ContentType: contentType,
        ContentLength: bytes.byteLength,
        ContentDisposition: 'attachment',
      }),
    );
    return;
  }
  if (provider === 'supabase') {
    const { error } = await supabase()
      .storage.from(SUPPLIER_DOCUMENT_BUCKET)
      .upload(storageKey, bytes, { contentType, upsert: false });
    if (error) throw error;
    return;
  }
  const filePath = safeLocalPath(storageKey);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes, { flag: 'wx' });
}

export async function getPrivateSupplierDocument(
  storageKey: string,
): Promise<Uint8Array> {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  const provider = storageProvider();
  if (provider === 'vercel-blob') {
    return vercelBlob().get(storageKey);
  }
  if (provider === 'r2') {
    const { client, bucket } = r2();
    const result = await client.send(
      new GetObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    if (!result.Body) throw new Error('Supplier document is empty');
    return new Uint8Array(await result.Body.transformToByteArray());
  }
  if (provider === 'supabase') {
    const { data, error } = await supabase()
      .storage.from(SUPPLIER_DOCUMENT_BUCKET)
      .download(storageKey);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }
  return new Uint8Array(await readFile(safeLocalPath(storageKey)));
}

export async function deletePrivateSupplierDocument(storageKey: string) {
  if (!isSupplierDocumentStorageKey(storageKey)) {
    throw new Error('Invalid supplier document key');
  }
  const provider = storageProvider();
  if (provider === 'vercel-blob') {
    await vercelBlob().delete(storageKey);
    return;
  }
  if (provider === 'r2') {
    const { client, bucket } = r2();
    await client.send(
      new DeleteObjectCommand({ Bucket: bucket, Key: storageKey }),
    );
    return;
  }
  if (provider === 'supabase') {
    const { error } = await supabase()
      .storage.from(SUPPLIER_DOCUMENT_BUCKET)
      .remove([storageKey]);
    if (error) throw error;
    return;
  }
  try {
    await unlink(safeLocalPath(storageKey));
  } catch (error) {
    if (!(
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    )) {
      throw error;
    }
  }
}

export async function privateSupplierDocumentStorageReady(): Promise<boolean> {
  try {
    const provider = storageProvider();
    if (provider === 'local') return true;
    if (provider === 'filesystem') {
      validateFilesystemRoot();
      await access(LOCAL_ROOT, constants.R_OK | constants.W_OK);
      return true;
    }
    if (provider === 'vercel-blob') {
      return vercelBlob().ready('supplier-documents/');
    }
    if (provider === 'r2') {
      const { client, bucket } = r2();
      await client.send(new HeadBucketCommand({ Bucket: bucket }));
      return true;
    }
    if (
      !process.env.SUPABASE_URL?.trim() ||
      !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
    )
      return false;
    const { data, error } = await supabase().storage.getBucket(
      SUPPLIER_DOCUMENT_BUCKET,
    );
    if (error || !data || data.public) return false;
    const actualMimeTypes = [...(data.allowed_mime_types ?? [])].sort();
    const requiredMimeTypes = [...bucketPolicy.allowedMimeTypes].sort();
    return (
      data.file_size_limit === bucketPolicy.fileSizeLimit &&
      JSON.stringify(actualMimeTypes) === JSON.stringify(requiredMimeTypes)
    );
  } catch {
    return false;
  }
}
