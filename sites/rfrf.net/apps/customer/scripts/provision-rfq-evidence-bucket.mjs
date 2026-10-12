import { readFile } from 'node:fs/promises';
import { createClient } from '@supabase/supabase-js';

const policy = JSON.parse(
  await readFile(
    new URL('../storage/rfq-evidence-bucket.json', import.meta.url),
    'utf8',
  ),
);

const url = process.env.SUPABASE_URL?.trim();
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
if (!url || !serviceRoleKey) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required');
}

const supabase = createClient(url, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const desired = {
  public: false,
  fileSizeLimit: policy.fileSizeLimit,
  allowedMimeTypes: policy.allowedMimeTypes,
};

const existing = await supabase.storage.getBucket(policy.id);
if (existing.error && existing.error.status !== 404) throw existing.error;

if (!existing.data) {
  const created = await supabase.storage.createBucket(policy.id, desired);
  if (created.error && created.error.status !== 409) throw created.error;
}

// Convergent on every run, including when another provisioner won a create race.
const updated = await supabase.storage.updateBucket(policy.id, desired);
if (updated.error) throw updated.error;

const verified = await supabase.storage.getBucket(policy.id);
if (verified.error || !verified.data) {
  throw verified.error ?? new Error('Bucket verification failed');
}

const mimeTypes = [...(verified.data.allowed_mime_types ?? [])].sort();
const expectedMimeTypes = [...policy.allowedMimeTypes].sort();
const valid =
  verified.data.public === false &&
  verified.data.file_size_limit === policy.fileSizeLimit &&
  JSON.stringify(mimeTypes) === JSON.stringify(expectedMimeTypes);

if (!valid) {
  throw new Error('rfq-evidence bucket policy does not match the required private policy');
}
console.log(`Storage bucket ${policy.id} is private and policy-compliant.`);
