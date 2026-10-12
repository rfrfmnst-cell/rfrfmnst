export const SUPPLIER_DOCUMENT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * العقد القانوني الوحيد لمستندات اعتماد المورد. يبقى هذا المصدر مشتركاً بين
 * واجهة المورد، مسار الرفع، ومراجعة الإدارة حتى لا يقبل مسار نوعاً لا يظهره آخر.
 */
export const SUPPLIER_DOCUMENT_TYPES = [
  'BUSINESS_REGISTRATION',
  'FREELANCE_CERTIFICATE',
] as const;

/**
 * الصفوف التاريخية لا تعاد تسميتها من دون نقل الملف الخاص المقابل لها. تبقى
 * صالحة للمراجعة فقط، بينما SUPPLIER_DOCUMENT_TYPES هو عقد الرفع الجديد.
 */
export const QUALIFYING_SUPPLIER_DOCUMENT_TYPES = [
  ...SUPPLIER_DOCUMENT_TYPES,
  'COMMERCIAL_REGISTRATION',
  'FREELANCE_WORK_CERTIFICATE',
] as const;

export type SupplierDocumentType = (typeof SUPPLIER_DOCUMENT_TYPES)[number];
export type SupplierDocumentMimeType =
  'application/pdf' | 'image/jpeg' | 'image/png';

export interface DetectedSupplierDocument {
  contentType: SupplierDocumentMimeType;
  extension: 'pdf' | 'jpg' | 'png';
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const PNG_IEND = [
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
];

function matches(
  bytes: Uint8Array,
  offset: number,
  signature: readonly number[],
) {
  return signature.every((value, index) => bytes[offset + index] === value);
}

function isPdf(bytes: Uint8Array): boolean {
  if (bytes.length < 9 || !matches(bytes, 0, [0x25, 0x50, 0x44, 0x46, 0x2d])) {
    return false;
  }
  const tail = bytes.slice(Math.max(0, bytes.length - 1_024));
  return new TextDecoder('latin1').decode(tail).includes('%%EOF');
}

function isJpeg(bytes: Uint8Array): boolean {
  return (
    bytes.length >= 4 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff &&
    bytes[bytes.length - 2] === 0xff &&
    bytes[bytes.length - 1] === 0xd9
  );
}

function isPng(bytes: Uint8Array): boolean {
  return (
    bytes.length >= PNG_SIGNATURE.length + PNG_IEND.length &&
    matches(bytes, 0, PNG_SIGNATURE) &&
    matches(bytes, bytes.length - PNG_IEND.length, PNG_IEND)
  );
}

export function normalizeSupplierDocumentType(
  value: unknown,
): SupplierDocumentType | null {
  return (SUPPLIER_DOCUMENT_TYPES as readonly unknown[]).includes(value)
    ? (value as SupplierDocumentType)
    : null;
}

/**
 * جميع البلدان التي يقبلها عقد المنتج تستطيع تقديم أحد مستندي التسجيل
 * القانونيين. يظل البلد جزءاً صريحاً من القرار حتى يمكن تضييق السياسة حسب
 * البلد لاحقاً دون أن تتباعد واجهة الرفع والمراجعة الإدارية.
 */
export function isSupplierDocumentTypeAllowedForCountry(
  countryCode: unknown,
  value: unknown,
): boolean {
  return (
    typeof countryCode === 'string' &&
    /^[A-Z]{2}$/.test(countryCode) &&
    normalizeSupplierDocumentType(value) !== null
  );
}

export function supplierDocumentTypeLabel(type: string): string {
  return type === 'BUSINESS_REGISTRATION'
    ? 'السجل أو رخصة تسجيل المنشأة'
    : type === 'FREELANCE_CERTIFICATE'
      ? 'وثيقة العمل الحر'
      : type;
}

export function detectSupplierDocument(
  bytes: Uint8Array,
): DetectedSupplierDocument | null {
  if (bytes.length === 0 || bytes.length > SUPPLIER_DOCUMENT_MAX_BYTES) {
    return null;
  }
  if (isPdf(bytes)) {
    return { contentType: 'application/pdf', extension: 'pdf' };
  }
  if (isJpeg(bytes)) return { contentType: 'image/jpeg', extension: 'jpg' };
  if (isPng(bytes)) return { contentType: 'image/png', extension: 'png' };
  return null;
}

export function isSupplierDocumentStorageKey(value: string): boolean {
  // المفاتيح القديمة تقرأ أو تحذف فقط؛ normalizeSupplierDocumentType يمنع رفعها.
  return /^[A-Za-z0-9_-]{8,128}\/(?:BUSINESS_REGISTRATION|FREELANCE_CERTIFICATE|COMMERCIAL_REGISTRATION|FREELANCE_WORK_CERTIFICATE)\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(?:pdf|jpg|png)$/i.test(
    value,
  );
}
