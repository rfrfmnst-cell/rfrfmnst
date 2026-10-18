import type { PartCondition } from "@rafraf/db";
import type {
  CatalogCsvRecord,
  CatalogHeader,
  CatalogImportIssue,
  ParsedInventoryRow,
} from "./catalog-import.ts";

const SUPPORTED_CURRENCIES = new Set(["SAR", "USD", "AED", "EUR"]);
const CONDITION_BY_VALUE: Record<string, PartCondition> = {
  NEW: "NEW",
  USED: "USED",
  REFURBISHED: "REFURBISHED",
  جديد: "NEW",
  جديدة: "NEW",
  مستعمل: "USED",
  مستعملة: "USED",
  مجدد: "REFURBISHED",
  مجددة: "REFURBISHED",
};

function cellFor(
  record: CatalogCsvRecord,
  indexByHeader: Map<CatalogHeader, number>,
  header: CatalogHeader,
): string {
  const index = indexByHeader.get(header);
  return index == null ? "" : (record.cells[index] ?? "").trim();
}

function hasUnsafeText(value: string): boolean {
  return /\p{Cc}/u.test(value) || /^[=+@]/.test(value);
}

function parseInteger(value: string, min: number, max: number): number | null {
  if (!/^\d+$/.test(value)) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed >= min && parsed <= max
    ? parsed
    : null;
}

export function parseCatalogRows(
  records: CatalogCsvRecord[],
  headers: CatalogHeader[],
  indexByHeader: Map<CatalogHeader, number>,
): { rows: ParsedInventoryRow[]; errors: CatalogImportIssue[] } {
  const rows: ParsedInventoryRow[] = [];
  const errors: CatalogImportIssue[] = [];

  for (const record of records) {
    if (record.cells.every((value) => value.trim() === "")) continue;
    if (record.cells.length !== headers.length) {
      errors.push({
        row: record.row,
        field: "row",
        message: `عدد الأعمدة ${record.cells.length} ولا يطابق عدد العناوين ${headers.length}.`,
      });
      continue;
    }

    const rowErrors: CatalogImportIssue[] = [];
    const partNumber = cellFor(record, indexByHeader, "part_number")
      .replace(/\s+/g, " ")
      .toUpperCase();
    const brandValue = cellFor(record, indexByHeader, "brand");
    const conditionValue = (
      cellFor(record, indexByHeader, "condition") || "NEW"
    ).toUpperCase();
    const quantityValue = cellFor(record, indexByHeader, "quantity");
    const priceValue = cellFor(record, indexByHeader, "price");
    const currency = (
      cellFor(record, indexByHeader, "currency") || "SAR"
    ).toUpperCase();
    const warrantyValue =
      cellFor(record, indexByHeader, "warranty_months") || "0";
    const leadTimeValue =
      cellFor(record, indexByHeader, "lead_time_days") || "0";
    const warehouseValue = cellFor(record, indexByHeader, "warehouse");

    if (
      partNumber.length < 2 ||
      partNumber.length > 80 ||
      !/^[A-Z0-9][A-Z0-9._/\- ]+$/.test(partNumber)
    ) {
      rowErrors.push({
        row: record.row,
        field: "part_number",
        message:
          "رقم القطعة مطلوب (2–80) ويقبل الأحرف الإنجليزية والأرقام و . _ / - فقط.",
      });
    }
    if (
      brandValue.length > 80 ||
      (brandValue.length > 0 && hasUnsafeText(brandValue))
    ) {
      rowErrors.push({
        row: record.row,
        field: "brand",
        message: "العلامة التجارية غير صالحة أو تتجاوز 80 حرفًا.",
      });
    }

    const condition = CONDITION_BY_VALUE[conditionValue];
    if (!condition) {
      rowErrors.push({
        row: record.row,
        field: "condition",
        message: "القيمة يجب أن تكون NEW أو USED أو REFURBISHED.",
      });
    }
    const quantity = parseInteger(quantityValue, 0, 1_000_000);
    if (quantity == null) {
      rowErrors.push({
        row: record.row,
        field: "quantity",
        message: "الكمية يجب أن تكون عددًا صحيحًا بين 0 و1,000,000.",
      });
    }
    if (
      !/^\d{1,9}(?:\.\d{1,2})?$/.test(priceValue) ||
      Number(priceValue) <= 0
    ) {
      rowErrors.push({
        row: record.row,
        field: "price",
        message: "السعر يجب أن يكون أكبر من صفر وبدقتين عشريتين كحد أقصى.",
      });
    }
    if (!SUPPORTED_CURRENCIES.has(currency)) {
      rowErrors.push({
        row: record.row,
        field: "currency",
        message: "العملة المدعومة: SAR أو USD أو AED أو EUR.",
      });
    }

    const warrantyMonths = parseInteger(warrantyValue, 0, 120);
    if (warrantyMonths == null) {
      rowErrors.push({
        row: record.row,
        field: "warranty_months",
        message: "الضمان يجب أن يكون عددًا صحيحًا بين 0 و120 شهرًا.",
      });
    }
    const leadTimeDays = parseInteger(leadTimeValue, 0, 365);
    if (leadTimeDays == null) {
      rowErrors.push({
        row: record.row,
        field: "lead_time_days",
        message: "مدة التوريد يجب أن تكون عددًا صحيحًا بين 0 و365 يومًا.",
      });
    }
    if (
      warehouseValue.length > 100 ||
      (warehouseValue.length > 0 && hasUnsafeText(warehouseValue))
    ) {
      rowErrors.push({
        row: record.row,
        field: "warehouse",
        message: "مرجع المستودع غير صالح أو يتجاوز 100 حرف.",
      });
    }
    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }
    if (
      !condition ||
      quantity == null ||
      warrantyMonths == null ||
      leadTimeDays == null
    ) {
      continue;
    }

    rows.push({
      row: record.row,
      partNumber,
      brand: brandValue || null,
      condition,
      quantity,
      price: priceValue,
      currency,
      warrantyMonths,
      leadTimeDays,
      warehouseRef: warehouseValue || null,
    });
  }
  return { rows, errors };
}
