import { PaymentStatus, prisma } from '@rafraf/db';
import { randomUUID } from 'node:crypto';
import {
  isPaymentProviderError,
  PaymentProviderError,
} from '@rafraf/shared/payments/payment-provider';
import { EDFAPAY_V1_CURRENCY } from '@rafraf/shared/payments/edfapay-hosted';
import {
  ACTIVE_PAYMENT_INTAKE_STATUSES,
  CHECKOUT_OUTCOME_REJECTED,
  CHECKOUT_OUTCOME_UNKNOWN,
  orderPaymentIntakeLockKey,
} from '@rafraf/shared/payments/payment-intake';
import { isOrderPayable } from '@rafraf/shared/payments/payment-state';
import { NextResponse, type NextRequest } from 'next/server';
import {
  TapSupabaseProvider,
  tapSupabaseProviderFromEnv,
  isTapBridgeRedirect,
} from '../../../../../lib/payments/tap-supabase-provider';
import { edfaPayProviderFromEnv } from '../../../../../lib/payments/edfapay-provider';
import { paymentLaunchStatus } from '../../../../../lib/payments/payment-launch';
import { customerEdfaPayRuntimeReadiness } from '../../../../../lib/payments/edfapay-runtime-readiness';
import {
  hasRealCustomerName,
  normalizeCustomerEmail,
} from '../../../../../lib/customer-profile';
import {
  customerPaymentOrigin,
  isAllowedCheckoutRedirect,
} from '../../../../../lib/payment-urls';
import { getSessionCustomerId } from '../../../../../lib/session';
import { loadPaymentIntakeEligibilityBlockReason } from '../../../../../lib/payments/payment-intake-eligibility';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * بدء دفعة على Checkout المستضاف لطلب يملكه العميل.
 *
 * يعيد رابط صفحة مزوّد الدفع المحدد فقط؛ لا تلمس المنصة بيانات البطاقة إطلاقاً.
 * البيانات المعادة للعميل هي مبلغ طلبه النهائي وحده — لا تكلفة مورد ولا
 * هامش ولا أي اقتصاديات داخلية (BUSINESS_RULES القاعدة 2).
 */

const ORDER_CODE_PATTERN = /^ORD-[A-Z0-9-]{3,32}$/;

class ActivePaymentExists extends Error {}
class CheckoutOrderMissing extends Error {}
class CheckoutOrderNotPayable extends Error {}
class CheckoutCurrencyUnsupported extends Error {}
class CheckoutEmailRequired extends Error {}
class CheckoutPhoneRequired extends Error {}
class CheckoutCustomerNameRequired extends Error {}
class CheckoutShippingAddressRequired extends Error {}
class CheckoutOrderPolicyBlocked extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function clientIp(request: NextRequest): string {
  const forwarded = request.headers.get('x-forwarded-for');
  const first = forwarded?.split(',')[0]?.trim();
  return first || request.headers.get('x-real-ip')?.trim() || '127.0.0.1';
}

function splitName(fullName: string): { first: string; last: string } {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { first: 'Customer', last: 'Rafraf' };
  if (parts.length === 1) return { first: parts[0]!, last: parts[0]! };
  return { first: parts[0]!, last: parts.slice(1).join(' ') };
}

export async function POST(request: NextRequest) {
  const customerId = await getSessionCustomerId();
  if (!customerId)
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });

  if (!paymentLaunchStatus(process.env).checkoutAllowed)
    return NextResponse.json(
      { error: 'payment_unavailable', retryable: false },
      { status: 503 },
    );

  const provider =
    process.env.PAYMENT_PROVIDER?.trim().toLowerCase() === 'tap'
      ? tapSupabaseProviderFromEnv()
      : edfaPayProviderFromEnv();
  let paymentReady = false;
  try {
    paymentReady =
      provider instanceof TapSupabaseProvider
        ? await provider.ready()
        : (await customerEdfaPayRuntimeReadiness(process.env)).ready;
  } catch {
    /* Readiness failure must keep intake closed. */
  }
  if (!paymentReady)
    return NextResponse.json(
      { error: 'payment_unavailable', retryable: true },
      { status: 503 },
    );

  const baseUrl = customerPaymentOrigin(process.env);
  if (!baseUrl)
    return NextResponse.json(
      { error: 'payment_unavailable', retryable: true },
      { status: 503 },
    );

  const origin = request.headers.get('origin');
  if (origin && origin !== baseUrl)
    return NextResponse.json({ error: 'origin' }, { status: 403 });

  if (!provider)
    return NextResponse.json(
      { error: 'payment_unavailable', retryable: true },
      { status: 503 },
    );

  let body: { orderCode?: unknown };
  try {
    body = (await request.json()) as { orderCode?: unknown };
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });
  }

  const orderCode =
    typeof body.orderCode === 'string'
      ? body.orderCode.trim().toUpperCase()
      : '';
  if (!ORDER_CODE_PATTERN.test(orderCode))
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 });

  // لا نكشف وجود طلب لعميل آخر، ثم نعيد فحص الملكية تحت قفل الصف.
  const ownedOrder = await prisma.order.findFirst({
    where: { code: orderCode, customerId },
    select: { id: true },
  });
  if (!ownedOrder) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }

  const checkout = await prisma
    .$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`order-financial-resolution:${ownedOrder.id}`}))`;
      const intakeLock = orderPaymentIntakeLockKey(ownedOrder.id);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${intakeLock}))`;

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT "id"
        FROM "orders"
        WHERE "id" = ${ownedOrder.id} AND "customerId" = ${customerId}
        FOR UPDATE
      `;
      if (!locked[0]) throw new CheckoutOrderMissing();

      const order = await tx.order.findFirst({
        where: { id: ownedOrder.id, customerId },
        select: {
          id: true,
          code: true,
          status: true,
          totalAmount: true,
          currency: true,
          shippingAddress: true,
          customer: {
            select: {
              fullName: true,
              city: true,
              user: { select: { email: true, phone: true } },
              addresses: {
                orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }],
                take: 1,
                select: {
                  id: true,
                  city: true,
                  district: true,
                  street: true,
                  buildingNumber: true,
                  postalCode: true,
                  additionalNumber: true,
                  unitNumber: true,
                },
              },
            },
          },
          payments: {
            where: { status: { in: [...ACTIVE_PAYMENT_INTAKE_STATUSES] } },
            select: { id: true },
            take: 1,
          },
        },
      });
      if (!order) throw new CheckoutOrderMissing();
      if (order.payments.length > 0) throw new ActivePaymentExists();
      if (!isOrderPayable(order.status)) throw new CheckoutOrderNotPayable();
      // Hosted v1 is contractually bound to SAR. Reject before creating a
      // payment or calling the provider so ledger currency can never drift.
      if (order.currency !== EDFAPAY_V1_CURRENCY) {
        throw new CheckoutCurrencyUnsupported();
      }
      const policyBlock = await loadPaymentIntakeEligibilityBlockReason(
        tx,
        order.id,
      );
      if (policyBlock) throw new CheckoutOrderPolicyBlocked(policyBlock);

      const email = normalizeCustomerEmail(order.customer.user.email);
      if (!email) throw new CheckoutEmailRequired();
      const phone = order.customer.user.phone;
      if (!phone) throw new CheckoutPhoneRequired();

      // الاسم يُرسَل إلى بوابة الدفع مقسوماً وإلى عنوان الشحن، ويظهر لاحقاً في
      // الفاتورة الضريبية. تمرير الاسم المؤقت هنا يُنشئ سجلاً خارجياً باسم لا
      // يخصّ أحداً — وهو ما كان يمرّ بلا حارس بينما البريد محروس.
      if (!hasRealCustomerName(order.customer.fullName)) {
        throw new CheckoutCustomerNameRequired();
      }

      let shippingAddress = order.shippingAddress;
      if (!shippingAddress) {
        const address = order.customer.addresses[0];
        if (!address) throw new CheckoutShippingAddressRequired();
        shippingAddress = {
          sourceAddressId: address.id,
          name: order.customer.fullName,
          phone,
          email,
          address: [
            address.buildingNumber,
            address.street,
            address.district,
            address.additionalNumber,
            address.unitNumber,
          ]
            .filter(Boolean)
            .join('، '),
          district: address.district,
          city: address.city,
          country: 'SA',
          postcode: address.postalCode,
        };
        await tx.order.update({
          where: { id: order.id },
          data: { shippingAddress },
        });
      }

      const providerOrderCode = `RF-${randomUUID().replaceAll('-', '').slice(0, 24).toUpperCase()}`;
      const payment = await tx.payment.create({
        data: {
          orderId: order.id,
          provider: provider.name,
          status: PaymentStatus.PENDING,
          amount: order.totalAmount,
          currency: order.currency,
          providerOrderCode,
        },
        select: { id: true },
      });
      return {
        ok: true as const,
        order,
        email,
        phone,
        payment: { id: payment.id, providerOrderCode },
      };
    })
    .catch((error: unknown) => {
      if (error instanceof ActivePaymentExists || isUniqueViolation(error)) {
        return {
          ok: false as const,
          error: 'already_paid' as const,
          status: 409,
        };
      }
      if (error instanceof CheckoutOrderNotPayable) {
        return {
          ok: false as const,
          error: 'order_not_payable' as const,
          status: 409,
        };
      }
      if (error instanceof CheckoutCurrencyUnsupported) {
        return {
          ok: false as const,
          error: 'unsupported_currency' as const,
          status: 422,
        };
      }
      if (error instanceof CheckoutEmailRequired) {
        return {
          ok: false as const,
          error: 'email_required' as const,
          status: 422,
        };
      }
      if (error instanceof CheckoutPhoneRequired) {
        return {
          ok: false as const,
          error: 'phone_required' as const,
          status: 422,
        };
      }
      if (error instanceof CheckoutCustomerNameRequired) {
        return {
          ok: false as const,
          error: 'customer_name_required' as const,
          status: 422,
        };
      }
      if (error instanceof CheckoutShippingAddressRequired) {
        return {
          ok: false as const,
          error: 'shipping_address_required' as const,
          status: 422,
        };
      }
      if (error instanceof CheckoutOrderPolicyBlocked) {
        return {
          ok: false as const,
          error: 'order_not_eligible' as const,
          status: 409,
        };
      }
      if (error instanceof CheckoutOrderMissing) {
        return {
          ok: false as const,
          error: 'not_found' as const,
          status: 404,
        };
      }
      throw error;
    });

  if (!checkout.ok) {
    return NextResponse.json(
      { error: checkout.error },
      { status: checkout.status },
    );
  }

  const { order, email, phone, payment } = checkout;
  const name = splitName(order.customer.fullName);
  const city = order.customer.city?.trim() || 'Riyadh';
  const amount = order.totalAmount.toFixed(2);

  try {
    const authorizationRequest = {
      orderCode: payment.providerOrderCode,
      money: { amount, currency: order.currency },
      description: `Rafraf order ${order.code}`,
      payer: {
        firstName: name.first,
        lastName: name.last,
        email,
        phone,
        city,
        country: 'SA',
        address: city,
        zip: '00000',
        ip: clientIp(request),
      },
      // Both success and failure return to the same neutral surface. The
      // browser redirect never decides money state; the page renders only the
      // persisted result of signed callback + authenticated status handling.
      returnUrl: `${baseUrl}/track?code=${encodeURIComponent(order.code)}&paymentReturn=1`,
      notificationUrl: `${baseUrl}/api/payments/${provider.name === 'TAP' ? 'tap' : 'edfapay'}/webhook`,
    };
    const authorized =
      provider instanceof TapSupabaseProvider
        ? await provider.authorize(authorizationRequest, {
            id: order.id,
            code: order.code,
          })
        : await provider.authorize(authorizationRequest);

    if (authorized.externalRef) {
      await prisma.payment.updateMany({
        where: { id: payment.id, status: PaymentStatus.PENDING },
        data: { externalRef: authorized.externalRef },
      });
    }

    if (
      !authorized.redirectUrl ||
      !(provider.name === 'TAP'
        ? isTapBridgeRedirect(authorized.redirectUrl)
        : isAllowedCheckoutRedirect(authorized.redirectUrl, process.env))
    ) {
      throw new PaymentProviderError(
        provider.name,
        'provider_redirect_not_allowed',
        true,
      );
    }

    await prisma.auditLog.create({
      data: {
        actorId: customerId,
        actorType: 'CUSTOMER',
        action: 'payment.checkout.started',
        entityType: 'payment',
        entityId: payment.id,
        after: { orderCode: order.code, provider: provider.name },
      },
    });

    return NextResponse.json(
      { redirectUrl: authorized.redirectUrl },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (error) {
    const retryable = isPaymentProviderError(error) ? error.retryable : true;

    // مهلة الشبكة قد تعني أن المزوّد قبل الطلب ولم يصل الرد. إبقاء الصف
    // PENDING يمنع تحصيلاً ثانياً حتى تتم المصالحة؛ الرفض القطعي وحده FAILED.
    await prisma.payment.updateMany({
      where: { id: payment.id, status: PaymentStatus.PENDING },
      data: retryable
        ? { failureCode: CHECKOUT_OUTCOME_UNKNOWN }
        : {
            status: PaymentStatus.FAILED,
            failureCode: CHECKOUT_OUTCOME_REJECTED,
          },
    });

    console.error('[payments:edfapay] checkout failed', {
      code: retryable ? 'CHECKOUT_OUTCOME_UNKNOWN' : 'CHECKOUT_REJECTED',
      retryable,
    });
    return NextResponse.json(
      { error: 'payment_failed', retryable },
      { status: retryable ? 503 : 502 },
    );
  }
}
