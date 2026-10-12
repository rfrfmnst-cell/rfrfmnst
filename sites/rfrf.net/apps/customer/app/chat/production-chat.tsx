'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  consumeChatEntryDraft,
  storeChatEntryDraft,
  type ChatEntryDraft,
} from '../../lib/chat-entry-draft';
import { AuthenticatedChat } from './production-chat-authenticated';
import { OtpDialog } from './production-chat-otp-dialog';
import { CenteredState, GuestChat, Sidebar } from './production-chat-shell';
import type { ThreadPayload, ThreadSummary } from './production-chat-types';
import { ChatNavigationProvider } from './chat-navigation';
import { useChatViewport } from './use-chat-viewport';

async function requestThreadCreation(title: string) {
  const response = await fetch('/api/chat/threads', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title }),
  });
  if (!response.ok) {
    let code = '';
    try {
      code = String(
        ((await response.json()) as { error?: unknown }).error ?? '',
      );
    } catch {
      // Keep the generic message when an intermediary returns a non-JSON body.
    }
    throw new Error(
      code === 'thread_limit'
        ? 'بلغت الحد الأقصى للمحادثات المحفوظة. واصل في محادثة سابقة.'
        : 'تعذّر إنشاء المحادثة.',
    );
  }
  const data = (await response.json()) as { thread: ThreadSummary };
  return {
    summary: data.thread,
    payload: {
      ...data.thread,
      messages: [],
      draft: {},
      olderCursor: null,
    } satisfies ThreadPayload,
  };
}

export function ProductionChat({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string;
}) {
  const shellRef = useChatViewport();
  const [status, setStatus] = useState<
    'loading' | 'guest' | 'authenticated' | 'error'
  >('loading');
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [nextThreadCursor, setNextThreadCursor] = useState<string | null>(null);
  const [loadingMoreThreads, setLoadingMoreThreads] = useState(false);
  const [active, setActive] = useState<ThreadPayload | null>(null);
  const [pendingText, setPendingText] = useState('');
  const [recoveredComposerText, setRecoveredComposerText] = useState('');
  const composerSnapshotRef = useRef<(() => string) | null>(null);
  const [pendingAttachment, setPendingAttachment] = useState(false);
  const [entryDraft, setEntryDraft] = useState<ChatEntryDraft | null>(null);
  const [threadTransition, setThreadTransition] = useState<string | null>(null);
  const [threadAnnouncement, setThreadAnnouncement] = useState('');
  const [focusThreadId, setFocusThreadId] = useState<string | null>(null);
  const [otpOpen, setOtpOpen] = useState(false);
  const initializationStarted = useRef(false);
  const transitionSequence = useRef(0);

  const loadThread = useCallback(async (id: string) => {
    const response = await fetch(
      `/api/chat/threads/${encodeURIComponent(id)}`,
      { cache: 'no-store' },
    );
    if (!response.ok) throw new Error('تعذّر استعادة المحادثة.');
    const data = (await response.json()) as { thread: ThreadPayload };
    return data.thread;
  }, []);

  const refresh = useCallback(
    async (draft: ChatEntryDraft | null = null) => {
      const transition = ++transitionSequence.current;
      setStatus('loading');
      setActive(null);
      setFocusThreadId(null);
      setThreadAnnouncement('');
      setThreadTransition('restore');
      try {
        const response = await fetch('/api/chat/threads', {
          cache: 'no-store',
        });
        if (response.status === 401) {
          if (transition !== transitionSequence.current) return;
          setThreads([]);
          setStatus('guest');
          return;
        }
        if (!response.ok) throw new Error('THREADS_UNAVAILABLE');
        const data = (await response.json()) as {
          threads: ThreadSummary[];
          nextCursor: string | null;
        };

        let nextThreads = data.threads;
        let nextActive: ThreadPayload | null = null;
        if (draft) {
          const created = await requestThreadCreation(
            draft.text.slice(0, 80) || 'طلب جديد بصورة',
          );
          nextThreads = [
            created.summary,
            ...data.threads.filter(
              (thread) => thread.id !== created.summary.id,
            ),
          ];
          nextActive = created.payload;
        } else if (data.threads[0]) {
          nextActive = await loadThread(data.threads[0].id);
        }

        if (transition !== transitionSequence.current) return;
        setThreads(nextThreads);
        setNextThreadCursor(data.nextCursor);
        setActive(nextActive);
        setStatus('authenticated');
        if (draft && nextActive) {
          setFocusThreadId(nextActive.id);
          setThreadAnnouncement('تم تجهيز محادثة جديدة من وصفك المحفوظ.');
        }
      } catch {
        if (transition === transitionSequence.current) setStatus('error');
      } finally {
        if (transition === transitionSequence.current) {
          setThreadTransition(null);
        }
      }
    },
    [loadThread],
  );

  async function loadMoreThreads() {
    if (!nextThreadCursor || loadingMoreThreads || threadTransition) return;
    setThreadAnnouncement('');
    setLoadingMoreThreads(true);
    try {
      const response = await fetch(
        `/api/chat/threads?cursor=${encodeURIComponent(nextThreadCursor)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('THREADS_UNAVAILABLE');
      const data = (await response.json()) as {
        threads: ThreadSummary[];
        nextCursor: string | null;
      };
      setThreads((current) => {
        const ids = new Set(current.map((thread) => thread.id));
        return [
          ...current,
          ...data.threads.filter((thread) => !ids.has(thread.id)),
        ];
      });
      setNextThreadCursor(data.nextCursor);
    } catch {
      setThreadAnnouncement('تعذّر تحميل محادثات أقدم. حاول مرة أخرى.');
    } finally {
      setLoadingMoreThreads(false);
    }
  }

  useEffect(() => {
    if (initializationStarted.current) return;
    initializationStarted.current = true;
    let draft: ChatEntryDraft | null = null;
    try {
      draft = consumeChatEntryDraft(window.sessionStorage);
    } catch {
      // A privacy-hardened browser may deny access to session storage entirely.
    }
    setEntryDraft(draft);
    void refresh(draft);
  }, [refresh]);

  async function createThread(title = 'محادثة جديدة') {
    const created = await requestThreadCreation(title);
    setThreads((current) => [
      created.summary,
      ...current.filter((thread) => thread.id !== created.summary.id),
    ]);
    setActive(created.payload);
    return created.payload;
  }

  function gateFirstMessage(text: string, attachmentRequested = false) {
    const clean = text.trim();
    if (!clean && !attachmentRequested) return;
    setPendingText(clean);
    setPendingAttachment(attachmentRequested);
    setOtpOpen(true);
  }

  async function afterVerified() {
    const thread = await createThread(
      pendingText.slice(0, 80) || 'طلب جديد بصورة',
    );
    setActive(thread);
    setEntryDraft(null);
    setStatus('authenticated');
    setFocusThreadId(thread.id);
    setThreadAnnouncement('تم توثيق جوالك وفتح محادثتك الجديدة.');
    setOtpOpen(false);
  }

  async function selectThread(id: string) {
    if (id === active?.id || threadTransition) return;
    const selectedTitle = threads.find((thread) => thread.id === id)?.title;
    const transition = ++transitionSequence.current;
    setThreadAnnouncement('');
    setThreadTransition(id);
    setActive(null);
    try {
      const thread = await loadThread(id);
      if (transition === transitionSequence.current) {
        setActive(thread);
        setFocusThreadId(thread.id);
        setThreadAnnouncement(
          selectedTitle
            ? `تم فتح المحادثة: ${selectedTitle}`
            : 'تم فتح المحادثة المطلوبة.',
        );
      }
    } catch {
      if (transition === transitionSequence.current) {
        setStatus('error');
        setThreadAnnouncement('تعذّر فتح المحادثة المطلوبة.');
      }
    } finally {
      if (transition === transitionSequence.current) setThreadTransition(null);
    }
  }

  async function startNewThread() {
    if (threadTransition) return;
    const transition = ++transitionSequence.current;
    setThreadAnnouncement('');
    setThreadTransition('new');
    setActive(null);
    try {
      const thread = await createThread();
      if (transition === transitionSequence.current) {
        setFocusThreadId(thread.id);
        setThreadAnnouncement('تم فتح محادثة جديدة.');
      }
    } catch (error) {
      if (transition === transitionSequence.current) {
        setActive(threads[0] ? await loadThread(threads[0].id) : null);
        setThreadAnnouncement(
          error instanceof Error ? error.message : 'تعذّر إنشاء محادثة جديدة.',
        );
      }
    } finally {
      if (transition === transitionSequence.current) setThreadTransition(null);
    }
  }

  async function deleteThread(id: string) {
    if (threadTransition) return;
    const transition = ++transitionSequence.current;
    const previousActive = active;
    const remaining = threads.filter((thread) => thread.id !== id);
    const deletingActive = active?.id === id;
    const previousDraft = deletingActive
      ? (composerSnapshotRef.current?.() ?? '')
      : '';
    setThreadAnnouncement('');
    setThreadTransition(`delete:${id}`);
    if (deletingActive) setActive(null);
    try {
      const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(id)}`,
        { method: 'DELETE' },
      );
      if (!response.ok) {
        let code = '';
        try {
          code = String(
            ((await response.json()) as { error?: unknown }).error ?? '',
          );
        } catch {
          // Keep the generic failure for non-JSON intermediary responses.
        }
        throw new Error(
          code === 'thread_busy' ? 'THREAD_BUSY' : 'DELETE_FAILED',
        );
      }
      if (transition !== transitionSequence.current) return;
      setThreads(remaining);
      if (deletingActive) {
        const next = remaining[0] ? await loadThread(remaining[0].id) : null;
        if (transition !== transitionSequence.current) return;
        setActive(next);
        if (next) setFocusThreadId(next.id);
      }
      setThreadAnnouncement('تم حذف المحادثة من سجلك.');
    } catch (error) {
      if (transition !== transitionSequence.current) return;
      if (deletingActive) {
        setRecoveredComposerText(previousDraft);
        setActive(previousActive);
        if (previousActive) setFocusThreadId(previousActive.id);
      }
      setThreadAnnouncement(
        error instanceof Error && error.message === 'THREAD_BUSY'
          ? 'انتظر اكتمال رد المساعد ثم أعد حذف المحادثة.'
          : 'تعذّر حذف المحادثة. حاول مرة أخرى.',
      );
    } finally {
      if (transition === transitionSequence.current) setThreadTransition(null);
    }
  }

  return (
    <ChatNavigationProvider>
      <div ref={shellRef} className="rf-ai-shell rf-production-shell" dir="rtl">
        <Sidebar
          threads={threads}
          announcement={threadAnnouncement}
          activeId={active?.id}
          onSelect={(id) => void selectThread(id)}
          onNew={() => void startNewThread()}
          onDelete={(id) => void deleteThread(id)}
          onLoadMore={() => void loadMoreThreads()}
          hasMore={Boolean(nextThreadCursor)}
          loadingMore={loadingMoreThreads}
          authenticated={status === 'authenticated'}
          busy={Boolean(threadTransition)}
        />
        <p
          className="sr-only"
          role="status"
          aria-live="polite"
          aria-atomic="true"
        >
          {threadAnnouncement}
        </p>
        {status === 'loading' ? (
          <CenteredState text="جاري استعادة محادثاتك…" />
        ) : null}
        {status === 'error' ? (
          <CenteredState
            text="تعذّر الاتصال بخدمة المحادثات. رسائلك المحفوظة لم تتأثر."
            action={() => void refresh(entryDraft)}
            actionLabel="إعادة المحاولة"
            focusOnMount
          />
        ) : null}
        {status === 'guest' ? (
          <GuestChat initialDraft={entryDraft} onSubmit={gateFirstMessage} />
        ) : null}
        {status === 'authenticated' && active ? (
          <AuthenticatedChat
            key={active.id}
            thread={active}
            pendingText={pendingText}
            initialComposerText={
              recoveredComposerText || entryDraft?.text || ''
            }
            composerSnapshotRef={composerSnapshotRef}
            attachmentRequested={
              pendingAttachment || entryDraft?.attachmentRequested === true
            }
            focusOnMount={focusThreadId === active.id}
            onPendingSent={() => setPendingText('')}
            onFocusApplied={() => setFocusThreadId(null)}
            onEntryApplied={() => {
              setRecoveredComposerText('');
              setEntryDraft(null);
              setPendingAttachment(false);
            }}
          />
        ) : null}
        {status === 'authenticated' && !active && threadTransition ? (
          <CenteredState text="جاري فتح المحادثة المطلوبة…" />
        ) : null}
        {status === 'authenticated' && !active && !threadTransition ? (
          <CenteredState
            text="ابدأ محادثة جديدة لطلب قطعتك."
            action={() => void startNewThread()}
            actionLabel="محادثة جديدة"
          />
        ) : null}
        {otpOpen ? (
          <OtpDialog
            turnstileSiteKey={turnstileSiteKey}
            onClose={() => setOtpOpen(false)}
            onVerified={afterVerified}
            onRegistrationRequired={() =>
              storeChatEntryDraft(window.sessionStorage, {
                text: pendingText,
                attachmentRequested: pendingAttachment,
              })
            }
          />
        ) : null}
      </div>
    </ChatNavigationProvider>
  );
}
