export interface RequestContextSummary {
  partText: string | null;
  vehicle: string | null;
  oemNumber: string | null;
  hasVin: boolean;
  attachmentCount: number;
  completedRequiredFields: number;
  requiredFields: number;
  progress: number;
  readyForReview: boolean;
  rfqLinked: boolean;
  missingFields: string[];
  pendingPartNumber?: string;
}

function safeText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return null;
  const clean = value.trim();
  return clean ? clean.slice(0, maxLength) : null;
}

export function summarizeRequestContext(
  draft: Record<string, unknown>,
  rfqId: string | null,
): RequestContextSummary {
  const partText = safeText(draft.partText, 120);
  const make = safeText(draft.make, 60);
  const model = safeText(draft.model, 80);
  const year = safeText(draft.year, 4);
  const oemNumber = safeText(draft.oemNumber, 40);
  const provenance =
    draft.partNumberProvenance && typeof draft.partNumberProvenance === 'object'
      ? (draft.partNumberProvenance as Record<string, unknown>)
      : null;
  const pendingPartNumber =
    provenance?.status === 'pending' ? safeText(provenance.value, 40) : null;
  const vin = safeText(draft.vin, 17);
  const attachmentCount = Array.isArray(draft.attachments)
    ? Math.min(
        2,
        draft.attachments.filter((value) => typeof value === 'string').length,
      )
    : 0;
  const required = [
    ['القطعة', partText],
    ['الماركة', make],
    ['الموديل', model],
    ['السنة', year],
  ] as const;
  const completedRequiredFields = required.filter(([, value]) => value).length;
  const missingFields: string[] = required.flatMap(([label, value]) =>
    value ? [] : [label],
  );
  if (pendingPartNumber) missingFields.push('تأكيد رقم القطعة من الصورة');

  return {
    partText,
    vehicle: [make, model, year].filter(Boolean).join(' ') || null,
    oemNumber,
    ...(pendingPartNumber ? { pendingPartNumber } : {}),
    hasVin: Boolean(vin),
    attachmentCount,
    completedRequiredFields,
    requiredFields: required.length,
    progress: Math.round((completedRequiredFields / required.length) * 100),
    readyForReview:
      completedRequiredFields === required.length && !pendingPartNumber,
    rfqLinked: Boolean(rfqId),
    missingFields,
  };
}
