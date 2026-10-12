'use client';

import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import { useFormStatus } from 'react-dom';

type SubmitButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'children'
> & {
  children: ReactNode;
  pendingLabel: string;
  spinnerClassName?: string;
  spinnerSize?: number;
};

// الزر الموحّد لإرسال النماذج عبر التطبيقات الثلاثة. يحمل كامل عقد الإتاحة
// (aria-disabled/aria-busy/role=status) وسمة data-pending التي تعتمدها أنماط
// لوحة العمليات، بدل النسخ المحلية المتباعدة السابقة.
export function SubmitButton({
  children,
  pendingLabel,
  disabled,
  type,
  spinnerClassName = 'rafraf-spinner',
  spinnerSize = 17,
  ...buttonProps
}: SubmitButtonProps) {
  const { pending } = useFormStatus();
  const busy = pending || disabled;

  return (
    <button
      {...buttonProps}
      type={type ?? 'submit'}
      disabled={busy}
      aria-disabled={busy}
      aria-busy={pending}
      data-pending={pending ? 'true' : undefined}
    >
      {pending ? (
        <>
          <LoaderCircle
            className={spinnerClassName}
            size={spinnerSize}
            aria-hidden
          />
          <span role="status" aria-live="polite">
            {pendingLabel}
          </span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
