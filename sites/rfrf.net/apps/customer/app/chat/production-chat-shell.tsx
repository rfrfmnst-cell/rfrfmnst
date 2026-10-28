'use client';

import {
  Camera,
  ClipboardCheck,
  ImageIcon,
  MapPin,
  MessageCircle,
  PackageCheck,
  SendHorizontal,
  ShieldCheck,
} from 'lucide-react';
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type Ref,
} from 'react';
import { BrandLogo } from '@rafraf/ui/brand-logo';
import { InputCodeReview } from '@rafraf/ui/input-code-review';
import type { ChatEntryDraft } from '../../lib/chat-entry-draft';
import { ChatNavigationControls } from './chat-navigation';
import { PartSearchMethods } from '../part-search-methods';
import { VoiceInput } from './voice-input';
import { appendVoiceTranscript } from './voice-input-text';

export { Sidebar } from './chat-navigation';

export function ChatHeader({
  headingRef,
}: {
  headingRef?: Ref<HTMLHeadingElement>;
} = {}) {
  return (
    <header className="rf-ai-header">
      <ChatNavigationControls />
      <div className="rf-ai-agent-title">
        <h1 ref={headingRef} tabIndex={headingRef ? -1 : undefined}>
          مساعد رفرف الذكي
        </h1>
        <span>لا يُنشأ طلب تسعير إلا بموافقتك</span>
      </div>
    </header>
  );
}

export function GuestChat({
  initialDraft,
  onSubmit,
}: {
  initialDraft: ChatEntryDraft | null;
  onSubmit: (text: string, attachmentRequested?: boolean) => void;
}) {
  const [text, setText] = useState(initialDraft?.text ?? '');
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${input.scrollHeight}px`;
  }, [text]);
  const [attachmentRequested, setAttachmentRequested] = useState(
    initialDraft?.attachmentRequested === true,
  );
  function submit(event: FormEvent) {
    event.preventDefault();
    onSubmit(text, attachmentRequested);
  }

  return (
    <div className="rf-ai-page rf-production-thread">
      <ChatHeader />
      <main className="rf-ai-main rf-chat-guest-main">
      <PartSearchMethods onApply={(input) => {
        if (input.text) setText(current => [current, input.text].filter(Boolean).join('\n'));
        if (input.attachmentRequested) { setAttachmentRequested(true); onSubmit(text, true); }
      }} />

        <section className="rf-ai-intake">
          <div className="rf-ai-conversation">
            <div className="rf-chat-welcome">
              <BrandLogo className="rf-chat-welcome-logo" />
              <h2>وش القطعة اللي تبحث عنها؟</h2>
              <p>
                اكتب وصف القطعة أو بيانات سيارتك، ونرتّب التفاصيل معك خطوة
                بخطوة.
              </p>
            </div>
          </div>
          <div className="rf-auth-trust">
            <ShieldCheck size={30} />
            <strong>دردشة موثقة وآمنة</strong>
            <p>
              رسالتك الأولى تبقى مؤقتة، وبعد التحقق تُرسل تلقائياً وتحفظ في
              حسابك.
            </p>
            <div className="rf-auth-steps" aria-label="ما يحدث بعد التوثيق">
              <span>
                <ClipboardCheck size={15} aria-hidden="true" />
                فهم القطعة والسيارة
              </span>
              <span>
                <MapPin size={15} aria-hidden="true" />
                مطابقة موردين في السعودية
              </span>
              <span>
                <PackageCheck size={15} aria-hidden="true" />
                عرض السعر والضمان
              </span>
            </div>
          </div>
        </section>
        {attachmentRequested ? (
          <div className="rf-chat-entry-intent" role="status">
            <ImageIcon size={20} aria-hidden="true" />
            <span>
              <strong>صورتك هي الخطوة التالية</strong>
              <small>
                سنفتح رفع الصورة بعد توثيق الجوال حتى تبقى مرتبطة بطلبك الآمن.
              </small>
            </span>
            <button type="button" onClick={() => onSubmit(text, true)}>
              متابعة لرفع الصورة
            </button>
          </div>
        ) : null}
      </main>
      <form className="rf-ai-composer" onSubmit={submit}>
        <textarea
          ref={inputRef}
          className="rf-assistant-composer-input"
          aria-label="اكتب طلب قطعة الغيار"
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="اكتب اسم القطعة أو السيارة أو رقم الهيكل"
          rows={1}
          autoFocus
        />
        <div className="rf-chat-composer-actions">
          <button
            type="button"
            aria-label="طلب إرفاق صورة بعد توثيق الجوال"
            aria-pressed={attachmentRequested}
            onClick={() => setAttachmentRequested(true)}
          >
            <Camera size={20} />
          </button>
          <VoiceInput
            onConfirm={(transcript) =>
              setText(appendVoiceTranscript(text, transcript))
            }
          />
          <span className="rf-chat-composer-hint">
            وصفك أولاً، ثم نراجع التفاصيل
          </span>
          <button className="rf-ai-send" type="submit" aria-label="إرسال">
            <SendHorizontal size={20} aria-hidden="true" />
          </button>
        </div>
        <InputCodeReview text={text} />
      </form>
    </div>
  );
}

export function CenteredState({
  text,
  action,
  actionLabel = 'محادثة جديدة',
  focusOnMount = false,
}: {
  text: string;
  action?: () => void;
  actionLabel?: string;
  focusOnMount?: boolean;
}) {
  const stateRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (focusOnMount) stateRef.current?.focus();
  }, [focusOnMount]);

  return (
    <div className="rf-ai-page rf-centered-state">
      <ChatHeader />
      <div
        ref={stateRef}
        className="rf-chat-state-body"
        role="status"
        tabIndex={focusOnMount ? -1 : undefined}
      >
        <MessageCircle size={34} aria-hidden="true" />
        <p>{text}</p>
        {action ? (
          <button type="button" onClick={action}>
            {actionLabel}
          </button>
        ) : null}
      </div>
    </div>
  );
}
