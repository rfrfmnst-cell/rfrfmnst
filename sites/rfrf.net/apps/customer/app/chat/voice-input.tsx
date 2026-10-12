'use client';

import { Mic, Square, X } from 'lucide-react';
import { useEffect, useId, useRef, useState } from 'react';
import { useVoiceInput } from './use-voice-input';
import { VOICE_MAX_TEXT } from './voice-input-session';
import { InputCodeReview } from '@rafraf/ui/input-code-review';
import './voice-input.css';

export interface VoiceInputProps {
  disabled?: boolean;
  onConfirm: (text: string) => void;
}

export function VoiceInput({ disabled = false, onConfirm }: VoiceInputProps) {
  const voice = useVoiceInput();
  const [open, setOpen] = useState(false);
  const [confirmationError, setConfirmationError] = useState('');
  const dialog = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const hintId = useId();
  const textareaId = useId();
  const busy = ['requesting', 'recording', 'stopping'].includes(voice.phase);
  const resetRef = useRef(voice.reset);
  resetRef.current = voice.reset;

  function close() {
    setConfirmationError('');
    resetRef.current();
    setOpen(false);
    dialog.current?.close();
    trigger.current?.focus();
  }

  useEffect(() => {
    if (open && !disabled && !dialog.current?.open) dialog.current?.showModal();
    if (disabled || !open) {
      resetRef.current();
      dialog.current?.close();
      if (disabled) setOpen(false);
    }
  }, [open, disabled]);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        className="voice-input-trigger"
        aria-label="تسجيل صوت وتحويله إلى نص"
        title="تسجيل صوت"
        disabled={disabled}
        onClick={() => {
          setConfirmationError('');
          setOpen(true);
        }}
      >
        <Mic size={20} aria-hidden="true" />
      </button>
      <dialog
        ref={dialog}
        className="voice-input-dialog"
        dir="rtl"
        aria-labelledby={titleId}
        aria-describedby={hintId}
        onCancel={(event) => {
          event.preventDefault();
          close();
        }}
        onClose={() => {
          resetRef.current();
          setOpen(false);
          trigger.current?.focus();
        }}
      >
        <div className="voice-input-header">
          <h2 id={titleId}>التسجيل الصوتي</h2>
          <button
            type="button"
            className="voice-input-close"
            aria-label="إغلاق التسجيل الصوتي"
            onClick={close}
          >
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <p id={hintId}>حوّل صوتك إلى نص، وراجعه قبل الإرسال.</p>
        <p className="voice-input-status" role="status" aria-live="polite">
          {voice.phase === 'requesting'
            ? 'بانتظار إذن الميكروفون…'
            : voice.phase === 'recording'
              ? `جارٍ التسجيل · ${voice.seconds} / 60 ثانية`
              : voice.phase === 'stopping'
                ? 'جارٍ تجهيز المعاينة…'
                : 'حتى دقيقة واحدة · 5MB'}
        </p>
        {voice.notice && (
          <p className="voice-input-notice" role="status">
            {voice.notice}
          </p>
        )}
        {voice.error && (
          <p className="voice-input-error" role="alert">
            {voice.error}
          </p>
        )}
        {confirmationError && (
          <p className="voice-input-error" role="alert">
            {confirmationError}
          </p>
        )}
        <div className="voice-input-actions">
          {voice.phase === 'recording' ? (
            <button type="button" onClick={voice.stop}>
              <Square size={16} aria-hidden="true" /> إيقاف التسجيل
            </button>
          ) : (
            <button
              type="button"
              disabled={busy || disabled}
              onClick={() => {
                setConfirmationError('');
                void voice.start();
              }}
            >
              <Mic size={17} aria-hidden="true" />{' '}
              {voice.audioUrl ? 'تسجيل جديد' : 'بدء التسجيل'}
            </button>
          )}
        </div>
        {voice.audioUrl && (
          <audio
            className="voice-input-audio"
            controls
            src={voice.audioUrl}
            aria-label="معاينة التسجيل الصوتي"
          />
        )}
        <label className="voice-input-transcript" htmlFor={textareaId}>
          نص التسجيل
        </label>
        <textarea
          id={textareaId}
          value={voice.transcript}
          rows={5}
          maxLength={VOICE_MAX_TEXT}
          disabled={busy || disabled}
          onChange={(event) => {
            setConfirmationError('');
            voice.setTranscript(event.target.value);
          }}
          placeholder="راجع الكلمات والأرقام، أو اكتب النص يدوياً إذا لم يتوفر التحويل الصوتي."
        />
        <InputCodeReview text={voice.transcript} />
        <p className="voice-input-hint">
          قد يخطئ التحويل في أرقام القطع؛ راجعها. التسجيل لا يُرفق بالرسالة. قد
          يعالج متصفحك الصوت عبر خدمة تحويل خارجية.
        </p>
        <div className="voice-input-actions voice-input-footer">
          <button type="button" onClick={close}>
            إلغاء
          </button>
          <button
            type="button"
            className="voice-input-confirm"
            disabled={busy || disabled || !voice.transcript.trim()}
            onClick={() => {
              try {
                onConfirm(voice.transcript.trim());
                close();
              } catch (error) {
                setConfirmationError(
                  error instanceof Error
                    ? error.message
                    : 'تعذّر استخدام النص. راجع الرسالة وحاول مجدداً.',
                );
              }
            }}
          >
            استخدام النص
          </button>
        </div>
      </dialog>
    </>
  );
}

export default VoiceInput;
