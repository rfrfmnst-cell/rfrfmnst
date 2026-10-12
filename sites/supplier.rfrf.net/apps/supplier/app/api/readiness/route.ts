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
import { otoShippingApiReadiness } from '@rafraf/shared/shipping/oto-readiness';
import { OTO_APPLIED_ORDER_STATUS_KIND } from '@rafraf/shared/shipping/oto-evidence';
import { privateSupplierDocumentStorageReady } from '../../../lib/supplier-document-storage';
import { supplierEmailReadiness } from '../../../lib/supplier-email-readiness';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!readinessProbeAuthorized(request.headers)) {
    return Response.json(
      { service: 'rafraf-supplier', status: 'available' },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          Vary: 'x-rafraf-readiness-key',
        },
      },
    );
  }
  const session = (process.env.SESSION_SECRET?.trim().length ?? 0) >= 32;
  const emailReadiness = await supplierEmailReadiness();
  const emailAuthentication = emailReadiness.ready;
  const turnstileConfigurationStatus = turnstileConfiguration(process.env);
  const humanVerificationMode = turnstileHumanVerificationMode(process.env);
  const humanVerification = humanVerificationMode !== 'unconfigured';
  const releaseEnvironment = process.env.NODE_ENV === 'production';
  const shippingRequired =
    !releaseEnvironment ||
    process.env.SHIPPING_LAUNCH_REQUIRED?.trim().toLowerCase() !== 'false';
  const shippingApiPromise = shippingRequired
    ? otoShippingApiReadiness(process.env)
    : Promise.resolve({
        configured: false,
        verified: false,
        ready: false,
        reason: 'shipping_disabled_for_launch',
      });
  const supplierDocumentsPromise = privateSupplierDocumentStorageReady();
  let database = false;
  let databaseLeastPrivilege = process.env.NODE_ENV !== 'production';
  let databaseBranchBound = process.env.NODE_ENV !== 'production';
  let shippingWebhookVerified = false;
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
      shippingWebhookVerified =
        shippingRequired &&
        (await prisma.providerWebhookEvent.count({
          where: {
            provider: 'OTO',
            kind: OTO_APPLIED_ORDER_STATUS_KIND,
            orderId: { not: null },
            receivedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1_000) },
          },
        })) > 0;
    } catch {
      database = false;
      databaseLeastPrivilege = false;
      databaseBranchBound = false;
      shippingWebhookVerified = false;
      console.error('[readiness:supplier] database check failed', {
        code: 'DATABASE_UNREACHABLE',
      });
    }
  }

  const shippingApi = await shippingApiPromise;
  const shipping = {
    required: shippingRequired,
    configured: shippingApi.configured,
    verified: shippingApi.verified && shippingWebhookVerified,
    ready: shippingApi.ready && shippingWebhookVerified,
    reason: !shippingRequired
      ? 'shipping_disabled_for_launch'
      : !shippingApi.ready
        ? shippingApi.reason
        : shippingWebhookVerified
          ? null
          : 'oto_signed_webhook_evidence_missing',
  };
  const shippingAllowed = !shippingRequired || shipping.ready;
  const supplierDocuments = await supplierDocumentsPromise;

  const release = readReleaseSha();
  const releaseBound = releaseIsBound(release);
  const ready =
    session &&
    emailAuthentication &&
    humanVerification &&
    database &&
    databaseLeastPrivilege &&
    databaseBranchBound &&
    supplierDocuments &&
    shippingAllowed &&
    releaseBound;
  return Response.json(
    {
      service: 'rafraf-supplier',
      status: ready ? 'ready' : 'not_ready',
      checks: {
        session,
        emailAuthentication,
        humanVerification,
        database,
        databaseLeastPrivilege,
        databaseBranchBound,
        supplierDocuments,
        shipping: shippingAllowed,
        release: releaseBound,
      },
      integrations: {
        emailAuthentication: emailReadiness,
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
        shipping,
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
