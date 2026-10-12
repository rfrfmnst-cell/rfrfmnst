interface OtoClaim {
  provider: string;
  status: string;
  externalOrderId: string | null;
  trackingNumber: string | null;
  labelUrl: string | null;
  shippedAt: Date | null;
  lastProviderEventAt: Date | null;
  eventsLog: unknown;
}

/** Only a proven rejection before order creation releases the durable claim. */
export function otoClaimDefinitivelyRejected(claim: OtoClaim): boolean {
  const event = claim.eventsLog as { stage?: unknown; code?: unknown } | null;
  return (
    claim.provider === 'OTO' &&
    claim.status === 'PENDING' &&
    claim.externalOrderId === null &&
    claim.trackingNumber === null &&
    claim.labelUrl === null &&
    claim.shippedAt === null &&
    claim.lastProviderEventAt === null &&
    event?.stage === 'OTO_ORDER_REJECTED' &&
    ['OTO_OPERATIONAL_AUTH_FAILED', 'OTO_OPERATIONAL_REQUEST_INVALID'].includes(
      String(event.code),
    )
  );
}

export function otoClaimBlocksCompliance(claim: OtoClaim): boolean {
  return claim.provider === 'OTO' && !otoClaimDefinitivelyRejected(claim);
}
