import type { UIMessage } from 'ai';

export interface ThreadSummary {
  id: string;
  title: string;
  rfqId: string | null;
  updatedAt: string;
}

export interface ThreadPayload extends ThreadSummary {
  messages: UIMessage[];
  draft: Record<string, unknown>;
  olderCursor: string | null;
}

export interface SelectedQuoteSummary {
  quoteId: string;
  finalPrice: string;
  currency: string;
  deliveryDaysMin: number | null;
  deliveryDaysMax: number | null;
  warrantyMonths: number | null;
  fitmentConfidence: number | null;
  sourceType: 'LOCAL' | 'GLOBAL' | null;
}
