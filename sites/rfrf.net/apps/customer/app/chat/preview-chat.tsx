'use client';

import { AssistantRuntimeProvider } from '@assistant-ui/react';
import {
  AssistantComposer,
  AssistantThreadFeed,
  AssistantThreadRoot,
} from '@rafraf/ui/assistant-thread';
import { TurnstileWidget } from '@rafraf/ui/turnstile-widget';
import {
  Bell,
  CarFront,
  CircleCheckBig,
  Pencil,
  Plus,
  Search,
  UserRound,
} from 'lucide-react';
import { DecisionCard } from './decision-card';
import { OfferComparison } from './offer-comparison';
import { PreviewChatSidebar } from './preview-chat-sidebar';
import { usePreviewChat } from './use-preview-chat';
import { useState } from 'react';
import { PhotoCaptureDialog } from './photo-capture-dialog';

export function PreviewChat({
  turnstileSiteKey,
}: {
  turnstileSiteKey: string;
}) {
  const {
    acceptedQuoteId,
    busy,
    comparisonVisible,
    completion,
    draft,
    editDraft,
    engineLabel,
    evidenceActive,
    handleApprovalSuccess,
    images,
    insight,
    latestComparison,
    listening,
    orderCode,
    pickImage,
    previewMode,
    readyToSubmit,
    reset,
    reviewRows,
    rfqCode,
    runtime,
    saveVehicle,
    setTurnstileToken,
    setVehicleEditorOpen,
    showAllSources,
    showQuotes,
    speechSupported,
    submitRequest,
    toggleMicrophone,
    turnstileAttempt,
    turnstileToken,
    vehicle,
    vehicleEditorError,
    vehicleEditorOpen,
  } = usePreviewChat();
  const [photoDialogOpen, setPhotoDialogOpen] = useState(false);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className="rf-ai-shell rf-marketplace-shell">
        <PreviewChatSidebar onReset={reset} />

        <AssistantThreadRoot>
          <header className="rf-ai-header">
            <div className="rf-ai-agent-title">
              <h1>مساعد رفرف الذكي</h1>
              <span>
                <i /> {engineLabel}
              </span>
            </div>

            <button
              type="button"
              className="rf-vehicle-chip"
              onClick={() => setVehicleEditorOpen((current) => !current)}
              aria-expanded={vehicleEditorOpen}
            >
              <CarFront size={25} aria-hidden />
              <span>
                <strong>{vehicle || 'أضف بيانات مركبتك'}</strong>
                <small dir={draft.vin ? 'ltr' : 'rtl'}>
                  {draft.vin
                    ? `VIN: ${draft.vin}`
                    : 'VIN اختياري — اضغط للتعديل'}
                </small>
              </span>
            </button>

            <div className="rf-ai-header-actions rf-ai-customer-head">
              <Bell size={19} aria-hidden />
              <span className="rf-customer-avatar">
                <UserRound size={17} aria-hidden />
              </span>
              <div>
                <strong>
                  {draft.fullName
                    ? `مرحباً ${draft.fullName.split(/\s+/)[0]}`
                    : 'مرحباً بك'}
                </strong>
                <small>حساب العميل</small>
              </div>
              <button type="button" onClick={reset}>
                <Plus size={17} aria-hidden /> طلب جديد
              </button>
            </div>
          </header>

          {vehicleEditorOpen ? (
            <form className="rf-vehicle-editor" onSubmit={saveVehicle}>
              <label>
                الماركة
                <input name="make" defaultValue={draft.make ?? ''} required />
              </label>
              <label>
                الموديل
                <input name="model" defaultValue={draft.model ?? ''} required />
              </label>
              <label>
                السنة
                <input
                  name="year"
                  inputMode="numeric"
                  pattern="(?:19[8-9][0-9]|20[0-2][0-9])"
                  defaultValue={draft.year ?? ''}
                  required
                />
              </label>
              <label>
                VIN اختياري
                <input
                  name="vin"
                  dir="ltr"
                  autoCapitalize="characters"
                  defaultValue={draft.vin ?? ''}
                  placeholder="17 خانة"
                />
              </label>
              {vehicleEditorError ? (
                <p role="alert">{vehicleEditorError}</p>
              ) : null}
              <div>
                <button
                  type="button"
                  onClick={() => setVehicleEditorOpen(false)}
                >
                  إلغاء
                </button>
                <button type="submit">حفظ وإعادة التحقق</button>
              </div>
            </form>
          ) : null}

          <main className="rf-ai-main">
            <section
              className="rf-ai-intake rf-decision-layout"
              aria-label="محادثة مساعد رفرف وقرار المطابقة"
            >
              <div className="rf-ai-conversation">
                <div className="rf-ai-conversation-title">
                  <span className="rf-agent-mark">ر</span>
                  <div>
                    <strong>مساعد رفرف الذكي</strong>
                    <span>اليوم، 10:24 ص</span>
                  </div>
                </div>

                <AssistantThreadFeed />
              </div>

              <DecisionCard
                partText={draft.partText}
                make={draft.make}
                model={draft.model}
                year={draft.year}
                vin={draft.vin}
                oemNumber={draft.oemNumber}
                confidence={insight?.confidence}
                images={images}
                active={evidenceActive}
                previewMode={previewMode}
                suppliersChecked={comparisonVisible}
              />
            </section>

            {completion > 0 && !previewMode ? (
              <section className="rf-ai-review" aria-label="ملخص فهم الطلب">
                <div className="rf-ai-review-head">
                  <div>
                    <span>فهم الطلب</span>
                    <strong>{completion}% مكتمل</strong>
                  </div>
                  {insight ? (
                    <small>
                      ثقة الفهم {Math.round(insight.confidence * 100)}%
                    </small>
                  ) : null}
                </div>
                <div className="rf-ai-review-grid">
                  {reviewRows.map((row) => (
                    <div key={row.label}>
                      <span>{row.label}</span>
                      <strong>{row.value || 'مطلوب'}</strong>
                      {row.value ? (
                        <button
                          type="button"
                          title={`تعديل ${row.label}`}
                          aria-label={`تعديل ${row.label}`}
                          onClick={() => editDraft(row.fields)}
                        >
                          <Pencil size={14} aria-hidden />
                        </button>
                      ) : null}
                    </div>
                  ))}
                </div>
                {insight?.handoffRequired ? (
                  <p>
                    هذا الطلب يحتاج مراجعة فنية قبل عرض الأسعار حفاظًا على دقة
                    التوافق.
                  </p>
                ) : null}
              </section>
            ) : null}

            {readyToSubmit ? (
              <div className="rf-submit-proof">
                <TurnstileWidget
                  key={turnstileAttempt}
                  siteKey={turnstileSiteKey}
                  action="public_intake"
                  onTokenChange={setTurnstileToken}
                />
                <button
                  type="button"
                  className="rf-submit-request"
                  onClick={() => void submitRequest()}
                  disabled={busy || !turnstileToken}
                >
                  <CircleCheckBig size={18} aria-hidden /> اعتماد البيانات وبدء
                  البحث
                </button>
              </div>
            ) : null}

            {rfqCode && !previewMode && !latestComparison?.quotes?.length ? (
              <button
                type="button"
                className="rf-submit-request"
                onClick={() => void showQuotes()}
                disabled={busy}
              >
                <Search size={18} aria-hidden /> استعراض العروض المحلية
                والعالمية
              </button>
            ) : null}

            <OfferComparison
              offers={latestComparison?.quotes}
              visible={comparisonVisible}
              mode={previewMode ? 'preview' : 'live'}
              rfqCode={rfqCode}
              phone={draft.phone}
              orderCode={orderCode}
              acceptedQuoteId={acceptedQuoteId}
              onApprovalSuccess={handleApprovalSuccess}
              onShowQuotes={showAllSources}
              busy={busy}
            />
          </main>

          <PhotoCaptureDialog
            open={photoDialogOpen}
            onClose={() => setPhotoDialogOpen(false)}
            onSelected={(photo) => void pickImage(photo)}
          />
          <AssistantComposer
            onAttach={() => setPhotoDialogOpen(true)}
            attachDisabled={busy}
            speechSupported={speechSupported}
            listening={listening}
            onToggleSpeech={toggleMicrophone}
            placeholder={
              listening
                ? 'أسمعك… تكلّم الآن'
                : 'ابحث بالنص أو الصورة أو رقم الهيكل'
            }
          />
        </AssistantThreadRoot>
      </div>
    </AssistantRuntimeProvider>
  );
}
