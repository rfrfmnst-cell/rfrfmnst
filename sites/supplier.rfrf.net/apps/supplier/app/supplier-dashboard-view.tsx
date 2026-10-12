import {
  ArrowLeft,
  BadgeCheck,
  Building2,
  CheckCircle2,
  Clock3,
  FileCheck2,
  PackageSearch,
  ShieldCheck,
} from 'lucide-react';
import Link from 'next/link';
import type {
  SupplierAccount,
  SupplierDashboardReadModel,
} from './supplier-dashboard-read-model';
import {
  ar,
  ORDER_STATUS_AR,
  PAYOUT_STATUS_AR,
  QUOTE_STATUS_AR,
  RFQ_STATUS_AR,
} from '../lib/supplier-labels';

function timeAgo(date: Date): string {
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `قبل ${mins} د`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `قبل ${hours} س`;
  return `قبل ${Math.floor(hours / 24)} ي`;
}

export function SupplierDashboardView({
  data,
  errMsg,
  ok,
  supplier,
}: {
  data: SupplierDashboardReadModel;
  errMsg: string | null | undefined;
  ok?: string;
  supplier: SupplierAccount;
}) {
  const {
    approvedQuotes,
    availableCount,
    inventory,
    orders,
    payouts,
    quotedItems,
    recentQuotes,
    rfqs,
    totalQuoteCount,
  } = data;

  return (
    <>
      <header className="topbar sp-page-head" id="workspace">
        <div>
          <p className="sp-kicker">
            <BadgeCheck size={17} aria-hidden /> مورد معتمد
          </p>
          <h1>{supplier.businessName}</h1>
          <p className="sub">
            {supplier.city ? `${supplier.city} · ` : ''}
            طلبات التسعير المفتوحة — قدّم سعرك كمورد فقط
          </p>
        </div>
        <Link className="back" href="/">
          <ArrowLeft size={16} aria-hidden /> تغيير المنشأة
        </Link>
      </header>

      {errMsg ? <p className="sp-alert err">{errMsg}</p> : null}
      {ok ? (
        <p className="sp-alert ok">
          <CheckCircle2 size={17} aria-hidden /> تم استلام عرضك للطلب {ok} — يصل
          فريق رفرف للمراجعة والتسعير النهائي قبل عرضه على العميل.
        </p>
      ) : null}

      <section className="sp-kpis" aria-label="مؤشرات حساب المورد">
        <article>
          <PackageSearch size={20} aria-hidden />
          <span>متاح للتسعير</span>
          <strong>{availableCount}</strong>
          <small>بنود مطابقة وجاهزة</small>
        </article>
        <article>
          <FileCheck2 size={20} aria-hidden />
          <span>عروضي</span>
          <strong>{totalQuoteCount}</strong>
          <small>كل عروض المنشأة المسجلة</small>
        </article>
        <article>
          <BadgeCheck size={20} aria-hidden />
          <span>معتمد أو مختار</span>
          <strong>{approvedQuotes}</strong>
          <small>عروض اجتازت المراجعة</small>
        </article>
      </section>

      <section className="sp-priority-rail" aria-label="أولويات المورد">
        <div>
          <p>لوحة التاجر</p>
          <h2>ابدأ بما يقرّب عرضك من الاعتماد</h2>
        </div>
        <a href="/quotes?status=OPEN">
          <PackageSearch size={18} aria-hidden />
          <span>
            <strong>{availableCount} فرص</strong>
            <small>افتح مساحة التسعير الجديدة</small>
          </span>
          <ArrowLeft size={17} aria-hidden />
        </a>
        <a href="/quotes">
          <FileCheck2 size={18} aria-hidden />
          <span>
            <strong>{totalQuoteCount} عروض</strong>
            <small>تابع ما وصل للمراجعة</small>
          </span>
          <ArrowLeft size={17} aria-hidden />
        </a>
      </section>

      <section className="card-block" id="requests">
        <div className="block-head">
          <h2>طلبات التسعير المفتوحة</h2>
          <a className="hint" href="/quotes?status=OPEN">
            كل البنود في مساحة التسعير
          </a>
        </div>

        {rfqs.length === 0 ? (
          <p className="empty">لا طلبات مفتوحة حالياً — عُد لاحقاً.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>كود الطلب</th>
                  <th>القطعة</th>
                  <th>المركبة</th>
                  <th>المدينة</th>
                  <th>الحالة</th>
                  <th>عمر الطلب</th>
                  <th>عرضي</th>
                </tr>
              </thead>
              <tbody>
                {rfqs.map((r) => {
                  const firstItem = r.items[0];
                  const openItems = r.items.filter(
                    (item) => !quotedItems.has(item.id),
                  );
                  const extraItems = Math.max(0, r.items.length - 1);
                  return (
                    <tr key={r.id}>
                      <td className="mono">{r.code}</td>
                      <td className="part">
                        {firstItem?.freeTextAr ?? '—'}
                        {extraItems > 0 ? ` +${extraItems}` : ''}
                      </td>
                      <td>
                        {r.vehicle
                          ? `${r.vehicle.make} ${r.vehicle.model} ${r.vehicle.year}`
                          : '—'}
                      </td>
                      <td>{r.customer.city ?? '—'}</td>
                      <td>
                        <span className={`status s-${r.status}`}>
                          {ar(RFQ_STATUS_AR, r.status)}
                        </span>
                      </td>
                      <td className="sub2">{timeAgo(r.createdAt)}</td>
                      <td>
                        {openItems.length === 0 ? (
                          <span className="sp-quoted">
                            <CheckCircle2 size={15} aria-hidden /> قُدِّم لكل
                            البنود
                          </span>
                        ) : (
                          <a
                            className="row-cta"
                            href={`/quotes?status=OPEN&q=${encodeURIComponent(r.code)}`}
                          >
                            تسعير {openItems.length} بند
                          </a>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-block" id="offers">
        <div className="block-head">
          <div>
            <h2>عروضي الأخيرة</h2>
            <p className="hint">سعر المورد فقط — لا يظهر سعر العميل النهائي</p>
          </div>
          <a href="/quotes" className="row-cta">
            كل العروض
          </a>
        </div>
        {recentQuotes.length === 0 ? (
          <p className="empty">لم تقدّم منشأتك عروضاً على الطلبات الحالية.</p>
        ) : (
          <div className="sp-offers-list">
            {recentQuotes.map((quote) => {
              const supplierPrice =
                quote.landedCost?.supplierPrice != null
                  ? Number(quote.landedCost.supplierPrice)
                  : quote.status === 'DRAFT'
                    ? Number(quote.finalPrice)
                    : null;
              return (
                <article key={quote.id}>
                  <div>
                    <strong>{quote.rfqItem.freeTextAr ?? quote.code}</strong>
                    <span className="mono">{quote.code}</span>
                  </div>
                  <div className="sp-offer-metrics">
                    <span>
                      {supplierPrice == null
                        ? '—'
                        : `${supplierPrice.toFixed(2)} ر.س`}
                    </span>
                    <span>
                      <Clock3 size={14} aria-hidden />{' '}
                      {quote.deliveryDaysMin ?? '—'} يوم
                    </span>
                    <span>
                      <ShieldCheck size={14} aria-hidden />{' '}
                      {quote.warrantyMonths} شهر
                    </span>
                  </div>
                  <span className={`status q-${quote.status}`}>
                    {ar(QUOTE_STATUS_AR, quote.status)}
                  </span>
                </article>
              );
            })}
          </div>
        )}
      </section>

      <section className="card-block" id="inventory">
        <div className="block-head">
          <div>
            <h2>مخزون المنشأة</h2>
            <p className="hint">إدارة القطع والأسعار الخاصة بك</p>
          </div>
          <Building2 size={20} aria-hidden />
        </div>
        {inventory.length === 0 ? (
          <p className="empty">
            لا يوجد قطع مضافة. <a href="/catalog/import">ارفع ملف CSV</a> لإضافة
            مخزونك.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>رقم القطعة</th>
                  <th>الشركة</th>
                  <th>السعر (ر.س)</th>
                  <th>الكمية</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {inventory.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">{inv.partNumber}</td>
                    <td>{inv.brand ?? '—'}</td>
                    <td>{Number(inv.price).toFixed(2)}</td>
                    <td>{inv.quantity}</td>
                    <td>
                      <span
                        className={`status ${inv.isActive ? 's-QUOTES_READY' : 's-CANCELLED'}`}
                      >
                        {inv.isActive ? 'متاح' : 'متوقف'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-block" id="shipments">
        <div className="block-head">
          <div>
            <h2>تجهيز وشحن</h2>
            <p className="hint">الطلبات التي اختارها العملاء وتنتظر شحنك</p>
          </div>
          <a href="/shipments" className="row-cta">
            فتح طابور التنفيذ
          </a>
        </div>
        {orders.length === 0 ? (
          <p className="empty">
            لا توجد طلبات تحتاج تجهيز وشحن في الوقت الحالي.
          </p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>كود الطلب</th>
                  <th>القطعة</th>
                  <th>طريقة الشحن</th>
                  <th>حالة الطلب</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id}>
                    <td className="mono">{order.code}</td>
                    <td>{order.quote?.rfqItem?.freeTextAr ?? '—'}</td>
                    <td>{order.shipments[0]?.provider ?? '—'}</td>
                    <td>
                      <span className={`status s-${order.status}`}>
                        {ar(ORDER_STATUS_AR, order.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card-block" id="payouts">
        <div className="block-head">
          <div>
            <h2>المستحقات الماليّة</h2>
            <p className="hint">التحويلات إلى حساب المنشأة</p>
          </div>
        </div>
        {payouts.length === 0 ? (
          <p className="empty">لا توجد تحويلات مالية مسجلة.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>التاريخ</th>
                  <th>المبلغ (ر.س)</th>
                  <th>المرجع</th>
                  <th>الحالة</th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="mono">
                      {p.createdAt.toLocaleDateString('ar-SA')}
                    </td>
                    <td>{Number(p.amount).toFixed(2)}</td>
                    <td className="mono">{p.reference ?? '—'}</td>
                    <td>
                      <span
                        className={`status ${p.status === 'PAID' ? 's-QUOTES_READY' : 's-DRAFT'}`}
                      >
                        {ar(PAYOUT_STATUS_AR, p.status)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
