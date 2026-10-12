'use client';

import Link from 'next/link';
import {
  Headphones,
  Home,
  Menu,
  MessageCircle,
  Plus,
  Search,
  Trash2,
  WalletCards,
  X,
} from 'lucide-react';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type RefObject,
} from 'react';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { ThemeToggle } from '@rafraf/ui/theme-toggle';
import type { ThreadSummary } from './production-chat-types';

type ChatNavigationContextValue = {
  dialogId: string;
  dialogRef: RefObject<HTMLDialogElement | null>;
  desktop: boolean | null;
  open: boolean;
  openNavigation: () => void;
  closeNavigation: () => void;
};

const ChatNavigationContext = createContext<ChatNavigationContextValue | null>(
  null,
);

function useChatNavigation() {
  const navigation = useContext(ChatNavigationContext);
  if (!navigation) {
    throw new Error('Chat navigation requires ChatNavigationProvider');
  }
  return navigation;
}

export function ChatNavigationProvider({ children }: { children: ReactNode }) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDialogElement>(null);
  const [desktop, setDesktop] = useState<boolean | null>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px)');
    function syncBreakpoint() {
      setOpen(false);
      setDesktop(query.matches);
    }
    syncBreakpoint();
    query.addEventListener('change', syncBreakpoint);
    return () => query.removeEventListener('change', syncBreakpoint);
  }, []);

  const closeNavigation = useCallback(() => {
    if (!desktop && dialogRef.current?.open) dialogRef.current.close();
    setOpen(false);
  }, [desktop]);

  return (
    <ChatNavigationContext.Provider
      value={{
        dialogId,
        dialogRef,
        desktop,
        open,
        openNavigation: () => setOpen(true),
        closeNavigation,
      }}
    >
      {children}
    </ChatNavigationContext.Provider>
  );
}

export function ChatNavigationControls() {
  const { dialogId, open, openNavigation } = useChatNavigation();
  return (
    <div className="rf-chat-controls">
      <button
        type="button"
        className="rf-chat-navigation-toggle"
        onClick={openNavigation}
        aria-label="فتح سجل المحادثات"
        aria-expanded={open}
        aria-controls={dialogId}
      >
        <Menu size={21} aria-hidden="true" />
      </button>
      <ThemeToggle />
    </div>
  );
}

export function Sidebar({
  threads,
  activeId,
  onSelect,
  onNew,
  onDelete,
  onLoadMore,
  hasMore,
  loadingMore,
  authenticated,
  busy,
  announcement = '',
}: {
  threads: ThreadSummary[];
  activeId?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onDelete: (id: string) => void;
  onLoadMore: () => void;
  hasMore: boolean;
  loadingMore: boolean;
  authenticated: boolean;
  busy: boolean;
  announcement?: string;
}) {
  const { dialogId, dialogRef, desktop, open, closeNavigation } =
    useChatNavigation();
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(
    null,
  );
  const modeRef = useRef<boolean | null>(null);
  const historyTitleId = `${dialogId}-history`;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || desktop === null) return;
    if (modeRef.current !== desktop && dialog.open) dialog.close();
    modeRef.current = desktop;
    if (desktop) {
      // Attribute opening keeps the persistent sidebar from taking focus.
      if (!dialog.open) dialog.setAttribute('open', '');
    } else if (open) {
      if (!dialog.open) dialog.showModal();
    } else if (dialog.open) {
      dialog.close();
    }
  }, [desktop, open, dialogRef]);

  function formattedDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'محفوظة';
    return new Intl.DateTimeFormat('ar-SA', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      calendar: 'gregory',
      numberingSystem: 'latn',
      timeZone: 'Asia/Riyadh',
    }).format(date);
  }

  return (
    <dialog
      id={dialogId}
      ref={dialogRef}
      className="rf-ai-sidebar rf-chat-navigation"
      role={desktop ? 'complementary' : 'dialog'}
      aria-label="سجل المحادثات والتنقل"
      aria-modal={!desktop && open ? true : undefined}
      onCancel={(event) => {
        event.preventDefault();
        closeNavigation();
      }}
      onKeyDown={(event) => {
        if (
          desktop ||
          !open ||
          event.key !== 'Tab' ||
          event.altKey ||
          event.ctrlKey ||
          event.metaKey
        ) {
          return;
        }
        const dialog = event.currentTarget;
        const controls = Array.from(
          dialog.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href]',
          ),
        ).filter(
          (control) =>
            control.tabIndex >= 0 &&
            control.getClientRects().length > 0 &&
            getComputedStyle(control).visibility !== 'hidden',
        );
        const first = controls[0];
        const last = controls.at(-1);
        if (!first || !last) return;
        const active = document.activeElement;
        if (
          active === dialog ||
          (event.shiftKey ? active === first : active === last)
        ) {
          event.preventDefault();
          (event.shiftKey ? last : first).focus();
        }
      }}
      onClose={() => {
        // A breakpoint switch immediately reopens the same content tree.
        if (dialogRef.current?.open) return;
        setConfirmingDeleteId(null);
        closeNavigation();
      }}
      onClick={(event) => {
        if (desktop || event.target !== event.currentTarget) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        if (
          event.clientX < bounds.left ||
          event.clientX > bounds.right ||
          event.clientY < bounds.top ||
          event.clientY > bounds.bottom
        ) {
          closeNavigation();
        }
      }}
    >
      <div className="rf-chat-navigation-head">
        <div className="rf-ai-brand">
          <BrandLogo className="rf-ai-logo" descriptor="مساعد قطع السيارات" />
        </div>
        <button
          type="button"
          className="rf-chat-navigation-close"
          aria-label="إغلاق سجل المحادثات"
          onClick={closeNavigation}
        >
          <X size={20} aria-hidden="true" />
        </button>
      </div>
      <button
        type="button"
        className="rf-ai-new"
        onClick={() => {
          if (!authenticated || busy) return;
          setConfirmingDeleteId(null);
          closeNavigation();
          onNew();
        }}
        aria-disabled={!authenticated || busy}
      >
        <Plus size={18} aria-hidden="true" /> محادثة جديدة
      </button>
      <nav className="rf-ai-nav" aria-label="التنقل الرئيسي">
        <Link href="/" onClick={closeNavigation}>
          <Home size={19} aria-hidden="true" /> الرئيسية
        </Link>
        <Link
          className="is-active"
          href="/chat"
          aria-current="page"
          onClick={closeNavigation}
        >
          <MessageCircle size={19} aria-hidden="true" /> المساعد الذكي
        </Link>
        <Link href="/track" onClick={closeNavigation}>
          <Search size={19} aria-hidden="true" /> تتبع الطلب
        </Link>
      </nav>
      {authenticated ? (
        <section
          className="rf-chat-history"
          aria-labelledby={historyTitleId}
          aria-busy={busy || loadingMore}
        >
          <strong id={historyTitleId}>المحادثات السابقة</strong>
          {threads.length ? (
            threads.map((thread) => {
              const unavailable = busy || thread.id === activeId;
              return (
                <div
                  key={thread.id}
                  className={`rf-chat-history-item${thread.id === activeId ? ' active' : ''}`}
                >
                  <button
                    type="button"
                    className="rf-chat-history-open"
                    onClick={() => {
                      if (unavailable) return;
                      setConfirmingDeleteId(null);
                      closeNavigation();
                      onSelect(thread.id);
                    }}
                    aria-current={thread.id === activeId ? 'true' : undefined}
                    aria-disabled={unavailable}
                  >
                    <MessageCircle size={16} aria-hidden="true" />
                    <span className="rf-chat-history-copy">
                      <strong>{thread.title}</strong>
                      <small className="rf-chat-history-date">
                        {formattedDate(thread.updatedAt)}
                        {thread.rfqId ? ' • مرتبط بطلب تسعير' : ''}
                      </small>
                    </span>
                  </button>
                  <button
                    type="button"
                    className="rf-chat-history-delete"
                    aria-label={`حذف المحادثة: ${thread.title}`}
                    disabled={busy}
                    onClick={() => setConfirmingDeleteId(thread.id)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                  {confirmingDeleteId === thread.id ? (
                    <div
                      className="rf-chat-history-confirm"
                      role="group"
                      aria-label={`تأكيد حذف المحادثة: ${thread.title}`}
                    >
                      <span>حذف هذه المحادثة من السجل؟</span>
                      <button
                        type="button"
                        className="is-danger"
                        disabled={busy}
                        onClick={() => {
                          if (busy) return;
                          setConfirmingDeleteId(null);
                          closeNavigation();
                          onDelete(thread.id);
                        }}
                      >
                        تأكيد الحذف
                      </button>
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => setConfirmingDeleteId(null)}
                      >
                        إلغاء
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })
          ) : (
            <small>لا توجد محادثات محفوظة بعد.</small>
          )}
          {hasMore ? (
            <button
              type="button"
              className="rf-chat-history-more"
              onClick={() => {
                if (!loadingMore && !busy) onLoadMore();
              }}
              disabled={loadingMore || busy}
            >
              {loadingMore ? 'جاري التحميل…' : 'عرض محادثات أقدم'}
            </button>
          ) : null}
        </section>
      ) : null}
      {open && !desktop && announcement ? (
        <p
          className="rf-chat-navigation-status"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {announcement}
        </p>
      ) : null}
      <nav className="rf-ai-nav rf-ai-nav-secondary" aria-label="الثقة والدعم">
        <Link href="/account" onClick={closeNavigation}>
          <WalletCards size={19} aria-hidden="true" /> محفظتي
        </Link>
        <Link href="/privacy" onClick={closeNavigation}>
          <Headphones size={19} aria-hidden="true" /> الخصوصية والدعم
        </Link>
      </nav>
    </dialog>
  );
}
