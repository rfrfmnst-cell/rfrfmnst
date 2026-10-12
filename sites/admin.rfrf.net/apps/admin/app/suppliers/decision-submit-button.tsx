'use client';

import { useFormStatus } from 'react-dom';

export function DecisionSubmitButton({
  children,
  tone = 'primary',
}: {
  children: React.ReactNode;
  tone?: 'primary' | 'warning' | 'danger';
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" data-tone={tone} disabled={pending}>
      {pending ? 'جارٍ حفظ القرار…' : children}
    </button>
  );
}
