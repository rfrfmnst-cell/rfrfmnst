import {
  AlertTriangle,
  CloudOff,
  FileQuestion,
  LoaderCircle,
  LockKeyhole,
  SearchX,
  type LucideIcon,
} from 'lucide-react';
import type { ReactNode } from 'react';

export type AppStateKind =
  'empty' | 'error' | 'forbidden' | 'loading' | 'not-found' | 'offline';

interface AppStateProps {
  actions?: ReactNode;
  description: string;
  eyebrow?: string;
  kind: AppStateKind;
  title: string;
}

const STATE_ICONS: Record<AppStateKind, LucideIcon> = {
  empty: SearchX,
  error: AlertTriangle,
  forbidden: LockKeyhole,
  loading: LoaderCircle,
  'not-found': FileQuestion,
  offline: CloudOff,
};

/**
 * Canonical full-page state for all Rafraf applications.
 *
 * The component never exposes runtime errors or internal identifiers. Recovery
 * actions are supplied by the owning surface so navigation remains explicit.
 */
export function AppState({
  actions,
  description,
  eyebrow = 'رفرف',
  kind,
  title,
}: AppStateProps) {
  const Icon = STATE_ICONS[kind];
  const loading = kind === 'loading';
  const liveRole = kind === 'error' ? 'alert' : loading ? 'status' : undefined;

  return (
    <section className="rafraf-app-state" data-kind={kind}>
      <div
        className="rafraf-app-state__panel"
        role={liveRole}
        aria-busy={loading || undefined}
      >
        <span className="rafraf-app-state__icon" aria-hidden>
          <Icon size={30} strokeWidth={1.8} />
        </span>
        <p className="rafraf-app-state__eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p className="rafraf-app-state__description">{description}</p>

        {loading ? (
          <div className="rafraf-app-state__skeleton" aria-hidden>
            <span />
            <span />
            <span />
          </div>
        ) : null}

        {actions ? (
          <div className="rafraf-app-state__actions">{actions}</div>
        ) : null}
      </div>
    </section>
  );
}
