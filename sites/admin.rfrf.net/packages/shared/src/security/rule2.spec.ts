/**
 * The RBAC test CLAUDE.md requires:
 * "An automated RBAC test must fail the build if `internalCostBreakdown` ever
 *  reaches a non-admin role, or a supplier can read competitor data."
 *
 * This file covers the runtime half (payload shape). `source-guard.spec.ts`
 * covers the static half (source code that could construct such a payload).
 */
import { describe, it, expect } from '@jest/globals';
import { computeLandedCost } from '../pricing/landed-cost';
import {
  assertNoInternalFieldLeaks,
  assertOwnedBySupplier,
  findInternalFieldLeaks,
  forbiddenFieldsFor,
  isSafeFor,
} from './rule2';

const deal = computeLandedCost({
  supplierPrice: 400,
  localShipping: 30,
  intlShipping: 50,
  customsEstimate: 25,
  complianceCost: 10,
  inspectionFee: 15,
  paymentFee: 8,
  packagingFee: 5,
  riskBuffer: 20,
  platformMargin: 120,
  taxAmount: 60,
  warrantyMonths: 6,
});

describe('Rule 2 — internalCostBreakdown must never reach a non-admin role', () => {
  it('rejects the full landed-cost result for a customer', () => {
    expect(isSafeFor(deal, 'CUSTOMER')).toBe(false);
    expect(() => assertNoInternalFieldLeaks(deal, 'CUSTOMER')).toThrow(
      /Rule 2 violation/,
    );
  });

  it('rejects the full landed-cost result for a supplier', () => {
    expect(() => assertNoInternalFieldLeaks(deal, 'SUPPLIER')).toThrow(
      /Rule 2 violation/,
    );
  });

  it('accepts the same result for an admin (Rule 3)', () => {
    expect(forbiddenFieldsFor('ADMIN')).toHaveLength(0);
    expect(() => assertNoInternalFieldLeaks(deal, 'ADMIN')).not.toThrow();
  });

  it('accepts the customer-visible half on its own', () => {
    const payload = {
      finalPrice: deal.totalLandedCost,
      ...deal.customerVisibleBreakdown,
    };
    expect(findInternalFieldLeaks(payload, 'CUSTOMER')).toEqual([]);
    expect(() => assertNoInternalFieldLeaks(payload, 'CUSTOMER')).not.toThrow();
  });

  it('reports the exact path of a leak nested inside a list', () => {
    const payload = {
      quotes: [
        { quoteId: 'q1', finalPrice: 100 },
        { quoteId: 'q2', finalPrice: 120, platformMargin: 30 },
      ],
    };
    expect(findInternalFieldLeaks(payload, 'CUSTOMER')).toEqual([
      'quotes[1].platformMargin',
    ]);
  });

  it('catches every internal cost component individually', () => {
    for (const field of [
      'supplierPrice',
      'platformMargin',
      'riskBuffer',
      'netProfit',
      'customsEstimate',
      'complianceCost',
      'inspectionFee',
      'paymentFee',
      'packagingFee',
      'localShipping',
      'intlShipping',
      'internalCostBreakdown',
    ]) {
      expect(findInternalFieldLeaks({ [field]: 1 }, 'CUSTOMER')).toEqual([
        field,
      ]);
    }
  });

  it('still allows the bundled figures the customer is meant to see', () => {
    const safe = {
      finalPrice: 743,
      partPrice: 603,
      shipping: 80,
      tax: 60,
      warrantyMonths: 6,
      currency: 'SAR',
      deliveryDaysMin: 2,
      deliveryDaysMax: 4,
      fitmentConfidence: 0.92,
      labels: ['BEST_OVERALL'],
    };
    expect(findInternalFieldLeaks(safe, 'CUSTOMER')).toEqual([]);
  });

  it('hides supplier identity from the customer but not from the admin', () => {
    const payload = { quoteId: 'q1', supplierName: 'قطع الرياض' };
    expect(findInternalFieldLeaks(payload, 'CUSTOMER')).toEqual([
      'supplierName',
    ]);
    expect(findInternalFieldLeaks(payload, 'ADMIN')).toEqual([]);
  });

  it("lets a supplier see its own price but never Rafraf's margin", () => {
    expect(findInternalFieldLeaks({ supplierPrice: 400 }, 'SUPPLIER')).toEqual(
      [],
    );
    expect(findInternalFieldLeaks({ platformMargin: 120 }, 'SUPPLIER')).toEqual([
      'platformMargin',
    ]);
  });

  it('survives cyclic payloads instead of hanging', () => {
    const node: Record<string, unknown> = { finalPrice: 100 };
    node.self = node;
    expect(() => findInternalFieldLeaks(node, 'CUSTOMER')).not.toThrow();
  });
});

describe('Rule 2 — a supplier must not read competitor data', () => {
  it('rejects rows belonging to another supplier', () => {
    const rows = [
      { id: 'q1', supplierId: 'sup_me' },
      { id: 'q2', supplierId: 'sup_rival' },
    ];
    expect(() => assertOwnedBySupplier(rows, 'sup_me')).toThrow(
      /Competitor data leak/,
    );
  });

  it('accepts a correctly scoped result set', () => {
    const rows = [
      { id: 'q1', supplierId: 'sup_me' },
      { id: 'q2', supplierId: 'sup_me' },
    ];
    expect(() => assertOwnedBySupplier(rows, 'sup_me')).not.toThrow();
  });
});
