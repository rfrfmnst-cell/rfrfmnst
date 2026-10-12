import type { PartCondition } from '@rafraf/db';

export const MAX_CATALOG_FILE_BYTES = 768 * 1024;
export const MAX_CATALOG_ROWS = 500;
export const MAX_RETURNED_ISSUES = 80;

export const REQUIRED_CATALOG_HEADERS = [
  'part_number',
  'price',
  'quantity',
] as const;

export const OPTIONAL_CATALOG_HEADERS = [
  'brand',
  'condition',
  'currency',
  'warranty_months',
  'lead_time_days',
  'warehouse',
] as const;

export const CATALOG_HEADERS = [
  ...REQUIRED_CATALOG_HEADERS,
  ...OPTIONAL_CATALOG_HEADERS,
] as const;

export type CatalogHeader = (typeof CATALOG_HEADERS)[number];

export type CatalogCsvRecord = {
  row: number;
  cells: string[];
};

export type ParsedInventoryRow = {
  row: number;
  partNumber: string;
  brand: string | null;
  condition: PartCondition;
  quantity: number;
  price: string;
  currency: string;
  warrantyMonths: number;
  leadTimeDays: number;
  warehouseRef: string | null;
};

export type CatalogImportIssue = {
  row: number | null;
  field: string;
  message: string;
};

export type CatalogImportSummary = {
  totalRows: number;
  importedRows: number;
  flaggedRows: number;
  batchId: string | null;
};

export type CatalogImportState = {
  status: 'idle' | 'validation_error' | 'success' | 'error';
  clientToken: string | null;
  fileName: string | null;
  fileSize: number | null;
  message: string | null;
  errors: CatalogImportIssue[];
  warnings: CatalogImportIssue[];
  errorCount: number;
  warningCount: number;
  summary: CatalogImportSummary | null;
};

export const INITIAL_CATALOG_IMPORT_STATE: CatalogImportState = {
  status: 'idle',
  clientToken: null,
  fileName: null,
  fileSize: null,
  message: null,
  errors: [],
  warnings: [],
  errorCount: 0,
  warningCount: 0,
  summary: null,
};

export type CatalogWarehouseOption = {
  id: string;
  name: string;
  city: string;
  isDefault: boolean;
};
