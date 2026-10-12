import {
  type CatalogImportIssue,
  type CatalogImportState,
  MAX_RETURNED_ISSUES,
} from './catalog-import.ts';

export function safeCatalogImportClientToken(
  value: FormDataEntryValue | null,
): string | null {
  const token = String(value ?? '').trim();
  return /^[A-Za-z0-9-]{1,80}$/.test(token) ? token : null;
}

export function safeCatalogImportFileName(value: string): string {
  const cleaned = value
    .replace(/\p{Cc}/gu, '')
    .trim()
    .slice(0, 180);
  return cleaned || 'catalog.csv';
}

function stateBase(
  clientToken: string | null,
  fileName: string | null,
  fileSize: number | null,
): Pick<CatalogImportState, 'clientToken' | 'fileName' | 'fileSize'> {
  return { clientToken, fileName, fileSize };
}

function limitedIssues(issues: CatalogImportIssue[]): CatalogImportIssue[] {
  return issues.slice(0, MAX_RETURNED_ISSUES);
}

export function catalogImportValidationState(
  clientToken: string | null,
  fileName: string | null,
  fileSize: number | null,
  totalRows: number,
  errors: CatalogImportIssue[],
  warnings: CatalogImportIssue[] = [],
): CatalogImportState {
  return {
    status: 'validation_error',
    ...stateBase(clientToken, fileName, fileSize),
    message: 'لم يُحفظ أي صف. أصلح الأخطاء ثم أعد رفع الملف.',
    errors: limitedIssues(errors),
    warnings: limitedIssues(warnings),
    errorCount: errors.length,
    warningCount: warnings.length,
    summary: {
      totalRows,
      importedRows: 0,
      flaggedRows: 0,
      batchId: null,
    },
  };
}

export function catalogImportErrorState(
  clientToken: string | null,
  fileName: string | null,
  fileSize: number | null,
  message: string,
): CatalogImportState {
  return {
    status: 'error',
    ...stateBase(clientToken, fileName, fileSize),
    message,
    errors: [],
    warnings: [],
    errorCount: 0,
    warningCount: 0,
    summary: null,
  };
}

export function catalogImportSuccessState(args: {
  clientToken: string | null;
  fileName: string;
  fileSize: number;
  totalRows: number;
  warnings: CatalogImportIssue[];
  batchId: string;
}): CatalogImportState {
  return {
    status: 'success',
    ...stateBase(args.clientToken, args.fileName, args.fileSize),
    message: 'تم استيراد المخزون وتسجيل العملية في سجل التدقيق.',
    errors: [],
    warnings: limitedIssues(args.warnings),
    errorCount: 0,
    warningCount: args.warnings.length,
    summary: {
      totalRows: args.totalRows,
      importedRows: args.totalRows,
      flaggedRows: args.warnings.length,
      batchId: args.batchId,
    },
  };
}
