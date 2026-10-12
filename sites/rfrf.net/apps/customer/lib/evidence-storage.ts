import { createClient } from '@supabase/supabase-js';
import {
  detectEvidenceImage,
  isEvidenceStorageKey,
} from '@rafraf/shared/evidence-image';
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
import bucketPolicy from '../storage/rfq-evidence-bucket.json';

export const EVIDENCE_BUCKET = bucketPolicy.id;
const LOCAL_ROOT = path.resolve(
  /*turbopackIgnore: true*/
  process.env.EVIDENCE_LOCAL_ROOT?.trim() ||
    path.resolve(process.cwd(), '.data', EVIDENCE_BUCKET),
);

type StorageProvider = 'filesystem' | 'local' | 'supabase' | 'vercel-blob';

function storageProvider(): StorageProvider {
  const configured = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (
    configured === 'filesystem' ||
    configured === 'local' ||
    configured === 'supabase' ||
    configured === 'vercel-blob'
  ) {
    if (configured === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error('Local evidence storage is forbidden in production');
    }
    return configured;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Evidence storage provider is not configured');
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
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase storage is not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function validateFilesystemRoot(): void {
  if (
    storageProvider() === 'filesystem' &&
    (!process.env.EVIDENCE_LOCAL_ROOT?.trim() ||
      !path.isAbsolute(process.env.EVIDENCE_LOCAL_ROOT.trim()))
  ) {
    throw new Error('Filesystem evidence storage requires an absolute root');
  }
}

function safeLocalPath(key: string) {
  if (!isEvidenceStorageKey(key)) throw new Error('Invalid storage key');
  validateFilesystemRoot();
  const resolved = path.resolve(
    /*turbopackIgnore: true*/ LOCAL_ROOT,
    ...key.split('/'),
  );
  if (!resolved.startsWith(`${LOCAL_ROOT}${path.sep}`))
    throw new Error('Invalid storage key');
  return resolved;
}

export async function putPrivateEvidence(
  key: string,
  bytes: Uint8Array,
  contentType: string,
) {
  if (!isEvidenceStorageKey(key)) throw new Error('Invalid storage key');
  const detected = detectEvidenceImage(bytes);
  if (!detected || detected.contentType !== contentType) {
    throw new Error('Invalid evidence image');
  }
  const provider = storageProvider();
  if (provider === 'vercel-blob') {
    await vercelBlob().put(key, bytes, contentType);
    return;
  }
  if (provider === 'supabase') {
    const { error } = await supabase()
      .storage.from(EVIDENCE_BUCKET)
      .upload(key, bytes, { contentType, upsert: false });
    if (error) throw error;
    return;
  }
  const filePath = safeLocalPath(key);
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, bytes);
}

export async function getPrivateEvidence(key: string): Promise<Uint8Array> {
  if (!isEvidenceStorageKey(key)) throw new Error('Invalid storage key');
  const provider = storageProvider();
  if (provider === 'vercel-blob') return vercelBlob().get(key);
  if (provider === 'supabase') {
    const { data, error } = await supabase()
      .storage.from(EVIDENCE_BUCKET)
      .download(key);
    if (error) throw error;
    return new Uint8Array(await data.arrayBuffer());
  }
  return new Uint8Array(await readFile(safeLocalPath(key)));
}

export async function deletePrivateEvidence(key: string): Promise<void> {
  if (!isEvidenceStorageKey(key)) throw new Error('Invalid storage key');
  const provider = storageProvider();
  if (provider === 'vercel-blob') {
    await vercelBlob().delete(key);
    return;
  }
  if (provider === 'supabase') {
    const { error } = await supabase()
      .storage.from(EVIDENCE_BUCKET)
      .remove([key]);
    if (error) throw error;
    return;
  }
  try {
    await unlink(safeLocalPath(key));
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

export async function privateEvidenceStorageReady(): Promise<boolean> {
  const provider = storageProvider();
  if (provider === 'local') return true;
  if (provider === 'filesystem') {
    try {
      validateFilesystemRoot();
      await access(LOCAL_ROOT, constants.R_OK | constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (provider === 'vercel-blob') {
    return vercelBlob().ready('rfq-evidence/');
  }
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY)
    return false;
  try {
    const { data, error } = await supabase().storage.getBucket(EVIDENCE_BUCKET);
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
