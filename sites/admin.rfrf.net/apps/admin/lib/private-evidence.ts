import { createClient } from '@supabase/supabase-js';
import { isEvidenceStorageKey } from '@rafraf/shared/evidence-image';
import { createPrivateBlobAdapter } from '@rafraf/shared/private-blob';
import { get, list } from '@vercel/blob';
import { access, constants, readFile } from 'node:fs/promises';
import path from 'node:path';

const EVIDENCE_BUCKET = 'rfq-evidence';
const SIGNED_URL_SECONDS = 60;
const EVIDENCE_FILE_SIZE_LIMIT = 5 * 1024 * 1024;
const EVIDENCE_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

type StorageProvider = 'filesystem' | 'local' | 'supabase' | 'vercel-blob';

function provider(): StorageProvider {
  const value = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (
    value === 'filesystem' ||
    value === 'local' ||
    value === 'supabase' ||
    value === 'vercel-blob'
  ) {
    if (value === 'local' && process.env.NODE_ENV === 'production') {
      throw new Error('Local evidence storage is forbidden in production');
    }
    return value;
  }
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Private evidence storage provider is not configured');
  }
  return 'local';
}

function vercelBlob() {
  return createPrivateBlobAdapter(
    { get, list },
    {
      token: process.env.BLOB_READ_WRITE_TOKEN,
      oidcToken: process.env.VERCEL_OIDC_TOKEN,
      storeId: process.env.BLOB_STORE_ID,
    },
  );
}

function storageClient() {
  const url = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key)
    throw new Error('Private evidence storage is not configured');
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function localStorageRoot(): string {
  const configured = process.env.EVIDENCE_LOCAL_ROOT?.trim();
  if (
    provider() === 'filesystem' &&
    (!configured || !path.isAbsolute(configured))
  ) {
    throw new Error('Filesystem evidence storage requires an absolute root');
  }
  return configured
    ? path.resolve(configured)
    : path.resolve(process.cwd(), '..', 'customer', '.data', EVIDENCE_BUCKET);
}

function safeLocalPath(storageKey: string): string {
  if (!isEvidenceStorageKey(storageKey)) throw new Error('Invalid storage key');
  const root = localStorageRoot();
  const resolved = path.resolve(root, ...storageKey.split('/'));
  if (!resolved.startsWith(`${root}${path.sep}`))
    throw new Error('Invalid storage key');
  return resolved;
}

export async function resolvePrivateEvidence(
  storageKey: string,
): Promise<
  { kind: 'signed-url'; url: string } | { kind: 'bytes'; bytes: Uint8Array }
> {
  if (!isEvidenceStorageKey(storageKey)) throw new Error('Invalid storage key');
  const storageProvider = provider();
  if (storageProvider === 'local' || storageProvider === 'filesystem') {
    return {
      kind: 'bytes',
      bytes: new Uint8Array(await readFile(safeLocalPath(storageKey))),
    };
  }

  if (storageProvider === 'vercel-blob') {
    return { kind: 'bytes', bytes: await vercelBlob().get(storageKey) };
  }

  const { data, error } = await storageClient()
    .storage.from(EVIDENCE_BUCKET)
    .createSignedUrl(storageKey, SIGNED_URL_SECONDS);
  if (error) throw error;
  return { kind: 'signed-url', url: data.signedUrl };
}

export async function privateEvidenceStorageReady(): Promise<boolean> {
  const storageProvider = provider();
  if (storageProvider === 'local') return true;
  if (storageProvider === 'filesystem') {
    try {
      await access(localStorageRoot(), constants.R_OK);
      return true;
    } catch {
      return false;
    }
  }
  if (storageProvider === 'vercel-blob') {
    return vercelBlob().ready('rfq-evidence/');
  }
  if (
    !process.env.SUPABASE_URL?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    return false;
  }

  try {
    const { data, error } =
      await storageClient().storage.getBucket(EVIDENCE_BUCKET);
    if (error || !data || data.public) return false;

    const actualMimeTypes = [...(data.allowed_mime_types ?? [])].sort();
    const requiredMimeTypes = [...EVIDENCE_ALLOWED_MIME_TYPES].sort();
    return (
      data.file_size_limit === EVIDENCE_FILE_SIZE_LIMIT &&
      JSON.stringify(actualMimeTypes) === JSON.stringify(requiredMimeTypes)
    );
  } catch {
    return false;
  }
}
