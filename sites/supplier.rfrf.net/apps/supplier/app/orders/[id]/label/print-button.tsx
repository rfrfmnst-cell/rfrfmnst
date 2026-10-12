'use client';

import { Printer } from 'lucide-react';

export function PrintLabelButton({ className }: { className: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      <Printer size={17} aria-hidden /> طباعة المعاينة
    </button>
  );
}
