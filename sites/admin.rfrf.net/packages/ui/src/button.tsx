'use client';

import { LoaderCircle } from 'lucide-react';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export type ButtonSize = 'lg' | 'md' | 'sm';
export type ButtonVariant = 'danger' | 'ghost' | 'primary' | 'secondary';

interface ButtonOptions {
  fullWidth?: boolean;
  icon?: ReactNode;
  iconPosition?: 'end' | 'start';
  loading?: boolean;
  loadingLabel?: ReactNode;
  size?: ButtonSize;
  variant?: ButtonVariant;
}

type ButtonContent =
  | {
      'aria-label'?: string;
      children: ReactNode;
    }
  | {
      'aria-label': string;
      children?: never;
      icon: ReactNode;
    };

export type ButtonProps = Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  'aria-label' | 'children'
> &
  ButtonOptions &
  ButtonContent;

/** Shared Rafraf action button. It never owns product behavior. */
export function Button({
  children,
  className,
  disabled,
  fullWidth = false,
  icon,
  iconPosition = 'start',
  loading = false,
  loadingLabel,
  size = 'md',
  type = 'button',
  variant = 'primary',
  ...props
}: ButtonProps) {
  const label = loading ? (loadingLabel ?? children) : children;
  const classes = ['rafraf-button', className].filter(Boolean).join(' ');

  return (
    <button
      {...props}
      type={type}
      className={classes}
      data-variant={variant}
      data-size={size}
      data-full-width={fullWidth || undefined}
      data-loading={loading || undefined}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
    >
      {loading ? (
        <LoaderCircle className="rafraf-button__spinner" aria-hidden />
      ) : icon && iconPosition === 'start' ? (
        <span className="rafraf-button__icon" aria-hidden>
          {icon}
        </span>
      ) : null}

      <span className="rafraf-button__label">{label}</span>

      {!loading && icon && iconPosition === 'end' ? (
        <span className="rafraf-button__icon" aria-hidden>
          {icon}
        </span>
      ) : null}
    </button>
  );
}
