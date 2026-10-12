import { prisma } from '@rafraf/db';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Printer } from 'lucide-react';
import {
  updateRfqStatus,
  verifyOrderFitment,
  releaseOrderEscrow,
} from '../../actions';
import {
  buildCustomerMessage,
  sendQuotes,
} from '../../quote-messaging-actions';
import {
  approveFitmentReview,
  linkPartToItem,
} from '../../quote-write-actions';
import { twilioSmsConfigured } from '@rafraf/shared/twilio-sms';
import { QuoteForm } from './quote-form';
import { CopyBox } from './copy-box';
import { GlobalSourcingPanel } from './global-sourcing-panel';
import { ShippingRatePanel } from './shipping-rate-panel';
import { OtoShipmentForm } from './oto-shipment-form';
import { RfqQuoteList } from './rfq-quote-list';
import { ManualPaymentForm } from './manual-payment-form';
import { ManualShipmentForm } from './manual-shipment-form';
import { CompliancePanel } from './compliance-panel';
import { requireAdminPermission } from '../../../lib/require-admin-session';
import { loadAdminRfqDetail } from '../../../lib/admin-rfq-detail';
import {
  RFQ_TRANSITIONS,
  type RfqState,
} from '@rafraf/shared/workflow/rfq-state';
import { globalDiscoveryProviderStatuses } from '../../../lib/global-sourcing/provider-registry';
import { otoFulfillmentStatus } from '../../../lib/shipping/oto';
import {
  ar,
  ORDER_STATUS_AR,
  PAYMENT_STATUS_AR,
} from '../../../lib/admin-labels';

export const dynamic = 'force-dynamic';

/** تسمية عربية لكل حالة RFQ تظهر في قائمة تغيير الحالة. */
const RFQ_STATUS_AR: Record<RfqState, string> = {
  DRAFT: 'جديد',
  NEED_MORE_INFO: 'ناقص بيانات',
  FITMENT_REVIEW: 'مراجعة توافق',
  SOURCING_LOCAL: 'بحث محلي',
  SOURCING_GLOBAL: 'بحث دولي',
  QUOTES_READY: 'عروض جاهزة',
  CUSTOMER_SELECTED: 'اختار العميل',
  CONVERTED_TO_ORDER: 'حُوّل لطلب',
  CANCELLED: 'ملغى',
};

export default async function RfqDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const admin = await requireAdminPermission('OPERATIONS_READ');
  const canChangeRfq = admin.permissions.includes('RFQ_WRITE');
  const canWriteCatalog = admin.permissions.includes('CATALOG_WRITE');
  const canApproveFitment = admin.permissions.includes('FITMENT_APPROVE');
  const canWriteQuotes = admin.permissions.includes('QUOTE_WRITE');
  const canCopyMessage = admin.permissions.includes('MESSAGING_SEND');
  // The send affordance additionally needs a configured sender: the action
  // records a `configuration` rejection and returns void, so an operator
  // clicking a button with no channel would see nothing at all.
  const canSendMessages = canCopyMessage && twilioSmsConfigured();
  const canManagePayments = admin.permissions.includes('PAYMENT_WRITE');
  const canCreateShipments = admin.permissions.includes('SHIPMENT_WRITE');
  const { id } = await params;
  const rfq = await loadAdminRfqDetail(id);
  if (!rfq) notFound();
  const item = rfq.items[0];
  const rec = item?.recommendations[0];
  const order = rfq.orders[0];
  const globalSourcingProviders = globalDiscoveryProviderStatuses();
  const otoShipping = otoFulfillmentStatus();
  const defaultGlobalQuery = (item?.oemNumber ?? item?.freeTextAr ?? '')
    .replaceAll('*', ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 100);
  const customerMsg =
    item && item.quotes.length ? await buildCustomerMessage(rfq.id) : '';
  const lastSend = await prisma.auditLog.findFirst({
    where: {
      entityType: 'rfq',
      entityId: rfq.id,
      action: { startsWith: 'customer.notification.' },
    },
    orderBy: { createdAt: 'desc' },
  });

  // اقتراح من الكتالوج: أول كلمتين طويلتين (≥3 أحرف) من نص الطلب ← contains
  const suggestWords =
    item && !order && !item.partId && item.freeTextAr
      ? item.freeTextAr
          .split(/\s+/)
          .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
          .filter((w) => w.length >= 3)
          .slice(0, 2)
      : [];
  const partSuggestions = suggestWords.length
    ? await prisma.part.findMany({
        where: { OR: suggestWords.map((w) => ({ nameAr: { contains: w } })) },
        include: {
          category: true,
          _count: { select: { compatibilities: true } },
        },
        take: 5,
        orderBy: { nameAr: 'asc' },
      })
    : [];
  // Conversion is a customer approval transaction, not a manual status edit.
  const nextStatuses = RFQ_TRANSITIONS[rfq.status as RfqState].filter(
    (status) => status !== 'CONVERTED_TO_ORDER',
  );
  return (
    <main className="ops-main">
      <header className="topbar">
        <div>
          <Link href="/" className="back">
            ← مركز القيادة
          </Link>
          <h1 className="mono">{rfq.code}</h1>
          <p className="sub">
            {rfq.customer.fullName} ·{' '}
            <span dir="ltr">{rfq.customer.user.phone}</span>
          </p>
        </div>
        {canChangeRfq && nextStatuses.length ? (
          <form action={updateRfqStatus} className="status-form">
            <input type="hidden" name="rfqId" value={rfq.id} />
            {/* الخيارات مشتقّة من خريطة الانتقالات، فلا يعرض المشغّل خياراً
                  سيرفضه الحارس في الإجراء. الحالة الحالية تظهر معطّلة كمرجع. */}
            <select name="status" defaultValue={rfq.status}>
              <option value={rfq.status} disabled>
                {RFQ_STATUS_AR[rfq.status as RfqState]} (الحالية)
              </option>
              {nextStatuses.map((next) => (
                <option key={next} value={next}>
                  {RFQ_STATUS_AR[next]}
                </option>
              ))}
            </select>
            <button type="submit">تحديث الحالة</button>
          </form>
        ) : (
          <p className="sub">
            {RFQ_STATUS_AR[rfq.status as RfqState]} —{' '}
            {nextStatuses.length
              ? 'عرض فقط؛ تغيير الحالة يحتاج RFQ_WRITE.'
              : 'حالة نهائية، لا تغيير بعدها.'}
          </p>
        )}
      </header>

      <section className="detail-grid">
        <div className="card-block">
          <h2>الطلب</h2>
          <dl className="facts">
            <div>
              <dt>القطعة</dt>
              <dd>{item?.freeTextAr ?? '—'}</dd>
            </div>
            <div>
              <dt>OEM</dt>
              <dd className="mono">{item?.oemNumber ?? '—'}</dd>
            </div>
            <div>
              <dt>المركبة</dt>
              <dd>
                {rfq.vehicle
                  ? `${rfq.vehicle.make} ${rfq.vehicle.model} ${rfq.vehicle.year}`
                  : '—'}
              </dd>
            </div>
            <div>
              <dt>VIN</dt>
              <dd className="mono">{rfq.vehicle?.vin ?? '—'}</dd>
            </div>
            <div>
              <dt>القناة</dt>
              <dd>{rfq.channel === 'WEB' ? 'الموقع' : rfq.channel}</dd>
            </div>
            <div>
              <dt>ملاحظات</dt>
              <dd>{rfq.notes ?? '—'}</dd>
            </div>
          </dl>
          {rfq.evidence.length ? (
            <div className="evidence">
              {rfq.evidence.map((e) =>
                e.type === 'IMAGE' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={e.id}
                    src={`/api/rfq-evidence/${encodeURIComponent(e.id)}`}
                    alt="دليل مرفق"
                  />
                ) : null,
              )}
            </div>
          ) : null}

          {item ? (
            <>
              <h2 style={{ marginTop: '1.1rem' }}>اقتراح من الكتالوج</h2>
              {item.part ? (
                <div>
                  <p className="selected-note">
                    ✓ مربوطة بقطعة الكتالوج: {item.part.nameAr}
                    {item.fitmentConfidence != null
                      ? ` — التوافق ${Math.round(item.fitmentConfidence * 100)}%`
                      : ' — بلا توافق موثق للمركبة'}
                  </p>
                  {item.humanReviewRequired && canApproveFitment ? (
                    <form action={approveFitmentReview} className="status-form">
                      <input type="hidden" name="rfqItemId" value={item.id} />
                      <input type="hidden" name="rfqId" value={rfq.id} />
                      <button type="submit">
                        اعتماد التوافق وإغلاق المراجعة
                      </button>
                      {item.fitmentConfidence == null ||
                      item.fitmentConfidence < 0.85 ||
                      item.fitmentConfidence > 1 ? (
                        <span className="hint">
                          لن تغلق المراجعة حتى يجد النظام توافق كتالوج صالحاً
                          بنسبة 85% فأعلى.
                        </span>
                      ) : null}
                    </form>
                  ) : !item.humanReviewRequired ? (
                    <p className="hint">
                      ✓ أغلقت المراجعة البشرية بتوثيق إداري.
                    </p>
                  ) : (
                    <p className="hint">
                      عرض فقط؛ اعتماد التوافق يحتاج FITMENT_APPROVE.
                    </p>
                  )}
                </div>
              ) : partSuggestions.length ? (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>القطعة</th>
                        <th>الفئة</th>
                        <th className="center">توافقات</th>
                        <th></th>
                      </tr>
                    </thead>
                    <tbody>
                      {partSuggestions.map((p) => (
                        <tr key={p.id}>
                          <td className="who">{p.nameAr}</td>
                          <td>{p.category.nameAr}</td>
                          <td className="center">
                            <span
                              className={`pill ${p._count.compatibilities ? 'ok' : 'zero'}`}
                            >
                              {p._count.compatibilities}
                            </span>
                          </td>
                          <td>
                            {canWriteCatalog ? (
                              <form
                                action={linkPartToItem}
                                className="status-form"
                              >
                                <input
                                  type="hidden"
                                  name="rfqItemId"
                                  value={item.id}
                                />
                                <input
                                  type="hidden"
                                  name="partId"
                                  value={p.id}
                                />
                                <input
                                  type="hidden"
                                  name="rfqId"
                                  value={rfq.id}
                                />
                                <button type="submit">ربط بالطلب</button>
                              </form>
                            ) : (
                              <span className="hint">يتطلب CATALOG_WRITE</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="hint">
                  لا اقتراحات مطابقة من الكتالوج لنص الطلب.
                </p>
              )}
            </>
          ) : null}
        </div>

        <RfqQuoteList
          canReviewRisk={admin.permissions.includes('RISK_REVIEW')}
          canWriteQuotes={canWriteQuotes}
          item={item}
          orderExists={Boolean(order)}
          recommendationText={rec?.explanationAr}
          rfqId={rfq.id}
        />
      </section>

      {customerMsg ? (
        <section className="card-block">
          <div className="block-head">
            <h2>رسالة العروض للعميل</h2>
            <span className="hint">
              {lastSend?.action === 'customer.notification.accepted'
                ? '✓ قُبلت للإرسال عبر SMS'
                : lastSend?.action === 'customer.notification.unknown'
                  ? '⚠️ حالة الإرسال غير مؤكدة — راجع Twilio قبل الإعادة'
                  : lastSend?.action === 'customer.notification.rejected'
                    ? '⚠️ رفض الإرسال — النص متاح للنسخ اليدوي'
                    : lastSend
                      ? 'جارٍ إرسال الرسالة'
                      : 'لم تُرسل بعد'}
            </span>
          </div>
          {canCopyMessage ? <CopyBox text={customerMsg} /> : null}
          {canSendMessages ? (
            <form action={sendQuotes} className="send-form">
              <input type="hidden" name="rfqId" value={rfq.id} />
              <button type="submit">
                إرسال SMS إلى <span dir="ltr">{rfq.customer.user.phone}</span>
              </button>
              <span className="hint">
                المرسل مضبوط على الخادم عبر Twilio؛ لا تُعد الإرسال إذا كانت
                الحالة غير مؤكدة.
              </span>
            </form>
          ) : canCopyMessage ? (
            <p className="hint">
              قناة الرسائل غير مضبوطة على الخادم، فالإرسال معطّل. انسخ النص
              أعلاه وأرسله بالقناة التي تعتمدها.
            </p>
          ) : (
            <p className="hint">
              عرض فقط؛ نسخ الرسالة أو إرسالها يحتاج MESSAGING_SEND.
            </p>
          )}
        </section>
      ) : null}

      {order ? (
        <section className="card-block order-card">
          <div className="block-head">
            <h2>
              أمر الشراء <span className="mono">{order.code}</span>{' '}
              <Link
                className="inv-link"
                href={`/invoice/${order.code}`}
                target="_blank"
                rel="noreferrer"
              >
                الفاتورة <Printer size={14} aria-hidden />
              </Link>
            </h2>
            <span
              className={`status ${order.status === 'ESCROW_HELD' ? 's-QUOTES_READY' : 's-DRAFT'}`}
            >
              {order.status === 'ESCROW_HELD'
                ? 'مدفوع — محتجز في الضمان'
                : ar(ORDER_STATUS_AR, order.status)}
            </span>
          </div>
          <dl className="facts">
            <div>
              <dt>المبلغ</dt>
              <dd className="mono">
                {Number(order.totalAmount).toFixed(2)} ر.س
              </dd>
            </div>
            <div>
              <dt>المورد</dt>
              <dd>{order.quote.supplier?.businessName ?? '—'}</dd>
            </div>
            <div>
              <dt>الدفعات</dt>
              <dd>
                {order.payments.length
                  ? order.payments
                      .map(
                        (p) =>
                          `${p.provider} (${ar(PAYMENT_STATUS_AR, p.status)})`,
                      )
                      .join('، ')
                  : 'لا شيء بعد'}
              </dd>
            </div>
          </dl>
          {order.status === 'AWAITING_PAYMENT' && canManagePayments ? (
            <ManualPaymentForm />
          ) : null}
          {order.status === 'COMPLAINT_WINDOW' && canManagePayments ? (
            <form action={releaseOrderEscrow} className="send-form">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="rfqId" value={rfq.id} />
              <select name="opsOverride" defaultValue="false">
                <option value="false">إفراج بعد انتهاء النافذة</option>
                <option value="true">تجاوز تصعيد الخطر بعد المراجعة</option>
              </select>
              <button type="submit">إفراج الضمان ← صرف مستحق المورد</button>
              <span className="hint">
                النافذة تُحسب من لحظة التسليم. الشكوى المفتوحة توقف الإفراج ولا
                يتجاوزها هذا الزر.
              </span>
            </form>
          ) : null}
          {order.status === 'SUPPLIER_ACCEPTED' && canApproveFitment ? (
            <form action={verifyOrderFitment} className="send-form">
              <input type="hidden" name="orderId" value={order.id} />
              <input type="hidden" name="rfqId" value={rfq.id} />
              <button type="submit">
                اعتماد التوافق ← فتح مسار الشحن للمورد
              </button>
              <span className="hint">
                المورد لا يشحن قبل هذا الاعتماد. الاعتماد لا يحرّك أي مبلغ في
                الضمان.
              </span>
            </form>
          ) : null}
          {order.status === 'READY_TO_SHIP' &&
          canCreateShipments &&
          otoShipping.operationalConfigured ? (
            <OtoShipmentForm orderId={order.id} rfqId={rfq.id} />
          ) : null}
          {canCreateShipments
            ? order.shipments
                .filter(
                  (shipment) =>
                    shipment.provider.startsWith('SUPPLIER_MANAGED_') ||
                    !['MOCK', 'RAFRAF_INTERNAL', 'OTO'].includes(
                      shipment.provider,
                    ),
                )
                .map((shipment) => (
                  <ManualShipmentForm
                    key={shipment.id}
                    rfqId={rfq.id}
                    orderId={order.id}
                    shipment={shipment}
                  />
                ))
            : null}
        </section>
      ) : null}

      {order ? (
        <CompliancePanel
          order={order}
          rfqId={rfq.id}
          canReview={admin.permissions.includes('RISK_REVIEW')}
        />
      ) : null}

      <GlobalSourcingPanel
        canWriteQuotes={canWriteQuotes}
        defaultQuery={defaultGlobalQuery}
        item={item}
        providers={globalSourcingProviders}
        rfqId={rfq.id}
      />

      <ShippingRatePanel status={otoShipping} />

      <section className="card-block">
        <h2>إضافة عرض يدوي</h2>
        {item && canWriteQuotes ? (
          <QuoteForm rfqId={rfq.id} rfqItemId={item.id} />
        ) : item ? (
          <p className="hint">إضافة عرض تحتاج QUOTE_WRITE.</p>
        ) : null}
      </section>
    </main>
  );
}
