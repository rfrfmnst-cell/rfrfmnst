import { prisma } from '@rafraf/db';
import {
  edfaPayIntegrationReadiness,
  isEdfaPayWebhookEvidenceCurrent,
  type EdfaPayReadinessResult,
} from '@rafraf/shared/payments/edfapay-readiness';
import {
  EDFAPAY_WEBHOOK_EVIDENCE_ACTION,
  readEdfaPayWebhookEvidence,
} from './edfapay-webhook-evidence';

/**
 * Revalidates the live payment boundary from provider API evidence and a fresh,
 * signed webhook observation. Checkout calls this directly so a stale release
 * attestation cannot leave money intake open after readiness turns red.
 */
export async function customerEdfaPayRuntimeReadiness(
  env: NodeJS.ProcessEnv = process.env,
): Promise<EdfaPayReadinessResult> {
  if (!env.DATABASE_URL?.trim()) {
    return {
      configured: false,
      apiVerified: false,
      webhookAttested: false,
      ready: false,
      reason: 'payment_evidence_database_missing',
    };
  }

  try {
    const evidenceRows = await prisma.auditLog.findMany({
      where: { action: EDFAPAY_WEBHOOK_EVIDENCE_ACTION },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: { after: true, createdAt: true },
    });
    const evidence =
      evidenceRows
        .map(readEdfaPayWebhookEvidence)
        .find((item) => isEdfaPayWebhookEvidenceCurrent(env, item)) ?? null;
    return edfaPayIntegrationReadiness(env, evidence);
  } catch (error) {
    console.error('[payments:edfapay] runtime readiness failed', {
      code: 'PAYMENT_RUNTIME_READINESS_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      configured: false,
      apiVerified: false,
      webhookAttested: false,
      ready: false,
      reason: 'payment_runtime_readiness_failed',
    };
  }
}
