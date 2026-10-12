export function rfqDecisionLockKey(rfqId: string): string {
  return `quote-approval:${rfqId}`;
}
