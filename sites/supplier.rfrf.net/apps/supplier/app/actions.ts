'use server';

/**
 * بوابة الموردين — تسجيل منشأة + تقديم عرض خام.
 * سرية صارمة (BUSINESS_RULES): المورد لا يرى بيانات العميل ولا عروض الموردين
 * الآخرين. سعر المورد يُخزَّن مؤقتاً كـfinalPrice بحالة DRAFT — يُعاد تسعيره
 * بالهامش من لوحة العمليات قبل أي عرض على العميل (العميل يرى ACTIVE فما فوق).
 */

import { redirect } from 'next/navigation';
import { cookies, headers } from 'next/headers';
import { requestIpSubject } from '@rafraf/shared/security/request-subject';
import { verifyTurnstileToken } from '@rafraf/shared/security/turnstile';
import { sendTwilioVerification } from '@rafraf/shared/twilio-verify';
import { getSessionSupplierId } from '../lib/session';
import {
  SUPPLIER_OTP_COOKIE,
  SUPPLIER_OTP_TTL_SECONDS,
  createSupplierOtpChallenge,
  supplierOtpSubjectKey,
} from '../lib/supplier-otp';
import {
  supplierLocalOtpEnabled,
  supplierOtpAuditChannel,
  supplierOtpSecurityConfigured,
  supplierOtpSecurityReady,
} from '../lib/supplier-otp-delivery';
import {
  SUPPLIER_REGISTRATION_COOKIE,
  createSupplierRegistrationDraft,
  normalizeSupplierRegistrationInput,
  supplierRegistrationCookieOptions,
} from '../lib/supplier-registration-draft';
import { normalizeSupplierPhone } from '../lib/supplier-phone';
import { reserveSupplierTurnstileSiteverify } from '../lib/turnstile-quota';
import {
  SupplierRegistrationQuotaExceededError,
  reserveSupplierRegistrationQuota,
} from '../lib/public-registration-quota';
import { revalidatePath } from 'next/cache';
import { prisma, ActorType, Prisma, QuoteStatus } from '@rafraf/db';
import { isPartCommerceRestricted } from '@rafraf/shared/product-os/part-restriction';
import { resolveSupplierRfqScope } from '@rafraf/shared/product-os/sourcing-market';
import { canSupplierReceiveRfqs } from '@rafraf/shared';

function quoteCode(): string {
  return `SQ-${Math.floor(100000 + Math.random() * 900000)}`;
}

function safeQuoteReturnPath(fd: FormData): '/' | '/quotes' {
  return String(fd.get('returnTo') ?? '') === '/quotes' ? '/quotes' : '/';
}

/** رجوع لواجهة المورد مع رسالة (redirect يرمي — لا يُكمل التنفيذ بعده). */
function back(path: '/' | '/quotes', q: string): never {
  redirect(`${path}?${q}`);
}

type RegistrationQuotaResult = { reserved: true } | { rateLimited: true };

/** يحجز طلب التسجيل ويرسل OTP؛ إنشاء المنشأة مؤجل حتى إثبات الهاتف. */
export async function registerSupplier(fd: FormData): Promise<void> {
  const normalizedInput = normalizeSupplierRegistrationInput(
    fd.get('businessName'),
    fd.get('city'),
    fd.get('countryCode'),
    fd.get('legalRegistrationNumber'),
  );
  const phone = normalizeSupplierPhone(fd.get('phone'));

  if (!normalizedInput.ok) {
    redirect(`/?register=1&err=${normalizedInput.field}`);
  }
  if (!phone) redirect('/?register=1&err=phone');
  if (!supplierOtpSecurityConfigured()) {
    redirect('/?register=1&err=verification');
  }

  const headerStore = await headers();
  const ipSubject = requestIpSubject(headerStore);
  const humanProof = await verifyTurnstileToken({
    token: fd.get('turnstileToken'),
    expectedAction: 'supplier_register',
    reserveSiteverify: () => reserveSupplierTurnstileSiteverify(ipSubject),
  });
  if (!humanProof.ok) redirect('/?register=1&err=verification');

  if (!ipSubject) redirect('/?register=1&err=verification');
  const phoneKey = supplierOtpSubjectKey('phone', phone);
  const ipKey = supplierOtpSubjectKey('ip', ipSubject);

  // الحجز والعد داخل معاملة واحدة بعد التحقق البشري وقبل أي استدعاء خارجي.
  let quota: RegistrationQuotaResult | null = null;
  for (let attempt = 0; attempt < 3 && !quota; attempt += 1) {
    try {
      quota = await prisma.$transaction(
        async (tx): Promise<RegistrationQuotaResult> => {
          await reserveSupplierRegistrationQuota(
            {
              acquireLock: async (lockKey) => {
                await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
              },
              count: ({ action, entityType, entityId, since }) =>
                tx.auditLog.count({
                  where: {
                    action,
                    entityType,
                    entityId,
                    createdAt: { gte: since },
                  },
                }),
              reserve: async (reservations) => {
                await tx.auditLog.createMany({
                  data: reservations.map((reservation) => ({
                    actorType: ActorType.SYSTEM,
                    action: reservation.action,
                    entityType: reservation.entityType,
                    entityId: reservation.entityId,
                    after: {
                      dimension: reservation.dimension,
                      reservation: true,
                    },
                  })),
                });
              },
            },
            { phoneSubject: phoneKey, ipSubject: ipKey },
          );
          return { reserved: true };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      if (error instanceof SupplierRegistrationQuotaExceededError) {
        quota = { rateLimited: true };
        break;
      }
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2034';
      if (retryable && attempt < 2) continue;
      console.error('[auth:supplier] registration quota unavailable', {
        code: 'SUPPLIER_REGISTRATION_QUOTA_ERROR',
        error: error instanceof Error ? error.message : String(error),
      });
      redirect('/?register=1&err=save');
    }
  }

  if (!quota) redirect('/?register=1&err=save');
  if ('rateLimited' in quota) redirect('/?register=1&err=rate');

  if (!(await supplierOtpSecurityReady())) {
    redirect('/?register=1&err=verification');
  }
  const challenge = createSupplierOtpChallenge(phone);
  const draft = createSupplierRegistrationDraft({
    businessName: normalizedInput.businessName,
    city: normalizedInput.city,
    countryCode: normalizedInput.countryCode,
    legalRegistrationNumber: normalizedInput.legalRegistrationNumber,
    phone,
  });
  const localDelivery = supplierLocalOtpEnabled();
  const delivered = localDelivery || (await sendTwilioVerification(phone));
  await prisma.auditLog.create({
    data: {
      actorType: ActorType.SYSTEM,
      action: delivered
        ? 'supplier.registration.otp_delivered'
        : 'supplier.registration.otp_delivery_failed',
      entityType: 'supplier_registration',
      entityId: phoneKey,
      after: {
        provider: localDelivery ? 'LOCAL' : 'TWILIO_VERIFY',
        channel: supplierOtpAuditChannel(),
      },
    },
  });
  if (!delivered) redirect('/?register=1&err=delivery');

  const cookieStore = await cookies();
  cookieStore.set(SUPPLIER_OTP_COOKIE, challenge.cookie, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: SUPPLIER_OTP_TTL_SECONDS,
  });
  cookieStore.set(
    SUPPLIER_REGISTRATION_COOKIE,
    draft.cookie,
    supplierRegistrationCookieOptions(),
  );
  redirect('/login?step=verify&registration=1');
}

type QuoteSubmitResult =
  { ok: true; rfqCode: string } | { ok: false; reason: 'auth' | 'rfq' | 'dup' };

/** تقديم عرض مورد خام على بند مؤهل داخل طلب تسعير مفتوح. */
export async function submitSupplierQuote(fd: FormData): Promise<void> {
  const returnTo = safeQuoteReturnPath(fd);
  const supplierId = await getSessionSupplierId();
  const rfqId = String(fd.get('rfqId') ?? '');
  const rfqItemId = String(fd.get('rfqItemId') ?? '');
  if (!supplierId || !rfqId || !rfqItemId) redirect(returnTo);

  const supplierPrice = Number(String(fd.get('supplierPrice') ?? '').trim());
  const deliveryDays = Number(String(fd.get('deliveryDays') ?? '').trim());
  const warrantyMonths = Number(String(fd.get('warrantyMonths') ?? '0').trim());
  const condition = String(fd.get('condition') ?? '')
    .trim()
    .slice(0, 60);

  if (!Number.isFinite(supplierPrice) || supplierPrice <= 0)
    back(returnTo, 'err=price');
  if (!Number.isInteger(deliveryDays) || deliveryDays < 1 || deliveryDays > 365)
    back(returnTo, 'err=days');
  if (
    !Number.isInteger(warrantyMonths) ||
    warrantyMonths < 0 ||
    warrantyMonths > 120
  )
    back(returnTo, 'err=warranty');

  let result: QuoteSubmitResult | null = null;

  for (let attempt = 0; attempt < 3 && !result; attempt += 1) {
    try {
      result = await prisma.$transaction(
        async (tx): Promise<QuoteSubmitResult> => {
          const [supplier, item, existing] = await Promise.all([
            tx.supplier.findUnique({
              where: { id: supplierId },
              select: { id: true, status: true, countryCode: true },
            }),
            tx.rFQItem.findUnique({
              where: { id: rfqItemId },
              include: {
                rfq: { select: { id: true, code: true, status: true } },
                part: {
                  select: {
                    isRestricted: true,
                    sensitivity: true,
                    category: {
                      select: { isRestricted: true, sensitivity: true },
                    },
                  },
                },
              },
            }),
            tx.quote.findFirst({
              where: { supplierId, rfqItemId },
              select: { id: true },
            }),
          ]);

          if (!supplier || !canSupplierReceiveRfqs(supplier.status))
            return { ok: false, reason: 'auth' };
          const scope = resolveSupplierRfqScope(supplier.countryCode);
          if (
            !scope ||
            !item ||
            item.rfq.id !== rfqId ||
            item.rfq.status !== scope.rfqStatus ||
            !item.partId ||
            item.fitmentConfidence == null ||
            item.fitmentConfidence < 0.85 ||
            item.humanReviewRequired ||
            isPartCommerceRestricted(item.part)
          )
            return { ok: false, reason: 'rfq' };
          if (existing) return { ok: false, reason: 'dup' };

          const quote = await tx.quote.create({
            data: {
              code: quoteCode(),
              rfqItemId,
              supplierId,
              sourceType: scope.quoteSourceType,
              partId: item.partId,
              finalPrice: new Prisma.Decimal(supplierPrice),
              deliveryDaysMin: deliveryDays,
              deliveryDaysMax: deliveryDays,
              warrantyMonths,
              status: QuoteStatus.DRAFT,
              fitmentConfidence: null,
            },
          });

          await tx.auditLog.create({
            data: {
              actorType: ActorType.SUPPLIER,
              actorId: supplierId,
              action: 'supplier.quote.submitted',
              entityType: 'quote',
              entityId: quote.id,
              after: {
                rfqCode: item.rfq.code,
                supplierPrice,
                deliveryDays,
                warrantyMonths,
                condition: condition || null,
                partId: item.partId,
                fitmentConfidence: item.fitmentConfidence,
              },
            },
          });

          return { ok: true, rfqCode: item.rfq.code };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (error) {
      const retryable =
        error instanceof Prisma.PrismaClientKnownRequestError &&
        (error.code === 'P2034' || error.code === 'P2002');
      if (retryable && attempt < 2) continue;
      console.error('submitSupplierQuote failed:', error);
      back(returnTo, 'err=save');
    }
  }

  if (!result) back(returnTo, 'err=save');
  if (!result.ok) {
    if (result.reason === 'auth') redirect(returnTo);
    back(returnTo, `err=${result.reason}`);
  }

  revalidatePath('/');
  revalidatePath('/quotes');
  redirect(`${returnTo}?ok=${encodeURIComponent(result.rfqCode)}`);
}
