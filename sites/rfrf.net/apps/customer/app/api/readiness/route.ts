import { prisma } from '@rafraf/db';
import { readinessProbeAuthorized } from '@rafraf/shared/readiness-probe';
import {
  readReleaseSha,
  releaseIsBound,
} from '@rafraf/shared/release-identity';
import {
  turnstileConfiguration,
  turnstileConfigurationFingerprint,
  turnstileHumanVerificationMode,
} from '@rafraf/shared/security/turnstile';
import { twilioVerifyReady } from '@rafraf/shared/twilio-verify';
import {
  CHAT_STREAM_EVIDENCE_ACTION,
  CHAT_STREAM_CONTRACT_VERSION,
  CHAT_STREAM_PROBE_PATTERN,
  chatStreamConfiguration,
  isChatStreamEvidenceCurrent,
  readChatStreamEvidence,
} from '../../../lib/ai-launch-evidence';
import { privateEvidenceStorageReady } from '../../../lib/evidence-storage';
import { paymentLaunchStatus } from '../../../lib/payments/payment-launch';
import { customerEdfaPayRuntimeReadiness } from '../../../lib/payments/edfapay-runtime-readiness';
import { customerEmailConfiguration } from '../../../lib/customer-email-verification';
import { customerGoogleAvailability } from '../../../lib/customer-google-availability';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!readinessProbeAuthorized(request.headers)) {
    return Response.json(
      { service: 'rafraf-customer', status: 'available' },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          Vary: 'x-rafraf-readiness-key',
        },
      },
    );
  }
  const session = (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32;
  const localOtp =
    process.env.NODE_ENV !== 'production' &&
    process.env.OTP_DELIVERY_PROVIDER === 'local';
  const messaging = localOtp || (await twilioVerifyReady());
  const customerEmail = customerEmailConfiguration() !== null;
  const customerGoogle = customerGoogleAvailability();
  const turnstileConfigurationStatus = turnstileConfiguration(process.env);
  const humanVerificationMode = turnstileHumanVerificationMode(process.env);
  const humanVerification = humanVerificationMode !== 'unconfigured';
  const aiConfiguration = chatStreamConfiguration(process.env);
  const aiConfigured = aiConfiguration !== null;
  const requestedAiProbe = new URL(request.url).searchParams.get('aiProbe');
  const expectedAiProbe =
    requestedAiProbe && CHAT_STREAM_PROBE_PATTERN.test(requestedAiProbe)
      ? requestedAiProbe
      : undefined;
  const aiProbeValid =
    requestedAiProbe === null || expectedAiProbe !== undefined;
  let aiVerified = false;
  if (aiConfigured && process.env.DATABASE_URL) {
    try {
      const evidenceRows = await prisma.auditLog.findMany({
        where: { action: CHAT_STREAM_EVIDENCE_ACTION },
        orderBy: { createdAt: 'desc' },
        take: 50,
        select: { after: true, createdAt: true },
      });
      aiVerified =
        aiProbeValid &&
        evidenceRows
          .map(readChatStreamEvidence)
          .some((evidence) =>
            isChatStreamEvidenceCurrent(
              process.env,
              evidence,
              Date.now(),
              expectedAiProbe,
            ),
          );
    } catch {
      console.error('[readiness:customer] AI evidence check failed', {
        code: 'AI_EVIDENCE_UNREACHABLE',
      });
    }
  }
  const storage = await privateEvidenceStorageReady();
  const payments = paymentLaunchStatus(process.env);
  const paymentIntegration =
    payments.mode === 'disabled'
      ? {
          configured: false,
          apiVerified: false,
          webhookAttested: false,
          ready: payments.readinessAllowed,
          reason: payments.reason,
        }
      : payments.readinessAllowed
        ? await customerEdfaPayRuntimeReadiness(process.env)
        : {
            configured: false,
            apiVerified: false,
            webhookAttested: false,
            ready: false,
            reason: payments.reason,
          };
  let database = false;
  let databaseLeastPrivilege = process.env.NODE_ENV !== 'production';
  let databaseBranchBound = process.env.NODE_ENV !== 'production';
  if (process.env.DATABASE_URL) {
    try {
      const roles = await prisma.$queryRaw<
        Array<{ role: string; superuser: boolean; branchId: string | null }>
      >`SELECT current_user AS "role", rolsuper AS "superuser",
          current_setting('neon.branch_id', true) AS "branchId"
        FROM pg_roles
        WHERE rolname = current_user`;
      const currentRole = roles[0];
      const expectedRole =
        process.env.DATABASE_RUNTIME_ROLE?.trim() || 'rafraf_app';
      database = Boolean(currentRole);
      databaseLeastPrivilege =
        process.env.NODE_ENV !== 'production' ||
        Boolean(
          currentRole &&
          currentRole.role === expectedRole &&
          !currentRole.superuser,
        );
      const expectedBranch = process.env.NEON_BRANCH_ID?.trim() ?? '';
      databaseBranchBound =
        process.env.NODE_ENV !== 'production' ||
        Boolean(expectedBranch && currentRole?.branchId === expectedBranch);
    } catch (error) {
      database = false;
      databaseLeastPrivilege = false;
      databaseBranchBound = false;
      console.error('[readiness:customer] database check failed', {
        code: 'DATABASE_UNREACHABLE',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const release = readReleaseSha();
  const releaseBound = releaseIsBound(release);
  const ai = aiVerified;
  const ready =
    session &&
    messaging &&
    customerEmail &&
    customerGoogle.readinessAllowed &&
    humanVerification &&
    database &&
    databaseLeastPrivilege &&
    databaseBranchBound &&
    ai &&
    storage &&
    paymentIntegration.ready &&
    releaseBound;
  return Response.json(
    {
      service: 'rafraf-customer',
      status: ready ? 'ready' : 'not_ready',
      checks: {
        session,
        messaging,
        customerEmail,
        customerGoogle: customerGoogle.configured,
        customerGoogleRequired: customerGoogle.required,
        customerGoogleReadinessAllowed: customerGoogle.readinessAllowed,
        humanVerification,
        database,
        databaseLeastPrivilege,
        databaseBranchBound,
        ai,
        aiConfigured,
        aiVerified,
        storage,
        payments: paymentIntegration.ready,
        paymentApi: paymentIntegration.apiVerified,
        paymentWebhook: paymentIntegration.webhookAttested,
        release: releaseBound,
      },
      integrations: {
        customerAuthentication: {
          emailConfigured: customerEmail,
          googleEnabled: customerGoogle.enabled,
          googleRequired: customerGoogle.required,
          googleConfigured: customerGoogle.configured,
          googleAvailable: customerGoogle.available,
          googleDeferred: customerGoogle.deferred,
          googleReason: customerGoogle.reason,
          googleRedirectUri: customerGoogle.redirectUri,
        },
        humanVerification: {
          mode: humanVerificationMode,
          ready: humanVerification,
          turnstileConfigured: turnstileConfigurationStatus !== null,
          testCredentials:
            turnstileConfigurationStatus?.testCredentials ?? false,
          fingerprint: turnstileConfigurationFingerprint(
            process.env,
            request.url,
          ),
        },
        ai: {
          configured: aiConfigured,
          verified: aiVerified,
          contractVersion: CHAT_STREAM_CONTRACT_VERSION,
          evidenceTtlMinutes: 60,
          reason: aiVerified
            ? null
            : aiConfigured
              ? 'successful_persisted_stream_evidence_missing_or_stale'
              : 'provider_configuration_missing',
        },
        payments: {
          mode: payments.mode,
          required: payments.launchRequired,
          checkoutAllowed: payments.checkoutAllowed,
          configured: paymentIntegration.configured,
          apiVerified: paymentIntegration.apiVerified,
          webhookAttested: paymentIntegration.webhookAttested,
          reason: paymentIntegration.reason ?? payments.reason,
        },
      },
      release: releaseBound ? release?.slice(0, 12) : null,
    },
    {
      status: ready ? 200 : 503,
      headers: {
        'Cache-Control': 'no-store, max-age=0',
        Vary: 'x-rafraf-readiness-key',
      },
    },
  );
}
