export const OTO_APPLIED_ORDER_STATUS_KIND = 'ORDER_STATUS_APPLIED';

export function otoAppliedWebhookKind(kind: string): string | null {
  return kind === 'ORDER_STATUS' ? OTO_APPLIED_ORDER_STATUS_KIND : null;
}

export function isOtoAppliedWebhookKind(kind: string): boolean {
  return kind === OTO_APPLIED_ORDER_STATUS_KIND;
}
