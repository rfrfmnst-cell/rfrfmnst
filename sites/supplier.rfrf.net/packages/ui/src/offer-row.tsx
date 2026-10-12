import type { CSSProperties, JSX, MouseEventHandler } from 'react';

export type OfferRowState = 'default' | 'selected';

export interface OfferRowProps {
  supplier: string;
  city: string;
  rating: string;
  availability: string;
  delivery: string;
  price: string;
  initial: string;
  recommended?: boolean;
  state?: OfferRowState;
  disabled?: boolean;
  className?: string;
  onSelect?: MouseEventHandler<HTMLButtonElement>;
}

const colors = {
  surface: 'var(--rafraf-color-bg-surface, #ffffff)',
  surfaceSoft: 'var(--rafraf-color-bg-surface-soft, #faf7f2)',
  border: 'var(--rafraf-color-border-default, #ede6dd)',
  borderBrand: 'var(--rafraf-color-border-brand, #4f2a78)',
  text: 'var(--rafraf-color-text-primary, #32312f)',
  muted: 'var(--rafraf-color-text-secondary, #6e665e)',
  brand: 'var(--rafraf-color-text-brand, #4f2a78)',
  inverse: 'var(--rafraf-color-text-inverse, #ffffff)',
  accent: 'var(--rafraf-color-bg-accent, #ee732d)',
  brandBg: 'var(--rafraf-color-bg-brand, #4f2a78)',
  success: 'var(--rafraf-color-status-success, #14804a)',
} as const;

const dataText: CSSProperties = {
  fontFamily: 'Inter, sans-serif',
  fontSize: 14,
  fontWeight: 600,
  lineHeight: '20px',
  whiteSpace: 'nowrap',
};

const labelText: CSSProperties = {
  fontFamily: 'var(--font-rafraf-sans, "Noto Sans Arabic", sans-serif)',
  fontSize: 13,
  fontWeight: 500,
  lineHeight: '20px',
};

export function OfferRow({
  supplier,
  city,
  rating,
  availability,
  delivery,
  price,
  initial,
  recommended = false,
  state = 'default',
  disabled = false,
  className,
  onSelect,
}: OfferRowProps): JSX.Element {
  const selected = state === 'selected';

  return (
    <button
      type="button"
      dir="rtl"
      aria-pressed={selected}
      aria-label={`${supplier}، ${price}، ${delivery}`}
      disabled={disabled}
      className={className}
      onClick={onSelect}
      data-state={state}
      data-recommended={recommended || undefined}
      style={{
        width: 'min(100%, 672px)',
        minHeight: 70,
        padding: '0 24px',
        display: 'grid',
        gridTemplateColumns: '32px minmax(0, 184px) 58px 76px 76px 88px 20px',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 12,
        overflow: 'hidden',
        color: colors.text,
        background: selected ? colors.surfaceSoft : colors.surface,
        border: `1px solid ${selected ? colors.borderBrand : colors.border}`,
        borderRadius: 'var(--rafraf-radius-md, 12px)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.62 : 1,
        textAlign: 'right',
      }}
    >
      <span
        aria-hidden
        style={{
          width: 32,
          height: 32,
          display: 'grid',
          placeItems: 'center',
          color: colors.inverse,
          background: selected ? colors.brandBg : colors.accent,
          borderRadius: 'var(--rafraf-radius-full, 999px)',
          ...labelText,
        }}
      >
        {initial}
      </span>

      <span style={{ minWidth: 0, display: 'grid', alignContent: 'center' }}>
        <strong
          style={{
            ...labelText,
            overflow: 'hidden',
            color: colors.text,
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {supplier}
        </strong>
        <span
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'flex-start',
            gap: 4,
            color: colors.muted,
            fontFamily:
              'var(--font-rafraf-sans, "Noto Sans Arabic", sans-serif)',
            fontSize: 12,
            lineHeight: '20px',
          }}
        >
          {city}
          {recommended ? (
            <span
              style={{
                paddingInline: 8,
                color: colors.brand,
                background: colors.surfaceSoft,
                borderRadius: 'var(--rafraf-radius-full, 999px)',
              }}
            >
              موصى به
            </span>
          ) : null}
        </span>
      </span>

      <span
        dir="ltr"
        style={{ ...dataText, color: colors.accent, textAlign: 'center' }}
      >
        {rating}
      </span>

      <span
        style={{ ...labelText, color: colors.success, textAlign: 'center' }}
      >
        {availability}
        <span aria-hidden style={{ marginInlineStart: 7 }}>
          •
        </span>
      </span>

      <span style={{ ...labelText, color: colors.muted, textAlign: 'center' }}>
        {delivery}
      </span>

      <strong
        dir="auto"
        style={{
          ...dataText,
          color: selected ? colors.brand : colors.text,
          textAlign: 'center',
        }}
      >
        {price}
      </strong>

      <span
        aria-hidden
        style={{
          width: 18,
          height: 18,
          display: 'grid',
          placeItems: 'center',
          justifySelf: 'center',
          background: colors.surface,
          border: `1px solid ${selected ? colors.borderBrand : colors.border}`,
          borderRadius: '50%',
        }}
      >
        {selected ? (
          <span
            style={{
              width: 8,
              height: 8,
              background: colors.brandBg,
              borderRadius: '50%',
            }}
          />
        ) : null}
      </span>
    </button>
  );
}
