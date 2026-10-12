'use client';

export function PrintButton() {
  return (
    <button type="button" className="inv-print" onClick={() => window.print()}>
      طباعة 🖨
    </button>
  );
}
