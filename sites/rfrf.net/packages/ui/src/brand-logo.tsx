import type { HTMLAttributes } from 'react';

type BrandLogoProps = HTMLAttributes<HTMLSpanElement> & {
  descriptor?: string;
  compact?: boolean;
};

export function BrandLogo({
  className = '',
  descriptor,
  compact = false,
  ...props
}: BrandLogoProps) {
  return (
    <span
      className={`rafraf-brand ${compact ? 'rafraf-brand--compact' : ''} ${className}`.trim()}
      role="img"
      aria-label={descriptor ? `رفرف — ${descriptor}` : 'رفرف'}
      {...props}
    >
      <span className="rafraf-brand__mark" aria-hidden />
      <span className="rafraf-brand__type">
        <span className="rafraf-brand__wordmark">رفرف</span>
        {descriptor ? (
          <span className="rafraf-brand__descriptor">{descriptor}</span>
        ) : null}
      </span>
    </span>
  );
}
