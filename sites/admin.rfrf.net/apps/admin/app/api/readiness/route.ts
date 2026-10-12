import { PaymentStatus, RoleName, prisma } from '@rafraf/db';
import {
  REFUND_QUEUE_BLOCKING_FAILURE_CODES,
  REFUND_QUEUE_BLOCKING_STATUSES,
  STALE_PAYMENT_INTAKE_MINUTES,
} from '@rafraf/orders';
import { edfaPayApiReadiness } from '@rafraf/shared/payments/edfapay-readiness';
import { manualPaymentReadiness } from '@rafraf/shared/payments/manual-payment-policy';
import { supplierPayoutReadiness } from '@rafraf/shared/payments/supplier-payout-policy';
import { readinessProbeAuthorized } from '@rafraf/shared/readiness-probe';
import {
  readReleaseSha,
  releaseIsBound,
} from '@rafraf/shared/release-identity';
import { twilioVerifyReady } from '@rafraf/shared/twilio-verify';
import { twilioSmsConfigured, twilioSmsReady } from '@rafraf/shared/twilio-sms';
import {
  adminAuthConfigured,
  localAdminMfaEnabled,
} from '../../../lib/admin-session';
import { abcpDiscoveryStatus } from '../../../lib/global-sourcing/abcp';
import { apmDiscoveryStatus } from '../../../lib/global-sourcing/apm';
import { ebayBrowseDiscoveryStatus } from '../../../lib/global-sourcing/ebay-browse';
import { privateEvidenceStorageReady } from '../../../lib/private-evidence';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: Request) {
  if (!readinessProbeAuthorized(request.headers)) {
    return Response.json(
      { service: 'rafraf-admin', status: 'available' },
      {
        headers: {
          'Cache-Control': 'public, max-age=30, stale-while-revalidate=60',
          Vary: 'x-rafraf-readiness-key',
        },
      },
    );
  }
  const authConfigured = adminAuthConfigured();
  const otpPromise = localAdminMfaEnabled()
    ? Promise.resolve(true)
    : twilioVerifyReady();
  const storagePromise = privateEvidenceStorageReady();
  const vercelEnvironment = process.env.VERCEL_ENV?.trim().toLowerCase();
  const releaseEnvironment =
    process.env.NODE_ENV === 'production' ||
    vercelEnvironment === 'preview' ||
    vercelEnvironment === 'production';
  const paymentMode = process.env.PAYMENT_MODE?.trim().toLowerCase();
  const paymentsRequired =
    (releaseEnvironment
      ? process.env.PAYMENT_LAUNCH_REQUIRED?.trim().toLowerCase() !== 'false'
      : false) ||
    paymentMode === 'sandbox' ||
    paymentMode === 'live';
  const expectedPaymentEnvironment =
    vercelEnvironment === 'preview'
      ? 'sandbox'
      : vercelEnvironment === 'production' ||
          process.env.NODE_ENV === 'production'
        ? 'live'
        : paymentMode === 'sandbox' || paymentMode === 'live'
          ? paymentMode
          : undefined;
  const paymentApiPromise = paymentsRequired
    ? edfaPayApiReadiness(process.env, expectedPaymentEnvironment)
    : Promise.resolve({
        configured: false,
        apiVerified: false,
        ready: false,
        environment: null,
        reason: 'payment_disabled',
      });
  // Mirrors the payment launch gate: a release environment requires the
  // channel by default, but the owner can opt out explicitly and auditably.
  const messagingRequired = releaseEnvironment
    ? process.env.TWILIO_MESSAGING_REQUIRED?.trim().toLowerCase() !== 'false'
    : process.env.TWILIO_MESSAGING_REQUIRED === 'true';
  const messagingConfigured = twilioSmsConfigured();
  const messagingPromise = messagingRequired
    ? twilioSmsReady()
    : Promise.resolve(messagingConfigured);
  const globalSourcing = ebayBrowseDiscoveryStatus();
  const apmSourcing = apmDiscoveryStatus();
  const abcpSourcing = abcpDiscoveryStatus();
  const manualPayments = manualPaymentReadiness();
  const supplierPayouts = supplierPayoutReadiness();
  const supplierPayoutsRequired =
    !releaseEnvironment ||
    process.env.SUPPLIER_PAYOUT_LAUNCH_REQUIRED?.trim().toLowerCase() !==
      'false';
  const manualPaymentSafety =
    (!manualPayments.bankTransfer.enabled ||
      (manualPayments.bankTransfer.intakeReady &&
        manualPayments.refunds.ready)) &&
    (!manualPayments.cashOnDelivery.enabled ||
      (manualPayments.cashOnDelivery.ready && manualPayments.refunds.ready));
  const globalSourcingReady =
    (!globalSourcing.enabled || globalSourcing.configured) &&
    (!apmSourcing.enabled || apmSourcing.configured) &&
    (!abcpSourcing.enabled || abcpSourcing.configured);
  let database = false;
  let operators = false;
  let financialReconciliationClear = false;
  let stalePaymentIntakesClear = false;
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
      operators =
        (await prisma.user.count({
          where: {
            isActive: true,
            role: { is: { name: RoleName.ADMIN } },
            adminPermissions: { isEmpty: false },
          },
        })) > 0;
      financialReconciliationClear =
        (await prisma.paymentRefund.count({
          where: {
            OR: [
              {
                status: {
                  in: [...REFUND_QUEUE_BLOCKING_STATUSES],
                },
              },
              {
                failureCode: {
                  in: [...REFUND_QUEUE_BLOCKING_FAILURE_CODES],
                },
              },
            ],
          },
        })) === 0;
      stalePaymentIntakesClear =
        (await prisma.payment.count({
          where: {
            provider: 'EDFAPAY',
            status: PaymentStatus.PENDING,
            externalRef: null,
            providerOrderCode: { not: null },
            updatedAt: {
              lte: new Date(Date.now() - STALE_PAYMENT_INTAKE_MINUTES * 60_000),
            },
          },
        })) === 0;
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
      operators = false;
      financialReconciliationClear = false;
      stalePaymentIntakesClear = false;
      console.error('[readiness:admin] database check failed', {
        code: 'DATABASE_UNREACHABLE',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const [storage, otp, messagingReady, paymentApi] = await Promise.all([
    storagePromise,
    otpPromise,
    messagingPromise,
    paymentApiPromise,
  ]);
  const auth = authConfigured && otp;
  const messagingAllowed = !messagingRequired || messagingReady;
  const paymentApiAllowed = !paymentsRequired || paymentApi.ready;
  const supplierPayoutsAllowed =
    !supplierPayoutsRequired || supplierPayouts.ready;
  const messaging = {
    required: messagingRequired,
    configured: messagingConfigured,
    ready: messagingReady,
    degraded: messagingRequired && !messagingReady,
  };

  const release = readReleaseSha();
  const releaseBound = releaseIsBound(release);
  const ready =
    auth &&
    database &&
    databaseLeastPrivilege &&
    databaseBranchBound &&
    operators &&
    financialReconciliationClear &&
    stalePaymentIntakesClear &&
    storage &&
    messagingAllowed &&
    paymentApiAllowed &&
    manualPaymentSafety &&
    supplierPayoutsAllowed &&
    globalSourcingReady &&
    releaseBound;
  return Response.json(
    {
      service: 'rafraf-admin',
      status: ready ? 'ready' : 'not_ready',
      checks: {
        auth,
        otp,
        database,
        databaseLeastPrivilege,
        databaseBranchBound,
        operators,
        financialReconciliationClear,
        stalePaymentIntakesClear,
        storage,
        messaging: messagingAllowed,
        paymentApi: paymentApiAllowed,
        manualPaymentSafety,
        supplierPayouts: supplierPayoutsAllowed,
        globalSourcing: globalSourcingReady,
        release: releaseBound,
      },
      integrations: {
        messaging,
        globalSourcing: {
          ebay: globalSourcing,
          apm: apmSourcing,
          abcp: abcpSourcing,
          ready: globalSourcingReady,
        },
        payments: {
          required: paymentsRequired,
          configured: paymentApi.configured,
          apiVerified: paymentApi.apiVerified,
          ready: paymentApi.ready,
          reason: paymentApi.reason,
        },
        manualPayments,
        supplierPayouts: {
          required: supplierPayoutsRequired,
          ...supplierPayouts,
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
