'use client';

import { Camera, ImageIcon, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { prepareCustomerImage } from '../../lib/client-image';
import styles from './photo-capture-dialog.module.css';

export const IMAGE_KIND_LABELS = {
  PART_PHOTO: 'صورة القطعة',
  LABEL_BARCODE: 'ملصق أو باركود',
  VIN_PLATE: 'لوحة رقم الهيكل',
} as const;

export interface CustomerPhoto {
  file: File;
  imageKind: keyof typeof IMAGE_KIND_LABELS;
  description: string;
}

export function customerPhotoText(photo: CustomerPhoto): string {
  const description = photo.description.trim();
  return `أرفقت ${IMAGE_KIND_LABELS[photo.imageKind]}.${description ? ` الوصف: ${description}` : ''} حلّل الصورة ضمن بيانات طلبي، واعرض أي رقم للمراجعة والتأكيد.`;
}

export function PhotoCaptureDialog({
  open,
  onClose,
  onSelected,
}: {
  open: boolean;
  onClose: () => void;
  onSelected: (photo: CustomerPhoto) => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const selectionRef = useRef(false);
  const titleId = useId();
  const hintId = useId();
  const [imageKind, setImageKind] =
    useState<CustomerPhoto['imageKind']>('PART_PHOTO');
  const [description, setDescription] = useState('');
  const [processing, setProcessing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setError('');
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  async function selectFile(file: File | undefined) {
    if (!file || selectionRef.current) return;
    selectionRef.current = true;
    setProcessing(true);
    setError('');
    try {
      const prepared = await prepareCustomerImage(file);
      onSelected({
        file: prepared,
        imageKind,
        description: description.trim(),
      });
      setDescription('');
      onClose();
    } catch {
      setError(
        'تعذّر تجهيز الصورة بأمان. اختر JPEG أو PNG أو WebP حتى 20MB وحاول مجدداً.',
      );
    } finally {
      selectionRef.current = false;
      setProcessing(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      aria-labelledby={titleId}
      aria-describedby={hintId}
      onCancel={(event) => {
        if (processing) event.preventDefault();
        else onClose();
      }}
      onClose={onClose}
    >
      <button
        className={styles.close}
        type="button"
        aria-label="إغلاق اختيار الصورة"
        disabled={processing}
        onClick={onClose}
      >
        <X size={20} aria-hidden="true" />
      </button>
      <h2 id={titleId}>إضافة صورة لطلبك</h2>
      <p id={hintId}>
        اختر نوع الصورة. نصغّرها ونحذف بيانات الموقع منها قبل الإرسال.
      </p>
      <fieldset disabled={processing} className={styles.kinds}>
        <legend>نوع الصورة</legend>
        {Object.entries(IMAGE_KIND_LABELS).map(([kind, label]) => (
          <label key={kind}>
            <input
              type="radio"
              name={titleId}
              value={kind}
              checked={imageKind === kind}
              onChange={() => setImageKind(kind as CustomerPhoto['imageKind'])}
            />
            <span>{label}</span>
          </label>
        ))}
      </fieldset>
      <label className={styles.description}>
        وصف الصورة (اختياري)
        <textarea
          value={description}
          maxLength={500}
          rows={3}
          disabled={processing}
          onChange={(event) => setDescription(event.target.value)}
          placeholder="مثلاً: الرقم الموجود على ملصق القطعة"
        />
      </label>
      <div className={styles.actions}>
        <button
          type="button"
          disabled={processing}
          onClick={() => galleryRef.current?.click()}
        >
          <ImageIcon size={19} aria-hidden="true" /> اختيار صورة
        </button>
        <button
          type="button"
          disabled={processing}
          onClick={() => cameraRef.current?.click()}
        >
          <Camera size={19} aria-hidden="true" /> التقاط صورة
        </button>
      </div>
      <input
        ref={galleryRef}
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void selectFile(file);
        }}
      />
      <input
        ref={cameraRef}
        hidden
        type="file"
        capture="environment"
        accept="image/jpeg,image/png,image/webp"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          event.currentTarget.value = '';
          void selectFile(file);
        }}
      />
      {processing ? (
        <p role="status">جاري تصغير الصورة وإزالة بيانات الموقع…</p>
      ) : null}
      {error ? (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      ) : null}
    </dialog>
  );
}
