import assert from "node:assert/strict";
import test from "node:test";
import {
  companyCategory,
  findPartsCompanies,
  normalizeCompanySearch,
} from "./parts-companies.ts";

test("Arabic search ignores diacritics and alef variants", () => {
  assert.equal(normalizeCompanySearch("  إِطَـار  "), "اطار");
});
test("brand search finds the company in Arabic and Latin", () => {
  assert.equal(findPartsCompanies("all", "فولفو")[0]?.id, "zahid-tractor");
  assert.equal(findPartsCompanies("all", "volvo")[0]?.id, "zahid-tractor");
});
test("equipment filter does not include a cars-only company", () => {
  assert.deepEqual(
    findPartsCompanies("equipment", "").map((item) => item.id),
    ["zahid-tractor"],
  );
  assert.equal(findPartsCompanies("equipment", "تويوتا").length, 0);
});
test("multi-word search requires every word and supports whitespace", () => {
  assert.equal(
    findPartsCompanies("trucks", "  الجفالي   فوسو ")[0]?.id,
    "juffali-commercial",
  );
  assert.equal(findPartsCompanies("all", "الجفالي تويوتا").length, 0);
});
test("invalid or repeated category parameters fall back to the public full directory", () => {
  assert.equal(companyCategory("invalid"), "all");
  assert.equal(companyCategory(["cars", "trucks"]), "all");
  assert.equal(companyCategory(undefined), "all");
  assert.equal(companyCategory("cars"), "cars");
});
