export const EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;

export const EVIDENCE_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type EvidenceMimeType = (typeof EVIDENCE_MIME_TYPES)[number];
export type EvidenceExtension = 'jpg' | 'png' | 'webp';

export interface DetectedEvidenceImage {
  contentType: EvidenceMimeType;
  extension: EvidenceExtension;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [
  0x00, 0x00, 0x00, 0x00,
  0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
];

function matches(bytes: Uint8Array, offset: number, signature: readonly number[]) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function isJpeg(bytes: Uint8Array) {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

function isPng(bytes: Uint8Array) {
  return (
    bytes.length >= PNG_SIGNATURE.length + PNG_IEND.length &&
    matches(bytes, 0, PNG_SIGNATURE) &&
    matches(bytes, bytes.length - PNG_IEND.length, PNG_IEND)
  );
}

function isWebp(bytes: Uint8Array) {
  if (
    bytes.length < 12 ||
    !matches(bytes, 0, [0x52, 0x49, 0x46, 0x46]) ||
    !matches(bytes, 8, [0x57, 0x45, 0x42, 0x50])
  ) {
    return false;
  }
  const declaredSize =
    bytes[4]! |
    (bytes[5]! << 8) |
    (bytes[6]! << 16) |
    (bytes[7]! << 24);
  return declaredSize >= 4 && declaredSize + 8 === bytes.length;
}

export function detectEvidenceImage(bytes: Uint8Array): DetectedEvidenceImage | null {
  if (bytes.length === 0 || bytes.length > EVIDENCE_MAX_BYTES) return null;
  if (isJpeg(bytes)) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (isPng(bytes)) return { contentType: 'image/png', extension: 'png' };
  if (isWebp(bytes)) return { contentType: 'image/webp', extension: 'webp' };
  return null;
}

export function isEvidenceStorageKey(value: string): boolean {
  return /^[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.(?:jpg|png|webp)$/.test(value);
}
