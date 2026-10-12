import { computeLandedCost } from './landed-cost';
import {
  computeVat,
  resolveVatRate,
  VatRateNotConfiguredError,
} from './vat';
import {
  scoreQuote,
  rankQuoteSet,
  POSITIVE_WEIGHTS,
  PENALTY_WEIGHTS,
  MAX_DECISION_SCORE,
  type QuoteMetrics,
} from './decision-score';

describe('landed cost', () => {
  it('sums all 11 components into the total (BUSINESS_RULES formula)', () => {
    const r = computeLandedCost({
      supplierPrice: 100,
      localShipping: 10,
      intlShipping: 20,
      customsEstimate: 5,
      complianceCost: 4,
      inspectionFee: 3,
      paymentFee: 2,
      packagingFee: 1,
      riskBuffer: 6,
      platformMargin: 30,
      taxAmount: 15,
    });
    expect(r.totalLandedCost).toBe(196);
  });

  it('customer breakdown never reveals supplier cost or margin (Rule 2)', () => {
    const r = computeLandedCost({
      supplierPrice: 210,
      localShipping: 37,
      platformMargin: 40,
      taxAmount: 34.05,
    });
    // partPrice is a bundled figure = total − shipping − tax; supplier cost is hidden.
    expect(r.customerVisibleBreakdown.partPrice).toBe(
      r.totalLandedCost -
        r.customerVisibleBreakdown.shipping -
        r.customerVisibleBreakdown.tax,
    );
    expect(Object.keys(r.customerVisibleBreakdown)).not.toContain(
      'supplierPrice',
    );
    expect(Object.keys(r.customerVisibleBreakdown)).not.toContain(
      'platformMargin',
    );
    // The internal view keeps margin/net profit for admin.
    expect(r.internalCostBreakdown.platformMargin).toBe(40);
    expect(r.internalCostBreakdown.netProfit).toBe(40); // margin − riskBuffer(0)
  });
});

describe('VAT rate configuration', () => {
  it('reads a decimal fraction from configuration', () => {
    expect(resolveVatRate('0.15')).toBe(0.15);
    expect(resolveVatRate(0.05)).toBe(0.05);
    expect(resolveVatRate('0')).toBe(0);
  });

  it('refuses a missing rate instead of assuming zero', () => {
    // A silent zero would reach the customer as "price includes VAT" on a price
    // that carries none. Failing the quote is the cheaper mistake.
    for (const missing of [undefined, null, '']) {
      expect(() => resolveVatRate(missing)).toThrow(VatRateNotConfiguredError);
    }
  });

  it('refuses a percentage written as a whole number', () => {
    // 15 instead of 0.15 would charge fifteen times the price.
    expect(() => resolveVatRate('15')).toThrow(/fraction/);
    expect(() => resolveVatRate(1.5)).toThrow(/fraction/);
  });

  it('refuses nonsense outright', () => {
    expect(() => resolveVatRate('ربع')).toThrow(/not a number/);
    expect(() => resolveVatRate('-0.1')).toThrow(/negative/);
  });

  it('rounds to two decimals like every other pricing figure', () => {
    expect(computeVat({ taxableBase: 33.33, rate: 0.15 })).toBe(5);
    expect(computeVat({ taxableBase: 100, rate: 0.15 })).toBe(15);
    expect(computeVat({ taxableBase: 0, rate: 0.15 })).toBe(0);
  });
});

describe('landed cost — derived VAT', () => {
  const base = {
    supplierPrice: 100,
    localShipping: 10,
    platformMargin: 30,
  };

  it('derives tax from everything that precedes it', () => {
    const r = computeLandedCost({ ...base, vatRate: 0.15 });
    // 140 taxable, 21 tax, 161 total.
    expect(r.customerVisibleBreakdown.tax).toBe(21);
    expect(r.totalLandedCost).toBe(161);
  });

  it('never taxes the tax', () => {
    const r = computeLandedCost({ ...base, vatRate: 0.15 });
    const componentsBeforeTax = r.totalLandedCost - r.customerVisibleBreakdown.tax;
    expect(componentsBeforeTax).toBe(140);
  });

  it('keeps the total equal to base plus tax at awkward rates', () => {
    for (const rate of [0.05, 0.15, 0.333, 0.07]) {
      const r = computeLandedCost({ ...base, vatRate: rate });
      expect(
        Math.round(r.totalLandedCost * 100),
      ).toBe(Math.round((140 + r.customerVisibleBreakdown.tax) * 100));
    }
  });

  it('lets an explicit amount override the rate, for exempt cases', () => {
    const r = computeLandedCost({ ...base, vatRate: 0.15, taxAmount: 0 });
    expect(r.customerVisibleBreakdown.tax).toBe(0);
    expect(r.totalLandedCost).toBe(140);
  });

  it('charges nothing when neither a rate nor an amount is given', () => {
    // The caller is responsible for supplying a rate; the calculator stays pure
    // and does not read configuration itself.
    const r = computeLandedCost(base);
    expect(r.customerVisibleBreakdown.tax).toBe(0);
  });

  it('agrees with computeVat, the canonical definition', () => {
    // landed-cost inlines the arithmetic because Node's loader cannot resolve
    // an extensionless relative import when the file is read as source. This
    // is the guard against the two drifting apart.
    for (const rate of [0.05, 0.15, 0.333]) {
      const r = computeLandedCost({ ...base, vatRate: rate });
      expect(r.customerVisibleBreakdown.tax).toBe(
        computeVat({ taxableBase: 140, rate }),
      );
    }
  });

  it('reports the same tax internally and to the customer', () => {
    const r = computeLandedCost({ ...base, vatRate: 0.15 });
    expect(r.internalCostBreakdown.taxAmount).toBe(
      r.customerVisibleBreakdown.tax,
    );
  });
});

describe('decision score — weight integrity', () => {
  it('positive weights sum to exactly 0.88 and penalties to 0.12', () => {
    const pos =
      POSITIVE_WEIGHTS.fitment +
      POSITIVE_WEIGHTS.vendor +
      POSITIVE_WEIGHTS.price +
      POSITIVE_WEIGHTS.delivery +
      POSITIVE_WEIGHTS.warranty;
    const pen =
      PENALTY_WEIGHTS.counterfeit +
      PENALTY_WEIGHTS.compliance +
      PENALTY_WEIGHTS.returnHistory;
    expect(pos).toBeCloseTo(0.88, 10);
    expect(pen).toBeCloseTo(0.12, 10);
    expect(MAX_DECISION_SCORE).toBeCloseTo(0.88, 10);
  });

  it('a perfect quote reaches the 0.88 ceiling, never 1.0', () => {
    const s = scoreQuote(
      {
        quoteId: 'perfect',
        fitmentConfidence: 1,
        supplierScore: 100,
        price: 100,
        deliveryDays: 0,
        warrantyMonths: 24,
      },
      100,
    );
    expect(s.decisionScore).toBeCloseTo(0.88, 10);
  });
});

// Shared candidate set for the four mandated cases.
const setup = (): QuoteMetrics[] => [
  {
    quoteId: 'local', // higher fitment/warranty, pricier, fast
    fitmentConfidence: 0.96,
    supplierScore: 90,
    price: 247,
    deliveryDays: 2,
    warrantyMonths: 12,
    counterfeitRisk: 0.05,
    complianceRisk: 0.0,
    supplierReturnRate: 0.02,
  },
  {
    quoteId: 'global', // cheapest but slow, medium risk
    fitmentConfidence: 0.94,
    supplierScore: 82,
    price: 221,
    deliveryDays: 10,
    warrantyMonths: 6,
    counterfeitRisk: 0.12,
    complianceRisk: 0.15,
    supplierReturnRate: 0.05,
  },
];

describe('decision score — mandated cases (BUSINESS_RULES)', () => {
  it('cheapest-wins: the cheapest quote gets price_score = 1.0', () => {
    const { scored, labels } = rankQuoteSet(setup());
    const global = scored.find((s) => s.quoteId === 'global')!;
    expect(global.subScores.price).toBeCloseTo(1, 10);
    expect(labels.CHEAPEST).toBe('global');
  });

  it('fastest-wins: the fastest quote is labeled FASTEST', () => {
    const { labels } = rankQuoteSet(setup());
    expect(labels.FASTEST).toBe('local'); // 2 days vs 10
  });

  it('high-risk-penalized: adding heavy risk lowers the score', () => {
    const base = scoreQuote(
      {
        quoteId: 'x',
        fitmentConfidence: 0.96,
        supplierScore: 90,
        price: 100,
        deliveryDays: 2,
        warrantyMonths: 12,
      },
      100,
    );
    const risky = scoreQuote(
      {
        quoteId: 'x',
        fitmentConfidence: 0.96,
        supplierScore: 90,
        price: 100,
        deliveryDays: 2,
        warrantyMonths: 12,
        counterfeitRisk: 1,
        complianceRisk: 1,
        supplierReturnRate: 1,
      },
      100,
    );
    expect(risky.decisionScore).toBeLessThan(base.decisionScore);
    expect(base.decisionScore - risky.decisionScore).toBeCloseTo(0.12, 10);
  });

  it('missing-field: a missing required sub-score is 0 and forces human review', () => {
    const s = scoreQuote(
      { quoteId: 'partial', supplierScore: 90, price: 100 },
      100,
    );
    expect(s.subScores.fitment).toBe(0);
    expect(s.missingFields).toContain('fitmentConfidence');
    expect(s.humanReviewRequired).toBe(true);
  });

  it('best-overall: highest decision score wins the BEST_OVERALL label', () => {
    const { scored, labels } = rankQuoteSet(setup());
    const best = scored.reduce((a, b) =>
      b.decisionScore > a.decisionScore ? b : a,
    );
    expect(labels.BEST_OVERALL).toBe(best.quoteId);
  });
});
