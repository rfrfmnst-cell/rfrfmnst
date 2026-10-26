import { tapPaymentLaunchStatus } from './tap-launch';
import { edfaPayApiEnvironment } from '@rafraf/shared/payments/edfapay-endpoint';
import {
  customerPaymentOrigin,
  hasEdfaPayCheckoutRedirectOrigin,
} from '@rafraf/shared/payments/payment-url-policy';
import { edfaPayWebhookSecretFromEnv } from '@rafraf/shared/payments/edfapay-signature';
import { providerNeutralBillingConfiguration } from '@rafraf/shared/billing/provider-neutral';

export type PaymentLaunchMode = 'disabled' | 'sandbox' | 'live' | 'invalid';

export interface PaymentLaunchStatus {
  mode: PaymentLaunchMode;
  launchRequired: boolean;
  checkoutAllowed: boolean;
  readinessAllowed: boolean;
  reason: string | null;
}

export interface CustomerPaymentExperience {
  kind: 'checkout' | 'deferred';
  paymentLabel: string;
  nextActionTitle: string;
  nextActionLinkLabel: string;
}

export function customerPaymentExperience(
  status: PaymentLaunchStatus,
): CustomerPaymentExperience {
  if (status.checkoutAllowed) {
    return {
      kind: 'checkout',
      paymentLabel: 'بانتظار الدفع',
      nextActionTitle: 'أكمل دفع طلبك بأمان',
      nextActionLinkLabel: 'الانتقال للدفع',
    };
  }

  return {
    kind: 'deferred',
    paymentLabel: 'الدفع غير متاح حالياً',
    nextActionTitle: 'الدفع الإلكتروني غير متاح حالياً',
    nextActionLinkLabel: 'عرض تفاصيل الطلب',
  };
}

/**
 * فصل واضح بين اختبار الدفع وبين تحصيل المال الحقيقي.
 *
 * يمكن إطلاق المنتج مع تأجيل الدفع صراحةً. التحصيل الحي لا يُفتح إلا مع
 * EdfaPay جاهز وإصدار فواتير/إيصالات عام مستقل عن أي مزود ضريبي.
 */
export function paymentLaunchStatus(
  env: NodeJS.ProcessEnv | Record<string, string | undefined>,
): PaymentLaunchStatus {
  const raw = env.PAYMENT_MODE?.trim().toLowerCase() || 'disabled';
  if (raw === 'disabled') {
    const localDevelopment =
      env.NODE_ENV !== 'production' && !env.VERCEL_ENV?.trim();
    const launchRequired =
      env.PAYMENT_LAUNCH_REQUIRED?.trim().toLowerCase() !== 'false';
    return {
      mode: 'disabled',
      launchRequired,
      checkoutAllowed: false,
      readinessAllowed: localDevelopment || !launchRequired,
      reason: localDevelopment ? null : 'payment_disabled',
    };
  }

  if (env.PAYMENT_PROVIDER?.trim().toLowerCase() === 'tap')
    return tapPaymentLaunchStatus(env);

  if (raw === 'sandbox') {
    const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();
    const sandboxRuntime =
      vercelEnvironment === 'preview' ||
      (!vercelEnvironment && env.NODE_ENV !== 'production');
    const sandboxEndpoint =
      edfaPayApiEnvironment(env.EDFAPAY_BASE_URL) === 'sandbox';
    const credentials = Boolean(env.EDFAPAY_API_KEY?.trim());
    const webhookSecret = edfaPayWebhookSecretFromEnv(env) !== null;
    const publicOrigin = customerPaymentOrigin(env) !== null;
    const redirectOrigin = hasEdfaPayCheckoutRedirectOrigin(env, 'sandbox');
    const allowed =
      sandboxRuntime &&
      sandboxEndpoint &&
      credentials &&
      webhookSecret &&
      publicOrigin &&
      redirectOrigin;
    return {
      mode: 'sandbox',
      launchRequired: true,
      checkoutAllowed: allowed,
      readinessAllowed: allowed,
      reason: allowed
        ? null
        : !sandboxRuntime
          ? 'sandbox_environment_invalid'
          : !sandboxEndpoint
            ? 'sandbox_endpoint_invalid'
            : !credentials
              ? 'provider_credentials_missing'
              : !webhookSecret
                ? 'webhook_secret_missing'
                : !publicOrigin
                  ? 'customer_public_origin_missing'
                  : 'checkout_redirect_origin_missing',
    };
  }

  if (raw === 'live') {
    const vercelEnvironment = env.VERCEL_ENV?.trim().toLowerCase();
    const liveRuntime =
      vercelEnvironment === 'production' ||
      (!vercelEnvironment && env.NODE_ENV === 'production');
    const liveEndpoint = edfaPayApiEnvironment(env.EDFAPAY_BASE_URL) === 'live';
    const credentials = Boolean(env.EDFAPAY_API_KEY?.trim());
    const webhookSecret = edfaPayWebhookSecretFromEnv(env) !== null;
    const publicOrigin = customerPaymentOrigin(env) !== null;
    const redirectOrigin = hasEdfaPayCheckoutRedirectOrigin(env, 'live');
    const billing = providerNeutralBillingConfiguration(env) !== null;
    const allowed =
      liveRuntime &&
      liveEndpoint &&
      credentials &&
      webhookSecret &&
      publicOrigin &&
      redirectOrigin &&
      billing;
    return {
      mode: 'live',
      launchRequired: true,
      checkoutAllowed: allowed,
      readinessAllowed: allowed,
      reason: allowed
        ? null
        : !liveRuntime
          ? 'live_environment_invalid'
          : !liveEndpoint
            ? 'live_endpoint_invalid'
            : !credentials
              ? 'provider_credentials_missing'
              : !webhookSecret
                ? 'webhook_secret_missing'
                : !publicOrigin
                  ? 'customer_public_origin_missing'
                  : !redirectOrigin
                    ? 'checkout_redirect_origin_missing'
                    : 'billing_configuration_missing',
    };
  }

  return {
    mode: 'invalid',
    launchRequired: true,
    checkoutAllowed: false,
    readinessAllowed: false,
    reason: 'payment_mode_invalid',
  };
}
