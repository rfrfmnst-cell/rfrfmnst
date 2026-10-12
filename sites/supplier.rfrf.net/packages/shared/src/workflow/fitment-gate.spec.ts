import { evaluateFitmentGate } from './fitment-gate';

describe('fitment workflow gate', () => {
  it('allows a catalog-linked and reviewed item', () => {
    expect(
      evaluateFitmentGate({
        partId: 'part-1',
        fitmentConfidence: 0.91,
        humanReviewRequired: false,
      }),
    ).toEqual({ ready: true, reasons: [] });
  });

  it('blocks sourcing when the catalog match or confidence is missing', () => {
    const out = evaluateFitmentGate({
      partId: null,
      fitmentConfidence: null,
      humanReviewRequired: false,
    });
    expect(out.ready).toBe(false);
    expect(out.reasons).toEqual([
      'catalog_part_required',
      'fitment_confidence_required',
    ]);
  });

  it('blocks an otherwise complete item until human review is cleared', () => {
    const out = evaluateFitmentGate({
      partId: 'part-1',
      fitmentConfidence: 0.74,
      humanReviewRequired: true,
    });
    expect(out.ready).toBe(false);
    expect(out.reasons).toEqual(['human_review_required']);
  });
});
