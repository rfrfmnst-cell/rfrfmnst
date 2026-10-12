'use client';

import Image from 'next/image';
import { useRef, useState } from 'react';
import {
  BadgeCheck,
  CarFront,
  Check,
  CircleCheckBig,
  Info,
  ScanLine,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';

interface DecisionCardProps {
  partText?: string;
  make?: string;
  model?: string;
  year?: string;
  vin?: string;
  oemNumber?: string;
  confidence?: number;
  images: string[];
  active: boolean;
  previewMode: boolean;
  suppliersChecked: boolean;
}

const PREVIEW_IMAGES = [
  '/rafraf-alternator-product.webp',
  '/rafraf-alternator-workshop.webp',
  '/rafraf-alternator-product.webp',
];

export function DecisionCard({
  partText,
  make,
  model,
  year,
  vin,
  oemNumber,
  confidence = 0.5,
  images,
  active,
  previewMode,
  suppliersChecked,
}: DecisionCardProps) {
  const [allEvidenceOpen, setAllEvidenceOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState<string | null>(null);
  const imageDialogRef = useRef<HTMLDialogElement>(null);
  const vehicle = [make, model, year].filter(Boolean).join(' ');
  const match = Math.round(confidence * 100);
  const verifiedByVin = active && Boolean(vin);
  const evidenceImages = previewMode ? PREVIEW_IMAGES : images;
  const evidenceCount = evidenceImages.length + Number(Boolean(oemNumber)) + Number(Boolean(vin));
  const primaryImage = previewMode ? PREVIEW_IMAGES[0] : images[0];

  function openImage(source: string) {
    setSelectedImage(source);
    imageDialogRef.current?.showModal();
  }

  return (
    <section className="rf-decision-card" aria-labelledby="rf-decision-title">
      <header className="rf-decision-card-head">
        <div><Info size={16} aria-hidden /><strong>بطاقة القرار</strong></div>
        <span className={verifiedByVin ? 'is-verified' : active ? 'is-preliminary' : ''}>
          {verifiedByVin ? <CircleCheckBig size={15} aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
          {verifiedByVin ? 'تم التحقق' : active ? 'مطابقة أولية' : 'بانتظار البيانات'}
        </span>
      </header>

      <div className="rf-decision-content">
        <div className="rf-decision-summary">
          <span className="rf-decision-kicker">القطعة المحددة</span>
          <h2 id="rf-decision-title">{partText || 'لم تُحدّد القطعة بعد'}</h2>
          <p>OEM: <b dir="ltr">{oemNumber || 'غير مضاف'}</b></p>

          <div className="rf-fitment-score">
            <span>التطابق مع سيارتك</span>
            <strong>{active ? `${match}%` : '—'}</strong>
            <small>
              {verifiedByVin
                ? 'تحقق مدعوم برقم الهيكل'
                : active
                  ? 'أولي — يحتاج مراجعة فنية قبل الاعتماد'
                  : 'أكمل بيانات السيارة والقطعة'}
            </small>
          </div>

          <dl className="rf-decision-facts">
            <div>
              <dt>رقم الهيكل (VIN)</dt>
              <dd>{vin ? <b dir="ltr">{vin}</b> : 'غير مضاف — اختياري'}</dd>
            </div>
            <div>
              <dt>أدلة المطابقة</dt>
              <dd>{evidenceCount ? `${evidenceCount} أدلة` : 'لا توجد أدلة بعد'}</dd>
            </div>
          </dl>
        </div>

        <div className="rf-decision-visual">
          {primaryImage ? (
            <button type="button" className="rf-decision-product" onClick={() => openImage(primaryImage)}>
              <Image
                src={primaryImage}
                fill
                unoptimized
                preload
                loading="eager"
                sizes="(max-width: 820px) 86vw, 340px"
                alt={`صورة مرفقة للقطعة ${partText ?? ''}`.trim()}
              />
            </button>
          ) : (
            <div className="rf-decision-no-image">
              <ScanLine size={34} aria-hidden />
              <strong>لا توجد صورة للقطعة</strong>
              <span>أرفق صورة لرفع دقة المطابقة</span>
            </div>
          )}

          {evidenceImages.length ? (
            <div className={`rf-evidence-thumbs ${allEvidenceOpen ? 'is-expanded' : ''}`} aria-label="الأدلة المرئية">
              {evidenceImages.map((source, index) => (
                <button key={`${source.slice(0, 40)}-${index}`} type="button" title={`فتح الدليل ${index + 1}`} onClick={() => openImage(source)}>
                  <Image
                    src={source}
                    fill
                    unoptimized
                    loading="eager"
                    sizes="76px"
                    alt={`الدليل المرئي ${index + 1}`}
                  />
                </button>
              ))}
            </div>
          ) : null}
          <button
            type="button"
            className="rf-all-evidence"
            onClick={() => setAllEvidenceOpen((current) => !current)}
            disabled={!evidenceImages.length}
            aria-expanded={allEvidenceOpen}
          >
            {allEvidenceOpen ? 'إخفاء الأدلة' : `عرض كل الأدلة (${evidenceCount})`}
          </button>
        </div>
      </div>

      <div className="rf-decision-checks">
        <article>
          <CarFront size={20} aria-hidden />
          <div><span>بيانات المركبة</span><strong>{vehicle || 'غير مكتملة'}</strong></div>
          {vehicle ? <Check size={15} aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
        </article>
        <article>
          <BadgeCheck size={20} aria-hidden />
          <div><span>كود OEM</span><strong>{oemNumber ? 'مضاف للمراجعة' : 'غير مضاف'}</strong></div>
          {oemNumber ? <Check size={15} aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
        </article>
        <article>
          <ShieldCheck size={20} aria-hidden />
          <div><span>الموردون</span><strong>{suppliersChecked ? 'عروض موثقة' : 'يُفحصون بعد إرسال الطلب'}</strong></div>
          {suppliersChecked ? <Check size={15} aria-hidden /> : <ShieldAlert size={15} aria-hidden />}
        </article>
      </div>

      <dialog ref={imageDialogRef} className="rf-evidence-dialog" aria-label="معاينة الدليل">
        <button type="button" aria-label="إغلاق المعاينة" onClick={() => imageDialogRef.current?.close()}>
          <X size={19} aria-hidden />
        </button>
        {selectedImage ? (
          <Image
            src={selectedImage}
            width={960}
            height={720}
            unoptimized={selectedImage.startsWith('data:')}
            alt="معاينة مكبرة لدليل القطعة"
          />
        ) : null}
      </dialog>
    </section>
  );
}
