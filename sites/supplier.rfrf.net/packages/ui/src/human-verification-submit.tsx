'use client';

import { useState } from 'react';
import type { ReactNode } from 'react';
import { LogIn } from 'lucide-react';
import { SubmitButton } from './submit-button';
import { TurnstileWidget } from './turnstile-widget';

// زر إرسال محروس بتحقق Turnstile البشري: يُفعَّل فقط بعد الحصول على token.
// يوحّد نسخ العميل والمورد السابقة (دخول وتسجيل) خلف واجهة واحدة.
export function HumanVerificationSubmit({
  siteKey,
  action,
  label,
  pendingLabel = 'جارٍ إرسال الرمز…',
  turnstileClassName,
  buttonClassName,
  icon = <LogIn size={18} aria-hidden />,
  iconPosition = 'end',
}: {
  siteKey: string;
  action: string;
  label: ReactNode;
  pendingLabel?: string;
  turnstileClassName?: string;
  buttonClassName?: string;
  icon?: ReactNode;
  iconPosition?: 'start' | 'end';
}) {
  const [token, setToken] = useState('');

  return (
    <>
      <TurnstileWidget
        siteKey={siteKey}
        action={action}
        className={turnstileClassName}
        onTokenChange={setToken}
      />
      <SubmitButton
        className={buttonClassName}
        pendingLabel={pendingLabel}
        disabled={!token}
      >
        {iconPosition === 'start' ? (
          <>
            {icon} {label}
          </>
        ) : (
          <>
            {label} {icon}
          </>
        )}
      </SubmitButton>
    </>
  );
}
