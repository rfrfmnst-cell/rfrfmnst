import { triageRfqIntake } from './intake-triage';

describe('rfq intake triage', () => {
  it('routes complete requests to fitment review with auditable evidence', () => {
    const out = triageRfqIntake({
      fullName: 'سعد القحطاني',
      phone: '+966512345678',
      make: 'تويوتا',
      model: 'كامري',
      year: 2021,
      partText: 'شمعة أمامية يسار',
      oemNumber: '81170-60M60',
      imagesCount: 1,
    });

    expect(out.recommendedStatus).toBe('FITMENT_REVIEW');
    expect(out.missingFields).toEqual([]);
    expect(out.humanReviewRequired).toBe(false);
    expect(out.confidence).toBeGreaterThanOrEqual(0.85);
    expect(out.evidence.some((e) => e.field === 'oemNumber')).toBe(true);
  });

  it('keeps incomplete requests in needs-more-info', () => {
    const out = triageRfqIntake({
      fullName: 'سعد القحطاني',
      phone: '+966512345678',
      partText: 'فلتر مكيف',
    });

    expect(out.recommendedStatus).toBe('NEED_MORE_INFO');
    expect(out.missingFields).toEqual(['make', 'model', 'year']);
    expect(out.humanReviewRequired).toBe(true);
    expect(out.nextActions[0]).toContain('make');
  });

  it('flags sensitive parts for human review even when complete', () => {
    const out = triageRfqIntake({
      fullName: 'عبدالله الزهراني',
      phone: '+966512345678',
      make: 'نيسان',
      model: 'باترول',
      year: 2020,
      partText: 'فحمات فرامل أمامية',
      oemNumber: 'D1060-1LA0A',
    });

    expect(out.recommendedStatus).toBe('FITMENT_REVIEW');
    expect(out.riskFlags).toContain('sensitive_part_requires_technical_review');
    expect(out.humanReviewRequired).toBe(true);
  });

  it('does not treat malformed OEM or VIN values as strong fitment evidence', () => {
    const out = triageRfqIntake({
      fullName: 'سعد القحطاني',
      phone: '+966512345678',
      make: 'تويوتا',
      model: 'كامري',
      year: 2021,
      partText: 'فلتر مكيف',
      oemNumber: 'abc',
      vin: '1234',
    });

    expect(out.riskFlags).toEqual(
      expect.arrayContaining([
        'invalid_oem_format',
        'invalid_vin_format',
        'fitment_evidence_weak',
      ]),
    );
    expect(out.humanReviewRequired).toBe(true);
    expect(
      out.evidence.find((e) => e.field === 'vin')?.confidence,
    ).toBeLessThan(0.5);
  });
});
