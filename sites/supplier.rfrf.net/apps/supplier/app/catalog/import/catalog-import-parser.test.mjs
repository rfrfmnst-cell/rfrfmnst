import assert from "node:assert/strict";
import test from "node:test";
import {
  parseCatalogCsv,
  parseCatalogUpload,
} from "./catalog-import-parser.ts";
import { buildCatalogTemplate } from "./catalog-import-template.ts";

const limits = { maxFileBytes: 768 * 1024, maxRows: 500 };
const parse = (
  text,
  name = "parts.csv",
  type = "text/csv",
  customLimits = limits,
) =>
  parseCatalogUpload(
    new File([text], name, { type }),
    "test-selection",
    customLimits,
  );

for (const format of ["csv", "tsv"]) {
  test(`downloaded ${format.toUpperCase()} template round-trips with correctly aligned values`, async () => {
    const template = buildCatalogTemplate(
      [
        {
          id: "warehouse-1",
          name: "المستودع الرئيسي",
          city: "الرياض",
          isDefault: true,
        },
      ],
      format,
    );
    const result = await parse(
      template,
      `parts.${format}`,
      format === "tsv" ? "text/tab-separated-values" : "text/csv",
    );
    assert.equal(result.ok, true);
    assert.deepEqual(result.rows[0], {
      row: 2,
      partNumber: "0090915-YZZD2",
      price: "45.50",
      quantity: 12,
      brand: "Toyota",
      condition: "NEW",
      currency: "SAR",
      warrantyMonths: 12,
      leadTimeDays: 2,
      warehouseRef: "warehouse-1",
    });
  });
}

test("Arabic headers and semicolon exports preserve leading zeros and quoted separators", async () => {
  const result = await parse(
    '\uFEFFرقم القطعة;السعر;الكمية;الماركة;الحالة\r\n000123;99.00;2;"شركة; قطع";جديد\r\n',
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].partNumber, "000123");
  assert.equal(result.rows[0].brand, "شركة; قطع");
  assert.equal(result.rows[0].condition, "NEW");
});

test("tab-separated TXT and SKU/qty/unit-price headings are supported", async () => {
  const result = await parse(
    "SKU\tunit price\tqty\n00123-AB\t12.34\t5",
    "parts.txt",
    "text/plain",
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].partNumber, "00123-AB");
  assert.equal(result.rows[0].quantity, 5);
});

test("Excel separator directive retains source record numbers", async () => {
  const result = await parse("sep=;\r\nOEM;price;quantity\r\n000123;10;1");
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].row, 3);
});

test("duplicate aliases reject ambiguous SKU and OEM rather than overwriting either field", async () => {
  const result = await parse("SKU,OEM,price,quantity\n00123,00456,10,1");
  assert.equal(result.ok, false);
  assert.ok(
    result.state.errors.some(
      (issue) =>
        issue.field === "part_number" && issue.message.includes("مكرر"),
    ),
  );
});

test("XLSX files are explicitly rejected with export guidance", async () => {
  const result = await parse(
    "binary placeholder",
    "parts.xlsx",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  );
  assert.equal(result.ok, false);
  assert.match(result.state.errors[0].message, /CSV UTF-8/);
});

test("invalid quantities, formulas, and mismatched columns reject the entire parse", async () => {
  for (const row of [
    "00123,10,1.5,Toyota",
    "00123,10,1,=IMPORTXML()",
    "00123,10",
  ]) {
    const result = await parse(`part_number,price,quantity,brand\n${row}`);
    assert.equal(result.ok, false);
    assert.ok(result.state.errorCount > 0);
  }
});

test("quoted comma and escaped quotes are read without splitting the data cell", async () => {
  const result = await parse(
    'part_number,price,quantity,brand\r\n00123,10.00,2,"Parts, ""Original"""\r\n',
  );
  assert.equal(result.ok, true);
  assert.equal(result.rows[0].brand, 'Parts, "Original"');
});

test("unclosed quotes and text after closing a quoted cell produce parse errors", () => {
  assert.ok(
    "error" in parseCatalogCsv('part_number,price,quantity\n"00123,10,1'),
  );
  assert.ok(
    "error" in parseCatalogCsv('part_number,price,quantity\n"00123"oops,10,1'),
  );
});

test("file size, row limits, empty input, and non-UTF-8 bytes are enforced before persistence", async () => {
  const csv = "part_number,price,quantity\n00123,10,1\n00456,11,2";
  assert.equal(
    (await parse(csv, "parts.csv", "text/csv", { ...limits, maxRows: 1 })).ok,
    false,
  );
  assert.equal(
    (await parse(csv, "parts.csv", "text/csv", { ...limits, maxFileBytes: 5 }))
      .ok,
    false,
  );
  assert.equal((await parse("")).ok, false);
  assert.equal(
    (
      await parseCatalogUpload(
        new File([new Uint8Array([255])], "parts.csv", { type: "text/csv" }),
        null,
        limits,
      )
    ).ok,
    false,
  );
});
