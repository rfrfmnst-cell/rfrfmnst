import {
  CATALOG_HEADERS,
  type CatalogHeader,
  type CatalogWarehouseOption,
} from "./catalog-import.ts";

export type CatalogTemplateFormat = "csv" | "tsv";

export function buildCatalogTemplate(
  warehouses: CatalogWarehouseOption[],
  format: CatalogTemplateFormat = "csv",
): string {
  const defaultWarehouse = warehouses.find((warehouse) => warehouse.isDefault);
  // Bind examples to the column names so a reordered header cannot shift data.
  const example: Record<CatalogHeader, string> = {
    part_number: "0090915-YZZD2",
    price: "45.50",
    quantity: "12",
    brand: "Toyota",
    condition: "NEW",
    currency: "SAR",
    warranty_months: "12",
    lead_time_days: "2",
    warehouse: defaultWarehouse?.id ?? "",
  };
  const delimiter = format === "tsv" ? "\t" : ",";
  const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
  return `\uFEFF${CATALOG_HEADERS.join(delimiter)}\r\n${CATALOG_HEADERS.map(
    (header) => quote(example[header]),
  ).join(delimiter)}\r\n`;
}
