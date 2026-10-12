'use client';

import { BookmarkCheck, CreditCard, PackageSearch } from 'lucide-react';
import type { SafePartCard, SafePaymentNext } from './assistant-tool-display';

/** بطاقة القطعة: صورة من الكتالوج أو من صورة العميل، مع الاسم ورقم OEM. */
export function PartCard({ part }: { part: SafePartCard }) {
  return (
    <figure className="rf-part-card" aria-label="القطعة المطلوبة">
      {part.imageUrl ? (
        <img
          src={part.imageUrl}
          alt={part.name ? `صورة ${part.name}` : 'صورة القطعة المطلوبة'}
          loading="lazy"
          referrerPolicy="no-referrer"
        />
      ) : (
        <span className="rf-part-card-placeholder" aria-hidden>
          <PackageSearch size={26} />
        </span>
      )}
      <figcaption>
        <strong>{part.name ?? 'القطعة المطلوبة'}</strong>
        {part.oemNumber ? (
          <span>
            رقم القطعة <bdi dir="ltr">{part.oemNumber}</bdi>
          </span>
        ) : null}
        <small>
          {part.imageSource === 'catalog'
            ? 'الصورة من كتالوج رفرف'
            : part.imageSource === 'customer'
              ? 'الصورة التي أرفقتها'
              : 'لا صورة بعد. أرفق صورة القطعة لتدقيق أسرع.'}
        </small>
      </figcaption>
    </figure>
  );
}

/**
 * بعد اعتماد العرض: «محجوز» عند تأجيل الدفع، أو رابط الدفع عند فتحه.
 * لا زر دفع داخل المحادثة؛ التحصيل يبقى في صفحة الطلب المحمية.
 */
export function ReserveOrPay({ payment }: { payment: SafePaymentNext }) {
  if (payment.kind === 'checkout') {
    return (
      <div className="rf-reserve is-checkout">
        <CreditCard size={18} aria-hidden />
        <span>طلبك محجوز باسمك. أكمل الدفع الآن ليبدأ المورد التجهيز.</span>
        <a href={payment.trackHref}>الانتقال للدفع</a>
      </div>
    );
  }
  return (
    <div className="rf-reserve is-deferred">
      <BookmarkCheck size={18} aria-hidden />
      <span>
        <b>محجوز لك بلا دفع الآن.</b> الدفع الإلكتروني غير متاح حالياً، وسنبلغك
        عند فتحه. يمكنك إلغاء الحجز من صفحة الطلب قبل بدء الدفع.
      </span>
      <a href={payment.trackHref}>عرض الطلب</a>
    </div>
  );
}
