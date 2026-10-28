import assert from "node:assert/strict";
import test from "node:test";
import { normalizeOtpCode } from "./auth-input.ts";

test("administrative MFA accepts the same code in Arabic, Persian and Latin digits", () => {
  for (const value of ["123456", "١٢٣٤٥٦", "۱۲۳۴۵۶", " ١٢٣٤٥٦ "]) {
    assert.equal(normalizeOtpCode(value), "123456");
  }
});

test("MFA normalization never strips letters, punctuation or embedded whitespace", () => {
  for (const value of ["١٢٣٤٥x", "123 456", "123-456", "١٢٣٤٥٦٧"]) {
    assert.doesNotMatch(normalizeOtpCode(value), /^[0-9]{6}$/);
  }
});
