'use client';

import { useState } from 'react';

export function CopyBox({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copybox">
      <pre dir="rtl">{text}</pre>
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
      >
        {copied ? '✓ نُسخت' : 'نسخ الرسالة'}
      </button>
    </div>
  );
}
