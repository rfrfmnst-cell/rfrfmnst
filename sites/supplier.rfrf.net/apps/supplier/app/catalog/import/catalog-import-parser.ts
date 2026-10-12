import {
  CATALOG_HEADERS,
  type CatalogCsvRecord,
  type CatalogHeader,
  type CatalogImportIssue,
  type CatalogImportState,
  type ParsedInventoryRow,
  REQUIRED_CATALOG_HEADERS,
} from './catalog-import.ts';
import {
  catalogImportValidationState,
  safeCatalogImportFileName,
} from './catalog-import-state.ts';
import { parseCatalogRows } from './catalog-import-row-parser.ts';

const ALLOWED_MIME_TYPES = new Set([
  '',
  'text/csv',
  'text/plain',
  'application/csv',
  'application/vnd.ms-excel',
]);

export type ParsedCatalogUpload =
  | {
      ok: true;
      bytes: Uint8Array;
      fileName: string;
      fileSize: number;
      headers: CatalogHeader[];
      rows: ParsedInventoryRow[];
    }
  | { ok: false; state: CatalogImportState };

export function parseCatalogCsv(
  input: string,
): { records: CatalogCsvRecord[] } | { error: string } {
  const records: CatalogCsvRecord[] = [];
  let cells: string[] = [];
  let cell = '';
  let inQuotes = false;
  let justClosedQuote = false;
  let recordNumber = 1;

  const finishRecord = () => {
    cells.push(cell);
    records.push({ row: recordNumber, cells });
    recordNumber += 1;
    cells = [];
    cell = '';
    justClosedQuote = false;
  };

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (inQuotes) {
      if (char === '"') {
        if (input[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = false;
          justClosedQuote = true;
        }
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      if (cell.length > 0 || justClosedQuote) {
        return { error: `علامة اقتباس غير صالحة قرب السجل ${recordNumber}.` };
      }
      inQuotes = true;
      continue;
    }
    if (char === ',') {
      cells.push(cell);
      cell = '';
      justClosedQuote = false;
      continue;
    }
    if (char === '\n' || char === '\r') {
      if (char === '\r' && input[index + 1] === '\n') index += 1;
      finishRecord();
      continue;
    }
    if (justClosedQuote) {
      return {
        error: `يوجد نص بعد إغلاق حقل مقتبس قرب السجل ${recordNumber}.`,
      };
    }
    cell += char;
  }

  if (inQuotes) return { error: 'يوجد حقل مقتبس لم يُغلق في نهاية الملف.' };
  if (cell.length > 0 || cells.length > 0) finishRecord();
  while (
    records.length > 0 &&
    records.at(-1)?.cells.every((value) => value.trim() === '')
  ) {
    records.pop();
  }
  return { records };
}

function normalizeHeader(value: string): string {
  return value
    .replace(/^\uFEFF/, '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
}

function isCatalogHeader(value: string): value is CatalogHeader {
  return (CATALOG_HEADERS as readonly string[]).includes(value);
}

function parseHeaders(
  record: CatalogCsvRecord,
):
  | { headers: CatalogHeader[]; indexByHeader: Map<CatalogHeader, number> }
  | { errors: CatalogImportIssue[] } {
  const errors: CatalogImportIssue[] = [];
  const headers: CatalogHeader[] = [];
  const indexByHeader = new Map<CatalogHeader, number>();

  record.cells.forEach((rawHeader, index) => {
    const normalized = normalizeHeader(rawHeader);
    if (!isCatalogHeader(normalized)) {
      errors.push({
        row: 1,
        field: rawHeader.trim() || `column_${index + 1}`,
        message: `عنوان غير معروف. العناوين المسموحة: ${CATALOG_HEADERS.join(', ')}.`,
      });
      return;
    }
    if (indexByHeader.has(normalized)) {
      errors.push({
        row: 1,
        field: normalized,
        message: 'عنوان مكرر في الصف الأول.',
      });
      return;
    }
    headers.push(normalized);
    indexByHeader.set(normalized, index);
  });

  for (const required of REQUIRED_CATALOG_HEADERS) {
    if (!indexByHeader.has(required)) {
      errors.push({
        row: 1,
        field: required,
        message: 'عنوان إلزامي مفقود.',
      });
    }
  }
  return errors.length > 0 ? { errors } : { headers, indexByHeader };
}

function invalidUpload(
  clientToken: string | null,
  fileName: string | null,
  fileSize: number | null,
  totalRows: number,
  errors: CatalogImportIssue[],
): ParsedCatalogUpload {
  return {
    ok: false,
    state: catalogImportValidationState(
      clientToken,
      fileName,
      fileSize,
      totalRows,
      errors,
    ),
  };
}

export async function parseCatalogUpload(
  file: File | null,
  clientToken: string | null,
  limits: { maxFileBytes: number; maxRows: number },
): Promise<ParsedCatalogUpload> {
  const fileName = file ? safeCatalogImportFileName(file.name) : null;
  const fileSize = file?.size ?? null;
  if (!file || file.size === 0) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'file', message: 'اختر ملف CSV غير فارغ.' },
    ]);
  }
  if (file.size > limits.maxFileBytes) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      {
        row: null,
        field: 'file',
        message: `حجم الملف يتجاوز ${Math.floor(limits.maxFileBytes / 1024)} كيلوبايت.`,
      },
    ]);
  }
  if (
    !file.name.toLowerCase().endsWith('.csv') ||
    !ALLOWED_MIME_TYPES.has(file.type.toLowerCase())
  ) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'file', message: 'يُقبل ملف CSV فقط.' },
    ]);
  }

  let bytes: Uint8Array;
  let text: string;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      {
        row: null,
        field: 'file',
        message: 'تعذّرت قراءة الملف بترميز UTF-8.',
      },
    ]);
  }
  if (text.includes('\u0000')) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      {
        row: null,
        field: 'file',
        message: 'يحتوي الملف على بيانات ثنائية غير صالحة.',
      },
    ]);
  }

  const parsedCsv = parseCatalogCsv(text);
  if ('error' in parsedCsv) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'csv', message: parsedCsv.error },
    ]);
  }
  if (parsedCsv.records.length === 0) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'file', message: 'الملف فارغ.' },
    ]);
  }

  const headerRecord = parsedCsv.records[0];
  if (!headerRecord) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'file', message: 'الملف فارغ.' },
    ]);
  }
  const parsedHeaders = parseHeaders(headerRecord);
  if ('errors' in parsedHeaders) {
    return invalidUpload(
      clientToken,
      fileName,
      fileSize,
      Math.max(0, parsedCsv.records.length - 1),
      parsedHeaders.errors,
    );
  }

  const dataRecords = parsedCsv.records
    .slice(1)
    .filter((record) => record.cells.some((value) => value.trim() !== ''));
  if (dataRecords.length === 0) {
    return invalidUpload(clientToken, fileName, fileSize, 0, [
      { row: null, field: 'file', message: 'لا توجد صفوف مخزون بعد العناوين.' },
    ]);
  }
  if (dataRecords.length > limits.maxRows) {
    return invalidUpload(clientToken, fileName, fileSize, dataRecords.length, [
      {
        row: null,
        field: 'rows',
        message: `الملف يحتوي ${dataRecords.length} صفًا؛ الحد ${limits.maxRows}.`,
      },
    ]);
  }

  const parsedRows = parseCatalogRows(
    dataRecords,
    parsedHeaders.headers,
    parsedHeaders.indexByHeader,
  );
  if (parsedRows.errors.length > 0) {
    return invalidUpload(
      clientToken,
      fileName,
      fileSize,
      dataRecords.length,
      parsedRows.errors,
    );
  }
  return {
    ok: true,
    bytes,
    fileName: safeCatalogImportFileName(file.name),
    fileSize: file.size,
    headers: parsedHeaders.headers,
    rows: parsedRows.rows,
  };
}
