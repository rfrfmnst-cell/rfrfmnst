'use client';

import { PartSearchMethods } from '../part-search-methods';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { AssistantRuntimeProvider } from '@assistant-ui/react';
import { VoiceInput } from './voice-input';
import { appendVoiceTranscript } from './voice-input-text';
import {
  AssistantChatTransport,
  useChatRuntime,
} from '@assistant-ui/react-ai-sdk';
import {
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai';
import { ChevronDown, ClipboardList, ImageIcon, RotateCcw } from 'lucide-react';
import {
  AssistantComposer,
  AssistantThreadFeed,
  AssistantThreadRoot,
} from '@rafraf/ui/assistant-thread';
import {
  isChatImageMediaType,
  parseChatAttachmentReference,
} from '../../lib/chat-image-parts';
import { chatAuthRecoveryPath } from '../../lib/customer-proxy-policy';
import { ChatHeader } from './production-chat-shell';
import {
  PhotoCaptureDialog,
  customerPhotoText,
  type CustomerPhoto,
} from './photo-capture-dialog';
import {
  externalStateFromMessages,
  mergeChatMessagePages,
  messagesFromExternalState,
} from './production-chat-history';
import { RequestContextPanel } from './production-chat-request-context';
import type {
  SelectedQuoteSummary,
  ThreadPayload,
} from './production-chat-types';

function selectedQuoteFromEvent(value: unknown): SelectedQuoteSummary | null {
  if (!value || typeof value !== 'object' || !('quote' in value)) return null;
  const quote = value.quote;
  if (!quote || typeof quote !== 'object') return null;
  const candidate = quote as Record<string, unknown>;
  if (
    typeof candidate.quoteId !== 'string' ||
    candidate.quoteId.length < 10 ||
    candidate.quoteId.length > 64 ||
    typeof candidate.finalPrice !== 'string' ||
    typeof candidate.currency !== 'string'
  ) {
    return null;
  }
  const nullableNumber = (field: unknown) =>
    field === null ||
    (typeof field === 'number' && Number.isFinite(field) && field >= 0);
  if (
    !nullableNumber(candidate.deliveryDaysMin) ||
    !nullableNumber(candidate.deliveryDaysMax) ||
    !nullableNumber(candidate.warrantyMonths)
  ) {
    return null;
  }
  const fitmentConfidence =
    typeof candidate.fitmentConfidence === 'number' &&
    Number.isFinite(candidate.fitmentConfidence) &&
    candidate.fitmentConfidence >= 0 &&
    candidate.fitmentConfidence <= 1
      ? candidate.fitmentConfidence
      : null;
  const sourceType =
    candidate.sourceType === 'LOCAL' || candidate.sourceType === 'GLOBAL'
      ? candidate.sourceType
      : null;
  return {
    quoteId: candidate.quoteId,
    finalPrice: candidate.finalPrice.slice(0, 32),
    currency: candidate.currency.slice(0, 8),
    deliveryDaysMin: candidate.deliveryDaysMin as number | null,
    deliveryDaysMax: candidate.deliveryDaysMax as number | null,
    warrantyMonths: candidate.warrantyMonths as number | null,
    fitmentConfidence,
    sourceType,
  };
}

export function AuthenticatedChat({
  thread,
  pendingText,
  initialComposerText,
  composerSnapshotRef,
  attachmentRequested,
  focusOnMount,
  onPendingSent,
  onFocusApplied,
  onEntryApplied,
}: {
  thread: ThreadPayload;
  pendingText: string;
  initialComposerText: string;
  composerSnapshotRef: { current: (() => string) | null };
  attachmentRequested: boolean;
  focusOnMount: boolean;
  onPendingSent: () => void;
  onFocusApplied: () => void;
  onEntryApplied: () => void;
}) {
  const [error, setError] = useState('');
  const [uploading, setUploading] = useState(false);
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);
  const [showAttachmentIntent, setShowAttachmentIntent] =
    useState(attachmentRequested);
  const [contextThread, setContextThread] = useState(thread);
  const [contextRefreshing, setContextRefreshing] = useState(false);
  const [olderCursor, setOlderCursor] = useState(thread.olderCursor);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [runtimeRunning, setRuntimeRunning] = useState(false);
  const [historyAnnouncement, setHistoryAnnouncement] = useState('');
  const [selectedQuote, setSelectedQuote] =
    useState<SelectedQuoteSummary | null>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const sentRef = useRef(false);
  const entryAppliedRef = useRef(false);
  const focusAppliedRef = useRef(false);
  const composerAutoFocus = useRef(!focusOnMount).current;
  const refreshContext = useCallback(async () => {
    setContextRefreshing(true);
    try {
      const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(thread.id)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) return;
      const data = (await response.json()) as { thread?: ThreadPayload };
      if (data.thread?.id === thread.id) setContextThread(data.thread);
    } catch {
      // Keep the last authoritative summary; chat errors have their own retry UI.
    } finally {
      setContextRefreshing(false);
    }
  }, [thread.id]);
  const transport = useMemo(
    () =>
      new AssistantChatTransport<UIMessage>({
        api: '/api/chat',
        prepareSendMessagesRequest: ({ messages }) => ({
          body: {
            threadId: thread.id,
            messages: messages.slice(-1),
            attemptId: crypto.randomUUID(),
          },
        }),
      }),
    [thread.id],
  );
  const runtime = useChatRuntime<UIMessage>({
    id: thread.id,
    messages: thread.messages,
    transport,
    sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses,
    onError: (error) => {
      const recoveryPath = chatAuthRecoveryPath(error);
      if (recoveryPath) {
        window.location.assign(recoveryPath);
        return;
      }
      setError('تعذّر إكمال الرد الآن. رسالتك محفوظة؛ يمكنك إعادة المحاولة.');
      void refreshContext();
    },
    onFinish: async () => {
      await refreshContext();
    },
  });

  useEffect(() => {
    composerSnapshotRef.current = () => runtime.thread.composer.getState().text;
    return () => {
      composerSnapshotRef.current = null;
    };
  }, [composerSnapshotRef, runtime]);

  useEffect(() => {
    const update = () => setRuntimeRunning(runtime.thread.getState().isRunning);
    update();
    return runtime.thread.subscribe(update);
  }, [runtime]);

  async function loadOlderMessages() {
    if (!olderCursor || loadingOlder || runtime.thread.getState().isRunning)
      return;
    setLoadingOlder(true);
    setError('');
    try {
      const response = await fetch(
        `/api/chat/threads/${encodeURIComponent(thread.id)}?before=${encodeURIComponent(olderCursor)}`,
        { cache: 'no-store' },
      );
      if (!response.ok) throw new Error('CHAT_HISTORY_UNAVAILABLE');
      const data = (await response.json()) as { thread?: ThreadPayload };
      if (!data.thread || data.thread.id !== thread.id) {
        throw new Error('CHAT_HISTORY_MISMATCH');
      }
      const current = messagesFromExternalState(
        runtime.thread.exportExternalState(),
      );
      const merged = mergeChatMessagePages(
        data.thread.messages,
        current.length ? current : thread.messages,
      );
      runtime.thread.importExternalState(externalStateFromMessages(merged));
      setOlderCursor(data.thread.olderCursor);
      setHistoryAnnouncement(
        `تم تحميل ${data.thread.messages.length} رسالة أقدم.`,
      );
    } catch {
      setError('تعذّر تحميل الرسائل الأقدم. حاول مرة أخرى.');
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    if (!pendingText || sentRef.current) return;
    sentRef.current = true;
    runtime.thread.composer.setText(pendingText);
    runtime.thread.composer.send();
    onPendingSent();
  }, [onPendingSent, pendingText, runtime]);

  useEffect(() => {
    if (
      entryAppliedRef.current ||
      (!initialComposerText && !attachmentRequested)
    ) {
      return;
    }
    entryAppliedRef.current = true;
    if (initialComposerText) {
      runtime.thread.composer.setText(initialComposerText);
    }
    setShowAttachmentIntent(attachmentRequested);
    onEntryApplied();
  }, [attachmentRequested, initialComposerText, onEntryApplied, runtime]);

  useLayoutEffect(() => {
    if (!focusOnMount || focusAppliedRef.current || !headingRef.current) return;
    focusAppliedRef.current = true;
    headingRef.current.focus();
    onFocusApplied();
  }, [focusOnMount, onFocusApplied]);

  useEffect(() => {
    const selectQuote = (event: Event) => {
      const quote = selectedQuoteFromEvent(
        (event as CustomEvent<unknown>).detail,
      );
      if (!quote) return;
      setSelectedQuote(quote);
      runtime.thread.composer.setText(
        `أريد اعتماد العرض المحدد بمعرّف ${quote.quoteId}. اعرض عليّ بطاقة الموافقة قبل التنفيذ.`,
      );
      runtime.thread.composer.send();
    };
    window.addEventListener('rafraf:select-quote', selectQuote);
    return () => window.removeEventListener('rafraf:select-quote', selectQuote);
  }, [runtime]);

  async function upload(photo: CustomerPhoto) {
    if (uploading || runtime.thread.getState().isRunning) return;
    const { file, imageKind, description } = photo;
    setUploading(true);
    setError('');
    try {
      const data = new FormData();
      data.set('threadId', thread.id);
      data.set('file', file);
      data.set('imageKind', imageKind);
      if (description) data.set('description', description);
      const response = await fetch('/api/chat/attachments', {
        method: 'POST',
        body: data,
      });
      if (!response.ok) {
        let code = '';
        try {
          code = String(
            ((await response.json()) as { error?: unknown }).error ?? '',
          );
        } catch {
          // Keep a generic upload failure for non-JSON intermediary errors.
        }
        setError(
          code === 'customer_attachment_limit'
            ? 'بلغت الحد الإجمالي للصور المحفوظة في حسابك.'
            : code === 'attachment_limit'
              ? 'الحد الأقصى صورتان لكل طلب.'
              : 'تعذّر رفع الصورة. استخدم JPEG أو PNG أو WebP بحجم لا يتجاوز 5MB.',
        );
        return;
      }
      const uploaded = (await response.json()) as {
        url?: unknown;
        mediaType?: unknown;
      };
      if (
        typeof uploaded.url !== 'string' ||
        !isChatImageMediaType(uploaded.mediaType) ||
        uploaded.mediaType !== file.type
      ) {
        setError('تعذّر التحقق من الصورة المرفوعة. حاول رفعها مرة أخرى.');
        return;
      }
      const reference = parseChatAttachmentReference(
        uploaded.url,
        window.location.origin,
      );
      if (
        !reference ||
        reference.mediaType !== uploaded.mediaType ||
        reference.key.split('/')[1] !== thread.id
      ) {
        setError('تعذّر التحقق من الصورة المرفوعة. حاول رفعها مرة أخرى.');
        return;
      }
      const filename =
        file.name.split(/[\\/]/).at(-1)?.trim().slice(0, 120) || 'image';
      await refreshContext();
      runtime.thread.append({
        role: 'user',
        content: [
          {
            type: 'text',
            text: customerPhotoText(photo),
          },
          {
            type: 'file',
            data: reference.url.toString(),
            mimeType: uploaded.mediaType,
            sourceType: 'url',
            filename,
          },
        ],
      });
    } catch {
      setError('تعذّر رفع الصورة. تحقق من الاتصال ثم حاول مرة أخرى.');
    } finally {
      setUploading(false);
    }
  }

  function retry() {
    setError('');
    const last = runtime.thread.getState().messages.at(-1);
    runtime.thread.startRun({ parentId: last?.id ?? null });
  }

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <AssistantThreadRoot>
        <ChatHeader headingRef={headingRef} />
        <main className="rf-ai-main">
          <PartSearchMethods disabled={uploading || runtimeRunning} onPhoto={() => setPhotoDialogOpen(true)} onApply={(input) => {
            if (uploading || runtime.thread.getState().isRunning) return;
            if (input.text) runtime.thread.composer.setText([runtime.thread.composer.getState().text, input.text].filter(Boolean).join('\n'));
          }} />
          <details className="rf-chat-request-details">
            <summary>
              <ClipboardList size={18} aria-hidden="true" />
              <span>تفاصيل الطلب</span>
              <small>المركبة والقطعة والصور</small>
              <ChevronDown size={17} aria-hidden="true" />
            </summary>
            <div className="rf-chat-request-scroll">
              <RequestContextPanel
                thread={contextThread}
                refreshing={contextRefreshing}
                selectedQuote={selectedQuote}
              />
            </div>
          </details>
          <section className="rf-ai-intake rf-production-intake">
            <div className="rf-ai-conversation">
              {olderCursor ? (
                <div className="rf-chat-message-history">
                  <button
                    type="button"
                    disabled={loadingOlder || runtimeRunning}
                    onClick={() => void loadOlderMessages()}
                  >
                    {loadingOlder ? 'جاري التحميل…' : 'تحميل رسائل أقدم'}
                  </button>
                </div>
              ) : null}
              <p className="sr-only" role="status" aria-live="polite">
                {historyAnnouncement}
              </p>
              <AssistantThreadFeed />
              {error ? (
                <div className="rf-chat-error" role="alert">
                  <span>{error}</span>
                  <button type="button" onClick={retry}>
                    <RotateCcw size={15} /> إعادة المحاولة
                  </button>
                </div>
              ) : null}
            </div>
          </section>
          {showAttachmentIntent ? (
            <div className="rf-chat-entry-intent" role="status">
              <ImageIcon size={20} aria-hidden="true" />
              <span>
                <strong>جاهز لإضافة صورة القطعة أو المركبة</strong>
                <small>
                  اختر نوع الصورة؛ نصغّرها ونزيل بيانات الموقع قبل الرفع.
                </small>
              </span>
              <button
                type="button"
                disabled={uploading || runtimeRunning}
                onClick={() => setPhotoDialogOpen(true)}
              >
                اختيار الصورة
              </button>
            </div>
          ) : null}
        </main>
        <PhotoCaptureDialog
          open={photoDialogOpen}
          onClose={() => setPhotoDialogOpen(false)}
          onSelected={(photo) => {
            setShowAttachmentIntent(false);
            void upload(photo);
          }}
        />
        <AssistantComposer
          onAttach={() => setPhotoDialogOpen(true)}
          attachDisabled={uploading || runtimeRunning}
          autoFocus={composerAutoFocus}
          showCodeReview
          voiceControl={
            <VoiceInput
              disabled={uploading || runtimeRunning}
              onConfirm={(text) => {
                if (uploading || runtime.thread.getState().isRunning) {
                  throw new Error(
                    'انتظر اكتمال الرد أو رفع الصورة، ثم استخدم النص.',
                  );
                }
                runtime.thread.composer.setText(
                  appendVoiceTranscript(
                    runtime.thread.composer.getState().text,
                    text,
                  ),
                );
              }}
            />
          }
          placeholder={
            uploading
              ? 'جاري رفع الصورة…'
              : 'ابحث بالنص أو الصورة أو رقم الهيكل'
          }
        />
      </AssistantThreadRoot>
    </AssistantRuntimeProvider>
  );
}
