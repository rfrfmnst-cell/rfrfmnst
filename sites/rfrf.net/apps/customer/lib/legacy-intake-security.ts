const DATA_URI_PATTERN = /data:[^,\r\n]{0,256},/i;

/** Legacy intake must never parse or persist inline file contents. */
export function legacyEvidencePayloadHasDataUri(raw: string): boolean {
  return DATA_URI_PATTERN.test(raw);
}

export const LEGACY_EVIDENCE_UPLOAD_ERROR =
  'لحماية صورك لا نقبل الملفات المضمّنة في هذا النموذج. افتح /chat وارفع الصور عبر الرفع الآمن.';
