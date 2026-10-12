'use client';

import {
  AuiIf,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  type TextMessagePartProps,
  type ToolCallMessagePartProps,
  useAuiState,
} from '@assistant-ui/react';
import { Camera, ChevronDown, Mic, SendHorizontal, Square } from 'lucide-react';
import type { PropsWithChildren, ReactNode } from 'react';
import { PartCard, ReserveOrPay } from './assistant-commerce-cards';
import { WebResearchCard } from './assistant-web-research';
import { AssistantText, BidiText } from './assistant-text';
import { ComposerCodeReview } from './input-code-review';
import {
  createRfqReviewRows,
  maskQuoteId,
  maskQuoteIdsInCustomerText,
  partNumberConfirmationValue,
  summarizeToolResult,
} from './assistant-tool-display';

export function AssistantThreadRoot({ children }: PropsWithChildren) {
  return (
    <ThreadPrimitive.Root className="rf-assistant-thread-root">
      <div className="rf-ai-page">{children}</div>
    </ThreadPrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="rf-message bot">
      <MessagePrimitive.Parts
        components={{ Text: AssistantText, tools: { Fallback: ToolPart } }}
      />
    </MessagePrimitive.Root>
  );
}

const toolLabels: Record<string, string> = {
  updateRequestDraft: 'تحديث بيانات الطلب',
  validateVehicle: 'التحقق من المركبة والقطعة',
  createRfq: 'إنشاء طلب التسعير',
  getQuotes: 'جلب العروض الحقيقية',
  getRequestStatus: 'حالة الطلب والخطوة التالية',
  approveQuote: 'اعتماد العرض وحجز الطلب',
  confirmPartNumber: 'تأكيد رقم القطعة من الصورة',
  searchWebParts: 'البحث عن القطعة في الإنترنت',
  readWebSource: 'قراءة مصدر من الإنترنت',
};

const quoteLabels: Record<string, string> = {
  BEST_OVERALL: 'ترشيح رفرف',
  CHEAPEST: 'الأوفر',
  FASTEST: 'الأسرع',
  HIGHEST_WARRANTY: 'الأعلى ضماناً',
  LOWEST_RISK: 'الأقل مخاطرة',
};

const marketLabels = {
  SAUDI: 'السوق السعودي',
  GCC: 'السوق الخليجي',
  GLOBAL: 'السوق العالمي',
} as const;

function ToolPart({
  toolName,
  args,
  approval,
  result,
  isError,
  status,
  respondToApproval,
}: ToolCallMessagePartProps) {
  const waiting =
    approval && approval.approved === undefined && !approval.resolution;
  const summary = summarizeToolResult(result);
  const quotes = toolName === 'getQuotes' ? summary.quotes : [];
  const quoteId =
    args &&
    typeof args === 'object' &&
    'quoteId' in args &&
    typeof args.quoteId === 'string'
      ? args.quoteId
      : null;
  const maskedQuoteId = maskQuoteId(quoteId);
  const reviewRows = toolName === 'createRfq' ? createRfqReviewRows(args) : [];
  const proposedPartNumber = partNumberConfirmationValue(args);
  const rejected = approval?.approved === false;
  const approvalResolution = approval?.resolution;
  return (
    <section
      className="rf-tool-card"
      aria-label={toolLabels[toolName] ?? toolName}
    >
      <strong>{toolLabels[toolName] ?? 'إجراء مساعد رفرف'}</strong>
      {waiting ? (
        <>
          {toolName === 'createRfq' ? (
            <>
              <p>
                سيُنشأ طلب تسعير من بيانات القطعة والمركبة والمرفقات المحفوظة في
                هذه المحادثة فقط.
              </p>
              {reviewRows.map((row) => (
                <span key={row.label}>
                  {row.label}: <b>{row.value}</b>
                </span>
              ))}
              {reviewRows.length === 0 ? (
                <p role="note">
                  راجع بطاقة «ملخص طلبك» المرتبطة بالمحادثة. إن لم تكن البيانات
                  واضحة اختر «رفض» وصححها قبل إنشاء الطلب.
                </p>
              ) : null}
            </>
          ) : toolName === 'confirmPartNumber' ? (
            <>
              <p>
                هذا رقم مستنتج من الصورة. قارنه بالرقم المكتوب على القطعة أو
                الملصق قبل التأكيد.
              </p>
              <bdi dir="ltr">{proposedPartNumber ?? 'رقم غير متاح'}</bdi>
              <small>
                تأكيد الرقم لا يثبت توافق القطعة مع السيارة، ولا ينشئ طلب تسعير.
              </small>
            </>
          ) : (
            <p>سيُعتمد العرض المحدد ويُنشأ الطلب فقط بعد موافقتك.</p>
          )}
          {maskedQuoteId ? (
            <small dir="ltr">Quote: {maskedQuoteId}</small>
          ) : null}
          <div className="rf-tool-actions">
            <button
              type="button"
              onClick={() => respondToApproval({ approved: true })}
            >
              {toolName === 'createRfq'
                ? 'موافقة وإنشاء RFQ'
                : toolName === 'confirmPartNumber'
                  ? 'أؤكد رقم القطعة'
                  : 'موافقة واعتماد العرض'}
            </button>
            <button
              type="button"
              className="is-secondary"
              onClick={() => respondToApproval({ approved: false })}
            >
              رفض
            </button>
          </div>
        </>
      ) : rejected ? (
        <span role="status">
          {toolName === 'confirmPartNumber'
            ? 'لم يُعتمد رقم الصورة. اكتب الرقم الصحيح أو أرفق صورة أوضح.'
            : 'تم رفض الإجراء، ولم يُنشأ طلب أو يُعتمد عرض.'}
        </span>
      ) : approvalResolution === 'expired' ? (
        <span role="status">
          انتهت صلاحية الموافقة، ولم يُنشأ طلب أو يُعتمد عرض.
        </span>
      ) : approvalResolution === 'cancelled' ? (
        <span role="status">
          تم إلغاء الإجراء، ولم يُنشأ طلب أو يُعتمد عرض.
        </span>
      ) : isError || summary.error ? (
        <span role="alert">
          {toolName === 'createRfq'
            ? 'تعذّر إنشاء طلب التسعير، ولم يُنشأ RFQ.'
            : toolName === 'approveQuote'
              ? 'تعذّر اعتماد العرض، ولم يُنشأ طلب.'
              : 'تعذّر تنفيذ الإجراء. حاول مرة أخرى.'}
        </span>
      ) : (toolName === 'searchWebParts' || toolName === 'readWebSource') &&
        result ? (
        <WebResearchCard result={result} />
      ) : toolName === 'confirmPartNumber' &&
        partNumberConfirmationValue(result) ? (
        <span role="status">
          تم تأكيد رقم القطعة{' '}
          <bdi dir="ltr">{partNumberConfirmationValue(result)}</bdi>. يُراجع
          التوافق قبل التسعير.
        </span>
      ) : quotes.length ? (
        <div className="rf-live-quotes">
          {summary.part ? <PartCard part={summary.part} /> : null}
          {quotes.map((quote) => (
            <article key={quote.quoteId}>
              <header>
                <strong>
                  {quote.finalPrice}{' '}
                  {quote.currency === 'SAR' ? 'ر.س' : quote.currency}
                </strong>
                <span>{marketLabels[quote.market]}</span>
              </header>
              <div className="rf-live-quote-meta">
                <span>
                  {quote.fitmentConfidence == null
                    ? 'التوافق قيد المراجعة'
                    : `توافق موثّق ${Math.round(quote.fitmentConfidence * 100)}%`}
                </span>
                <span>
                  {quote.deliveryDaysMin == null
                    ? 'موعد الوصول بعد تأكيد المورد'
                    : `الوصول خلال ${quote.deliveryDaysMin}${quote.deliveryDaysMax && quote.deliveryDaysMax !== quote.deliveryDaysMin ? `–${quote.deliveryDaysMax}` : ''} أيام`}
                </span>
                <span>
                  {quote.warrantyMonths
                    ? `ضمان ${quote.warrantyMonths} شهراً`
                    : 'الضمان حسب العرض'}
                </span>
              </div>
              {quote.labels.length ? (
                <div className="rf-live-quote-labels" aria-label="مزايا العرض">
                  {quote.labels.map((label) => (
                    <span key={label}>{quoteLabels[label] ?? label}</span>
                  ))}
                </div>
              ) : null}
              <button
                type="button"
                onClick={() =>
                  window.dispatchEvent(
                    new CustomEvent('rafraf:select-quote', {
                      detail: { quote },
                    }),
                  )
                }
              >
                اختيار هذا العرض
              </button>
            </article>
          ))}
          {summary.missingMarkets.length ? (
            <p role="status">
              لم يكتمل عرض مؤهل بعد في:{' '}
              {summary.missingMarkets
                .map((market) => marketLabels[market])
                .join('، ')}
              .
            </p>
          ) : null}
        </div>
      ) : toolName === 'getQuotes' && result ? (
        <div role="status">
          {summary.part ? <PartCard part={summary.part} /> : null}
          <span>
            {summary.pending
              ? 'لم تصل عروض مؤهلة بعد. ستظهر هنا عند جاهزيتها.'
              : 'لا توجد عروض متاحة لهذا الطلب حالياً.'}
          </span>
          {summary.rfqCode ? (
            <strong dir="ltr">{summary.rfqCode}</strong>
          ) : null}
        </div>
      ) : toolName === 'getRequestStatus' && summary.workflow ? (
        <div role="status">
          <strong>{summary.workflow.label}</strong>
          <p>{summary.workflow.nextStep}</p>
          {summary.rfqCode ? <small dir="ltr">{summary.rfqCode}</small> : null}
          {summary.orderCode ? (
            <small dir="ltr">{summary.orderCode}</small>
          ) : null}
        </div>
      ) : toolName === 'createRfq' && summary.rfqCode ? (
        <div role="status">
          <span>
            {summary.created === false
              ? 'طلب التسعير موجود مسبقاً وتمت استعادته.'
              : 'تم إنشاء طلب التسعير بنجاح.'}
          </span>
          <strong dir="ltr">{summary.rfqCode}</strong>
        </div>
      ) : toolName === 'approveQuote' && summary.orderCode ? (
        <div role="status">
          <span>
            {summary.created === false
              ? 'الطلب موجود مسبقاً وتمت استعادته.'
              : 'تم اعتماد العرض وإنشاء الطلب بنجاح.'}
          </span>
          <strong dir="ltr">{summary.orderCode}</strong>
          {summary.rfqCode ? (
            <small dir="ltr">RFQ: {summary.rfqCode}</small>
          ) : null}
          {summary.totalAmount && summary.currency ? (
            <span>
              {summary.totalAmount}{' '}
              {summary.currency === 'SAR' ? 'ر.س' : summary.currency}
            </span>
          ) : null}
          {summary.payment ? <ReserveOrPay payment={summary.payment} /> : null}
        </div>
      ) : result ? (
        <span role="status">تم التحقق وحفظ النتيجة.</span>
      ) : status.type === 'running' ? (
        <span>جاري التنفيذ…</span>
      ) : (
        // A call without a result keeps its run's status; once the run has
        // ended (finished, timed out, stopped or failed) no result will come.
        <span role="status">
          توقّف التنفيذ قبل وصول النتيجة. راجع «ملخص طلبك» أو أعد المحاولة.
        </span>
      )}
    </section>
  );
}

function UserText({ text }: TextMessagePartProps) {
  return (
    <p>
      <BidiText text={maskQuoteIdsInCustomerText(text)} />
    </p>
  );
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="rf-message user">
      <MessagePrimitive.Attachments>
        {({ attachment }) => {
          const image = attachment.content.find(
            (part) =>
              part.type === 'image' ||
              (part.type === 'file' && part.mimeType.startsWith('image/')),
          );
          const source =
            image?.type === 'image'
              ? image.image
              : image?.type === 'file' && image.mimeType.startsWith('image/')
                ? image.data
                : null;
          if (!source) return null;
          return (
            <div className="rf-chat-attachment">
              <img
                src={source}
                alt={`الصورة المرفقة: ${attachment.name}`}
                loading="lazy"
              />
              <small>{attachment.name}</small>
            </div>
          );
        }}
      </MessagePrimitive.Attachments>
      <MessagePrimitive.Parts components={{ Text: UserText }} />
    </MessagePrimitive.Root>
  );
}

function ThreadMessage() {
  const role = useAuiState((state) => state.message.role);
  return role === 'user' ? <UserMessage /> : <AssistantMessage />;
}

export function AssistantThreadFeed() {
  const isRunning = useAuiState((state) => state.thread.isRunning);

  return (
    <ThreadPrimitive.Viewport
      className="rf-ai-feed"
      role="log"
      aria-label="سجل محادثة مساعد رفرف"
      aria-live="polite"
      aria-relevant="additions text"
      aria-busy={isRunning}
    >
      <ThreadPrimitive.Empty>
        <article className="rf-chat-empty">
          <strong>صف لي القطعة التي تبحث عنها</strong>
          <span>
            ابدأ باسم القطعة أو السيارة، وسأجمع التفاصيل خطوة بخطوة قبل أي طلب
            تسعير.
          </span>
        </article>
      </ThreadPrimitive.Empty>
      <ThreadPrimitive.Messages>
        {() => <ThreadMessage />}
      </ThreadPrimitive.Messages>
      <AuiIf condition={(state) => state.thread.isRunning}>
        <article
          className="rf-message bot is-typing"
          role="status"
          aria-label="جاري التحليل"
          aria-atomic="true"
        >
          جاري التحقق والبحث…
        </article>
      </AuiIf>
      <ThreadPrimitive.ScrollToBottom asChild>
        <button
          type="button"
          className="rf-assistant-scroll"
          aria-label="الانتقال إلى أحدث رسالة"
        >
          <ChevronDown size={18} aria-hidden />
        </button>
      </ThreadPrimitive.ScrollToBottom>
    </ThreadPrimitive.Viewport>
  );
}

export interface AssistantComposerProps {
  onAttach: () => void;
  attachDisabled?: boolean;
  autoFocus?: boolean;
  speechSupported?: boolean;
  listening?: boolean;
  onToggleSpeech?: () => void;
  voiceControl?: ReactNode;
  showCodeReview?: boolean;
  placeholder: string;
}

export function AssistantComposer({
  onAttach,
  attachDisabled = false,
  autoFocus = true,
  speechSupported = false,
  listening = false,
  onToggleSpeech,
  voiceControl,
  showCodeReview = false,
  placeholder,
}: AssistantComposerProps) {
  return (
    <ComposerPrimitive.Root asChild>
      <form className="rf-ai-composer">
        <ComposerPrimitive.Input
          className="rf-assistant-composer-input"
          placeholder={placeholder}
          aria-label="رسالتك إلى مساعد رفرف"
          submitMode="enter"
          rows={1}
          autoFocus={autoFocus}
        />
        <div className="rf-chat-composer-actions">
          <button
            type="button"
            title="إرفاق صورة القطعة"
            aria-label="إرفاق صورة القطعة"
            onClick={onAttach}
            disabled={attachDisabled}
          >
            <Camera size={20} aria-hidden />
          </button>
          {voiceControl ??
            (speechSupported && onToggleSpeech ? (
              <button
                type="button"
                className={listening ? 'is-listening' : ''}
                title="إدخال صوتي"
                aria-label="إدخال صوتي"
                aria-pressed={listening}
                onClick={onToggleSpeech}
                disabled={attachDisabled}
              >
                <Mic size={20} aria-hidden />
              </button>
            ) : null)}
          <span className="rf-chat-composer-hint">
            راجع أرقام القطع قبل الإرسال
          </span>
          <AuiIf condition={(state) => !state.thread.isRunning}>
            <ComposerPrimitive.Send asChild>
              <button
                type="button"
                className="rf-ai-send"
                title="إرسال"
                aria-label="إرسال الرسالة"
              >
                <SendHorizontal size={20} aria-hidden />
              </button>
            </ComposerPrimitive.Send>
          </AuiIf>
          <AuiIf condition={(state) => state.thread.isRunning}>
            <ComposerPrimitive.Cancel asChild>
              <button
                type="button"
                className="rf-ai-send"
                title="إيقاف الرد"
                aria-label="إيقاف الرد"
              >
                <Square size={15} aria-hidden />
              </button>
            </ComposerPrimitive.Cancel>
          </AuiIf>
        </div>
        {showCodeReview && <ComposerCodeReview />}
      </form>
    </ComposerPrimitive.Root>
  );
}
