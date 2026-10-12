import path from 'node:path';
import { prisma } from '@rafraf/db';
import {
  chatModelId,
  requestedChatProvider,
  resolveChatProvider,
} from '@rafraf/shared/ai/model-provider';
import {
  edfaPayApiEnvironment,
  normalizeEdfaPayApiBaseUrl,
} from '@rafraf/shared/payments/edfapay-endpoint';
import {
  customerPaymentOrigin,
  hasEdfaPayCheckoutRedirectOrigin,
} from '@rafraf/shared/payments/payment-url-policy';
import { twilioSmsConfigured, twilioSmsReady } from '@rafraf/shared/twilio-sms';
import { otoFulfillmentStatus } from './shipping/oto';
import { privateEvidenceStorageReady } from './private-evidence';

export type IntegrationId =
  'ai' | 'payments' | 'shipping' | 'storage' | 'sms' | 'database';

export interface SafeIntegrationStatus {
  id: IntegrationId;
  label: string;
  configured: boolean;
  verified: boolean;
  detail: string;
  verificationNote: string;
}

function safeIdentifier(value: string | undefined, fallback: string): string {
  const normalized = value?.trim().toLowerCase() ?? '';
  return /^[a-z0-9][a-z0-9._/-]{0,79}$/.test(normalized)
    ? normalized
    : fallback;
}

async function databaseVerified(): Promise<boolean> {
  if (!process.env.DATABASE_URL?.trim()) return false;
  try {
    const rows = await prisma.$queryRaw<Array<{ connected: number }>>`
      SELECT 1 AS "connected"
    `;
    return rows[0]?.connected === 1;
  } catch (error) {
    console.error('[integrations:admin] database probe failed', {
      code: 'DATABASE_PROBE_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

function aiConfiguration(): Pick<
  SafeIntegrationStatus,
  'configured' | 'detail' | 'verificationNote'
> {
  let model = chatModelId(process.env).slice(0, 80);
  try {
    const provider = resolveChatProvider(process.env);
    model = chatModelId(
      process.env,
      provider ?? requestedChatProvider(process.env),
    ).slice(0, 80);
    return {
      configured: provider !== null,
      detail: `${provider ?? safeIdentifier(process.env.RAFRAF_AI_PROVIDER, 'غير محدد')} · ${model}`,
      verificationNote:
        'الإعداد صالح بنيوياً؛ لم يُنفّذ استدعاء نموذج مدفوع من هذه الصفحة.',
    };
  } catch {
    return {
      configured: false,
      detail: `مزوّد غير مدعوم · ${model}`,
      verificationNote: 'قيمة RAFRAF_AI_PROVIDER غير مدعومة.',
    };
  }
}

function paymentConfiguration(): Pick<
  SafeIntegrationStatus,
  'configured' | 'detail' | 'verificationNote'
> {
  const mode = safeIdentifier(process.env.PAYMENT_MODE, 'disabled');
  const baseUrl = normalizeEdfaPayApiBaseUrl(process.env.EDFAPAY_BASE_URL);
  const environment = edfaPayApiEnvironment(process.env.EDFAPAY_BASE_URL);
  const credentials = Boolean(process.env.EDFAPAY_API_KEY?.trim());
  const callbackOrigin = customerPaymentOrigin(process.env) !== null;
  const redirectOrigin = environment
    ? hasEdfaPayCheckoutRedirectOrigin(process.env, environment)
    : false;
  const configured =
    (mode === 'sandbox' || mode === 'live') &&
    credentials &&
    baseUrl !== null &&
    environment === mode &&
    callbackOrigin &&
    redirectOrigin;

  return {
    configured,
    detail: `EdfaPay · ${mode}`,
    verificationNote: configured
      ? 'الإعداد العام صالح؛ يتحقق Admin من API للقراءة فقط، ويبقى سر webhook ودليله في Customer.'
      : 'وضع الدفع أو مفتاح API أو عناوين EdfaPay والعودة غير مكتملة.',
  };
}

function storageConfiguration(): {
  configured: boolean;
  provider: string;
  liveProbeSupported: boolean;
} {
  const provider = process.env.STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === 'vercel-blob') {
    return {
      configured: Boolean(
        process.env.BLOB_READ_WRITE_TOKEN?.trim() ||
        (process.env.BLOB_STORE_ID?.trim() &&
          process.env.VERCEL_OIDC_TOKEN?.trim()),
      ),
      provider: 'Vercel Blob · مخزن خاص',
      liveProbeSupported: true,
    };
  }
  if (provider === 'supabase') {
    return {
      configured: Boolean(
        process.env.SUPABASE_URL?.trim() &&
        process.env.SUPABASE_SERVICE_ROLE_KEY?.trim(),
      ),
      provider: 'Supabase Storage · حاوية خاصة',
      liveProbeSupported: true,
    };
  }
  if (provider === 'filesystem') {
    return {
      configured: Boolean(
        process.env.EVIDENCE_LOCAL_ROOT?.trim() &&
        path.isAbsolute(process.env.EVIDENCE_LOCAL_ROOT.trim()),
      ),
      provider: 'Hostinger VPS · volume خاص دائم',
      liveProbeSupported: true,
    };
  }
  if (provider === 'local' && process.env.NODE_ENV !== 'production') {
    return {
      configured: true,
      provider: 'تخزين محلي خاص · تطوير فقط',
      liveProbeSupported: false,
    };
  }
  return {
    configured: false,
    provider: 'موفر التخزين الخاص غير محدد',
    liveProbeSupported: false,
  };
}

/**
 * Returns an admin-only, secret-free snapshot. A configured adapter is never
 * presented as verified unless this request completed a safe live probe.
 */
export async function safeIntegrationStatuses(): Promise<
  SafeIntegrationStatus[]
> {
  const ai = aiConfiguration();
  const payments = paymentConfiguration();
  const storage = storageConfiguration();
  const smsConfigured = twilioSmsConfigured();
  const shippingProvider = safeIdentifier(
    process.env.SHIPPING_PROVIDER,
    'mock',
  );
  const otoShipping = otoFulfillmentStatus();

  const [database, storageVerified, smsVerified] = await Promise.all([
    databaseVerified(),
    storage.configured && storage.liveProbeSupported
      ? privateEvidenceStorageReady()
      : Promise.resolve(false),
    smsConfigured ? twilioSmsReady() : Promise.resolve(false),
  ]);

  return [
    {
      id: 'ai',
      label: 'نماذج الذكاء الاصطناعي',
      configured: ai.configured,
      verified: false,
      detail: ai.detail,
      verificationNote: ai.verificationNote,
    },
    {
      id: 'payments',
      label: 'الدفع',
      configured: payments.configured,
      verified: false,
      detail: payments.detail,
      verificationNote: payments.verificationNote,
    },
    {
      id: 'shipping',
      label: 'الشحن',
      configured: otoShipping.operationalConfigured,
      verified: false,
      detail: otoShipping.operationalConfigured
        ? 'OTO · إنشاء شحنة وAWB وتتبع موقع مهيأة؛ يلزم فحص حي'
        : otoShipping.configured
          ? 'OTO · مقارنة أسعار فقط؛ Webhook الموقع غير مكتمل'
          : otoShipping.enabled
            ? 'OTO · إعداد مقارنة الأسعار ناقص؛ إنشاء الشحنات مغلق'
            : `${shippingProvider} · لا يوجد موصل ناقل خارجي مكتمل`,
      verificationNote: otoShipping.operationalConfigured
        ? 'الإعداد صالح بنيوياً فقط؛ لا يصبح Verified قبل طلب Preview وشحنة تجريبية وWebhook صحيح.'
        : otoShipping.configured
          ? 'يلزم OTO_WEBHOOK_AUTH_KEY وOTO_WEBHOOK_SECRET قبل أي كتابة شحن.'
          : otoShipping.enabled
            ? 'يلزم OTO_REFRESH_TOKEN خادمي صالح في Vercel مع بقاء OTO_AUTO_CREATE_SHIPMENT وSHIPMENT_AUTO_CREATE على false.'
            : 'ملصق RAFRAF_INTERNAL ليس دليلاً من ناقل ولا يثبت التسليم.',
    },
    {
      id: 'storage',
      label: 'تخزين الأدلة',
      configured: storage.configured,
      verified: storageVerified,
      detail: storage.provider,
      verificationNote: storageVerified
        ? 'تم التحقق من الخصوصية والحجم وأنواع الملفات في هذا الطلب.'
        : storage.liveProbeSupported
          ? 'لم يثبت فحص الحاوية الخاصة وسياسة الملفات.'
          : 'التخزين المحلي للتطوير لا يملك فحص حاوية خارجية قابلاً للإثبات.',
    },
    {
      id: 'sms',
      label: 'رسائل SMS',
      configured: smsConfigured,
      verified: smsVerified,
      detail: 'Twilio Programmable Messaging · مرسل خادمي',
      verificationNote: smsVerified
        ? 'تحقق الحساب من خدمة الإرسال أو رقم المرسل في هذا الطلب.'
        : 'لم يثبت اتصال حي بخدمة الإرسال أو المرسل.',
    },
    {
      id: 'database',
      label: 'قاعدة البيانات',
      configured: Boolean(process.env.DATABASE_URL?.trim()),
      verified: database,
      detail: process.env.NEON_BRANCH_ID?.trim()
        ? 'PostgreSQL / Neon · هوية فرع محددة في الإعداد'
        : 'PostgreSQL / Neon · هوية الفرع غير محددة',
      verificationNote: database
        ? 'نجح استعلام اتصال للقراءة في هذا الطلب.'
        : 'لم ينجح استعلام الاتصال للقراءة.',
    },
  ];
}
