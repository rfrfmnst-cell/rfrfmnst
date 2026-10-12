'use client';

import { useState, type InputHTMLAttributes } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import styles from './login.module.css';

export function PasswordInput(
  props: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>,
) {
  const [visible, setVisible] = useState(false);
  return (
    <>
      <input {...props} type={visible ? 'text' : 'password'} />
      <button
        type="button"
        className={styles.passwordToggle}
        aria-label={visible ? 'إخفاء كلمة المرور' : 'إظهار كلمة المرور'}
        aria-pressed={visible}
        aria-controls={props.id}
        onClick={() => setVisible(!visible)}
      >
        {visible ? (
          <EyeOff size={19} aria-hidden />
        ) : (
          <Eye size={19} aria-hidden />
        )}
      </button>
    </>
  );
}
