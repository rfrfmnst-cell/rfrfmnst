'use client';

import Link from 'next/link';
import { useRef, useState } from 'react';
import {
  BadgeCheck,
  Check,
  ChevronLeft,
  Clock3,
  CreditCard,
  MapPin,
  ShieldCheck,
  Star,
  Store,
  Tag,
  Truck,
  X,
} from 'lucide-react';
import { approveQuoteAsCustomer, type CustomerQuoteCard } from '../actions';
import {
  approvalPayload,
  buildDisplayOffers,
  type DisplayOffer,
  type OfferMode,
} from './offer-display';

interface OfferComparisonProps {
  offers?: CustomerQuoteCard[];
  visible: boolean;
  mode: OfferMode;
  rfqCode: string | null;
  phone?: string;
  orderCode: string | null;
  acceptedQuoteId: string | null;
  onApprovalSuccess: (orderCode: string, quoteId: string) => void;
  onShowQuotes: () => void;
  busy: boolean;
}

export function OfferComparison({
  offers,
  visible,
  mode,
  rfqCode,
  phone,
  orderCode,
  acceptedQuoteId,
  onApprovalSuccess,
  onShowQuotes,
  busy,
}: OfferComparisonProps) {
  const [comparisonOpen, setComparisonOpen] = useState(false);
  const [selectedOffer, setSelectedOffer] = useState<DisplayOffer | null>(null);
  const [approvalError, setApprovalError] = useState<string | null>(null);
  const [approving, setApproving] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);

  if (!visible) {
    return (
      <section className="rf-offers rf-offers-empty" aria-label="العروض">
        <Store size={26} aria-hidden />
        <div>
          <h2>سنقارن أفضل العروض بعد التحقق من القطعة</h2>
          <p>
            أرسل صورة أو بيانات السيارة ليظهر السعر الواصل والضمان وموعد
            التسليم.
          </p>
        </div>
      </section>
    );
  }

  const source = buildDisplayOffers(offers, mode);

  function requestApproval(offer: DisplayOffer) {
    if (orderCode) return;
    setSelectedOffer(offer);
    setApprovalError(null);
    dialogRef.current?.showModal();
  }

  async function confirmApproval() {
    if (!selectedOffer || approving) return;
    setApprovalError(null);
    setApproving(true);
    try {
      if (mode === 'preview') {
        onApprovalSuccess('ORD-PREVIEW', selectedOffer.id);
        dialogRef.current?.close();
        return;
      }
      if (!rfqCode || !phone) {
        setApprovalError(
          'بيانات الطلب غير مكتملة. حدّث الصفحة ثم حاول مرة أخرى.',
        );
        return;
      }
      const fields = approvalPayload(rfqCode, phone, selectedOffer.id);
      const formData = new FormData();
      formData.set('code', fields.code);
      formData.set('phone', fields.phone);
      formData.set('quoteId', fields.quoteId);
      const result = await approveQuoteAsCustomer({}, formData);
      if (!result.ok || !result.orderCode) {
        setApprovalError(result.error ?? 'تعذّر اعتماد العرض الآن.');
        return;
      }
      onApprovalSuccess(result.orderCode, selectedOffer.id);
      dialogRef.current?.close();
    } catch {
      setApprovalError('تعذّر الاتصال بخدمة الاعتماد. حاول مرة أخرى.');
    } finally {
      setApproving(false);
    }
  }

  return (
    <section
      className="rf-offers rf-market-offers"
      aria-labelledby="rf-offers-title"
    >
      <div className="rf-offers-heading">
        <div>
          <span>السعر الإجمالي شامل الضريبة والتوصيل</span>
          <h2 id="rf-offers-title">
            {source.length
              ? `أفضل ${source.length} خيارات مختارة لك`
              : 'لا توجد عروض جاهزة بعد'}
          </h2>
          {mode === 'preview' ? (
            <span className="rf-preview-notice">
              وضع معاينة — لن يُنشأ طلب حقيقي.
            </span>
          ) : null}
        </div>
        <label className="rf-compare-toggle">
          <span>مقارنة العروض</span>
          <input
            type="checkbox"
            checked={comparisonOpen}
            onChange={(event) => setComparisonOpen(event.target.checked)}
          />
          <i aria-hidden />
        </label>
      </div>

      <div className={`rf-offer-grid ${comparisonOpen ? 'is-comparing' : ''}`}>
        {source.map((offer) => {
          const accepted = acceptedQuoteId === offer.id;
          return (
            <article
              key={offer.id}
              className={`rf-market-offer is-${offer.tone} ${accepted ? 'is-accepted' : ''}`}
            >
              <span className="rf-offer-ribbon">{offer.badge}</span>
              <header>
                <span className="rf-supplier-mark">
                  <Store size={20} aria-hidden />
                </span>
                <div>
                  <strong>{offer.supplier}</strong>
                  <small>
                    <BadgeCheck size={13} aria-hidden /> موثق من رفرف
                    {offer.rating ? (
                      <>
                        <Star size={12} fill="currentColor" aria-hidden />{' '}
                        {offer.rating}
                        <span>({offer.reviews} تقييم)</span>
                      </>
                    ) : null}
                  </small>
                </div>
              </header>

              <div className="rf-market-price">
                <div>
                  <span>السعر الإجمالي شامل التوصيل</span>
                  <strong>{offer.price}</strong>
                  <small>السعر النهائي المعتمد</small>
                </div>
                <Tag size={20} aria-hidden />
              </div>

              <div className="rf-market-source">
                <span className="rf-market-source-visual" aria-hidden>
                  <MapPin size={18} />
                </span>
                <div>
                  <strong>{offer.marketArea}</strong>
                  <small>{offer.sourceLabel}</small>
                </div>
              </div>

              <dl>
                <div>
                  <dt>نوع القطعة</dt>
                  <dd>{offer.partType}</dd>
                </div>
                <div>
                  <dt>موعد الوصول</dt>
                  <dd className="is-accent">{offer.delivery}</dd>
                  {offer.deliveryDate ? (
                    <small>{offer.deliveryDate}</small>
                  ) : null}
                </div>
                {offer.fitment ? (
                  <div>
                    <dt>التوافق</dt>
                    <dd>{offer.fitment}</dd>
                  </div>
                ) : null}
                {offer.stock ? (
                  <div>
                    <dt>المخزون</dt>
                    <dd>{offer.stock}</dd>
                  </div>
                ) : null}
                <div>
                  <dt>الضمان</dt>
                  <dd>{offer.warranty}</dd>
                </div>
                <div>
                  <dt>إشارة الجودة</dt>
                  <dd>{offer.qualitySignal}</dd>
                </div>
                {comparisonOpen && offer.returnPolicy ? (
                  <div>
                    <dt>سياسة الإرجاع</dt>
                    <dd>{offer.returnPolicy}</dd>
                  </div>
                ) : null}
              </dl>

              <button
                className="rf-accept-offer"
                type="button"
                onClick={() => requestApproval(offer)}
                disabled={Boolean(orderCode) || busy}
              >
                {accepted ? <Check size={18} aria-hidden /> : null}
                {accepted ? 'تم اعتماد هذا العرض' : 'اعتماد هذا العرض'}
                {!orderCode ? <ChevronLeft size={17} aria-hidden /> : null}
              </button>
            </article>
          );
        })}
      </div>

      {orderCode ? (
        <section className="rf-approval-success" aria-live="polite">
          <ShieldCheck size={25} aria-hidden />
          <div>
            <strong>
              {mode === 'preview'
                ? 'اكتملت تجربة الاعتماد'
                : 'تم إنشاء أمر الشراء بنجاح'}
            </strong>
            <span>
              رقم الأمر: <b dir="ltr">{orderCode}</b> · الحالة التالية: بانتظار
              الدفع
            </span>
          </div>
          {mode === 'live' ? (
            <Link href={`/track?code=${encodeURIComponent(orderCode)}`}>
              تتبّع الأمر
            </Link>
          ) : null}
        </section>
      ) : null}

      <div className="rf-market-trust" aria-label="ضمانات رفرف">
        <div>
          <BadgeCheck size={22} aria-hidden />
          <span>
            <strong>تجار موثقون</strong>
            <small>تحقق من هوية البائعين</small>
          </span>
        </div>
        <div>
          <CreditCard size={22} aria-hidden />
          <span>
            <strong>دفع آمن</strong>
            <small>تشفير وحماية كاملة</small>
          </span>
        </div>
        <div>
          <Tag size={22} aria-hidden />
          <span>
            <strong>سعر نهائي</strong>
            <small>بلا تكاليف مفاجئة</small>
          </span>
        </div>
        <div>
          <Truck size={22} aria-hidden />
          <span>
            <strong>توصيل موثوق</strong>
            <small>شركاء توصيل معتمدون</small>
          </span>
        </div>
        <button type="button" onClick={onShowQuotes} disabled={busy}>
          <Clock3 size={17} aria-hidden /> كل العروض
        </button>
      </div>

      <dialog
        ref={dialogRef}
        className="rf-approval-dialog"
        aria-labelledby="rf-approval-dialog-title"
        onClick={(event) => {
          if (event.target === event.currentTarget && !approving)
            event.currentTarget.close();
        }}
      >
        <button
          type="button"
          className="rf-dialog-close"
          aria-label="إغلاق"
          onClick={() => dialogRef.current?.close()}
          disabled={approving}
        >
          <X size={18} aria-hidden />
        </button>
        <h3 id="rf-approval-dialog-title">تأكيد اعتماد العرض</h3>
        {selectedOffer ? (
          <div className="rf-dialog-summary">
            <span>{selectedOffer.supplier}</span>
            <strong>{selectedOffer.price}</strong>
            <dl>
              <div>
                <dt>الوصول</dt>
                <dd>{selectedOffer.delivery}</dd>
              </div>
              <div>
                <dt>الضمان</dt>
                <dd>{selectedOffer.warranty}</dd>
              </div>
              <div>
                <dt>القطعة</dt>
                <dd>{selectedOffer.partType}</dd>
              </div>
            </dl>
          </div>
        ) : null}
        {approvalError ? (
          <p className="rf-approval-error" role="alert">
            {approvalError}
          </p>
        ) : null}
        <p className="rf-dialog-note">
          {mode === 'preview'
            ? 'هذه معاينة للتجربة فقط ولن تحفظ أي طلب.'
            : 'بالتأكيد سينشأ أمر شراء بحالة «بانتظار الدفع». لن يتم خصم أي مبلغ الآن.'}
        </p>
        <div className="rf-dialog-actions">
          <button
            type="button"
            onClick={() => dialogRef.current?.close()}
            disabled={approving}
          >
            إلغاء
          </button>
          <button
            type="button"
            onClick={() => void confirmApproval()}
            disabled={approving}
          >
            {approving ? 'جارٍ الاعتماد…' : 'تأكيد وإنشاء الأمر'}
          </button>
        </div>
      </dialog>
    </section>
  );
}
