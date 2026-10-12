export interface ChatTriageDecisionFacts {
  recommendedStatus: string;
  riskFlags: readonly string[];
  missingFields: readonly string[];
  confidence: number;
  humanReviewRequired: boolean;
}

export function summarizeChatTriageDecision(
  triage: ChatTriageDecisionFacts,
  imagesCount: number,
) {
  return {
    recommendedStatus: triage.recommendedStatus,
    riskFlags: triage.riskFlags,
    missingFieldsCount: triage.missingFields.length,
    confidence: triage.confidence,
    humanReviewRequired: triage.humanReviewRequired,
    imagesCount,
  };
}
