'use client';

import { type FormEvent, useEffect, useRef, useState } from 'react';
import {
  type AppendMessage,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { getQuotesComparison, submitRfq } from '../actions';
import { extractVin, normalizeVin } from '../../lib/vin';
import { customerImageDataUrl } from '../../lib/client-image';
import { customerPhotoText, type CustomerPhoto } from './photo-capture-dialog';
import {
  completionFor,
  type Draft,
  type EngineMode,
  type AiInsight,
  INITIAL_MESSAGE,
  type Message,
  nextPreviewMessageId,
  nextPrompt,
  PREVIEW_MESSAGES,
  reviewFor,
  SAUDI_PHONE,
  type Sender,
  extractVehicle,
  toAssistantMessage,
} from './preview-chat-model';
import type { SpeechRecognitionLike } from './preview-chat-speech';

export function usePreviewChat() {
  const [messages, setMessages] = useState<Message[]>([INITIAL_MESSAGE]);
  const [draft, setDraft] = useState<Draft>({});
  const [insight, setInsight] = useState<AiInsight | null>(null);
  const [engineMode, setEngineMode] = useState<EngineMode>('ready');
  const [images, setImages] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [turnstileAttempt, setTurnstileAttempt] = useState(0);
  const [listening, setListening] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
  const [rfqCode, setRfqCode] = useState<string | null>(null);
  const [previewMode, setPreviewMode] = useState(false);
  const [orderCode, setOrderCode] = useState<string | null>(null);
  const [acceptedQuoteId, setAcceptedQuoteId] = useState<string | null>(null);
  const [vehicleEditorOpen, setVehicleEditorOpen] = useState(false);
  const [vehicleEditorError, setVehicleEditorError] = useState<string | null>(
    null,
  );
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const aiAvailableRef = useRef(true);

  const completion = completionFor(draft);
  const readyToSubmit = completion === 100 && !rfqCode;
  const latestComparison = [...messages]
    .reverse()
    .find((message) => message.quotes?.quotes?.length)?.quotes;
  const evidenceActive = previewMode || completion >= 50;
  const comparisonVisible =
    previewMode || Boolean(latestComparison?.quotes?.length);
  const engineLabel =
    engineMode === 'ai'
      ? 'فهم ذكي نشط'
      : engineMode === 'rules'
        ? 'مطابقة محلية آمنة'
        : 'متصل بشبكة الموردين';

  useEffect(() => {
    const browserWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    setSpeechSupported(
      Boolean(
        browserWindow.SpeechRecognition ??
        browserWindow.webkitSpeechRecognition,
      ),
    );

    const params = new URLSearchParams(window.location.search);
    if (params.get('preview') === '1') {
      setPreviewMode(true);
      setMessages(PREVIEW_MESSAGES);
      setDraft({
        partText: 'دينمو كهرباء 12V',
        oemNumber: '27060-0TO30',
        vin: 'JTNB11HK5M3087962',
        make: 'تويوتا',
        model: 'كامري',
        year: '2021',
        phone: 'preview-only',
        fullName: 'خالد العنزي',
      });
      setInsight({
        confidence: 0.99,
        missingFields: [],
        handoffRequired: false,
        evidenceCount: 3,
      });
      setEngineMode('ai');
      setRfqCode('RFQ-263782');
      setOrderCode(null);
      setAcceptedQuoteId(null);
    }
  }, []);

  function pushMessage(from: Sender, text: string, image?: string) {
    setMessages((current) => [
      ...current,
      { id: nextPreviewMessageId(), from, text, image },
    ]);
  }

  function applyFallback(text: string) {
    const next = { ...draft };
    const vehicle = extractVehicle(text);
    Object.assign(next, vehicle);

    if (!next.partText && !extractVin(text)) next.partText = text;
    else if (!next.phone) {
      const phone = text.replace(/[\s-]/g, '').match(SAUDI_PHONE)?.[0];
      if (phone) next.phone = phone;
    } else if (!next.fullName) next.fullName = text;

    setDraft(next);
    setInsight(null);
    setEngineMode('rules');
    pushMessage('bot', nextPrompt(next));
  }

  async function handleUser(rawText: string) {
    const text = rawText.trim();
    if (!text || busy) return;
    const nextMessages = [
      ...messages,
      { id: nextPreviewMessageId(), from: 'user' as const, text },
    ];
    setMessages(nextMessages);
    setBusy(true);

    if (aiAvailableRef.current) {
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            attemptId: crypto.randomUUID(),
            messages: nextMessages.map((message) => ({
              from: message.from,
              text: message.text,
            })),
            draft,
          }),
        });
        const result = (await response.json()) as {
          ai: boolean;
          reply?: string;
          draft?: Draft;
          error?: string;
          confidence?: number;
          missingFields?: string[];
          handoffRequired?: boolean;
          evidence?: unknown[];
        };

        if (result.ai) {
          const nextDraft = { ...draft, ...result.draft };
          setDraft(nextDraft);
          setInsight({
            confidence: result.confidence ?? 0.5,
            missingFields: result.missingFields ?? [],
            handoffRequired: Boolean(result.handoffRequired),
            evidenceCount: result.evidence?.length ?? 0,
          });
          setEngineMode('ai');
          pushMessage(
            'bot',
            result.error ?? result.reply ?? nextPrompt(nextDraft),
          );
          return;
        }
        aiAvailableRef.current = false;
      } catch {
        aiAvailableRef.current = false;
      } finally {
        setBusy(false);
      }
    } else {
      setBusy(false);
    }

    applyFallback(text);
  }

  async function pickImage(photo: CustomerPhoto) {
    if (busy) return;
    if (images.length >= 2) {
      pushMessage('bot', 'وصلتنا صورتان، وهذا يكفي للمطابقة الأولية.');
      return;
    }

    setBusy(true);
    try {
      const dataUrl = await customerImageDataUrl(photo.file);
      setImages((current) => [...current, dataUrl]);
      setMessages((current) => [
        ...current,
        {
          id: nextPreviewMessageId(),
          from: 'user',
          text: customerPhotoText(photo),
          image: dataUrl,
        },
      ]);
      const next = {
        ...draft,
        partText:
          draft.partText ??
          (photo.imageKind === 'PART_PHOTO' ? 'قطعة من صورة مرفقة' : undefined),
      };
      setDraft(next);
      pushMessage(
        'bot',
        draft.partText
          ? 'وصلت الصورة وأضفتها إلى أدلة المطابقة.'
          : 'وصلت الصورة. اكتب الآن الماركة والموديل وسنة الصنع.',
      );
    } catch {
      pushMessage('bot', 'تعذّر قراءة الصورة. جرّب ملف JPG أو PNG أوضح.');
    } finally {
      setBusy(false);
    }
  }

  function toggleMicrophone() {
    if (listening) {
      recognitionRef.current?.stop();
      return;
    }

    const browserWindow = window as unknown as {
      SpeechRecognition?: new () => SpeechRecognitionLike;
      webkitSpeechRecognition?: new () => SpeechRecognitionLike;
    };
    const Recognition =
      browserWindow.SpeechRecognition ?? browserWindow.webkitSpeechRecognition;
    if (!Recognition) return;

    const recognition = new Recognition();
    recognition.lang = 'ar-SA';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const text = event.results?.[0]?.[0]?.transcript ?? '';
      if (text) void handleUser(text);
    };
    recognition.onend = () => setListening(false);
    recognition.onerror = () => {
      setListening(false);
      pushMessage(
        'bot',
        'لم يصلني الصوت بوضوح. تحقق من إذن الميكروفون وحاول مجددًا.',
      );
    };
    recognitionRef.current = recognition;
    setListening(true);
    recognition.start();
  }

  async function submitRequest() {
    if (!readyToSubmit || busy || !turnstileToken) return;
    let completed = false;
    setBusy(true);
    try {
      const formData = new FormData();
      formData.set('fullName', draft.fullName ?? '');
      formData.set('phone', draft.phone ?? '');
      formData.set('make', draft.make ?? '');
      formData.set('model', draft.model ?? '');
      formData.set('year', draft.year ?? '');
      formData.set('partText', draft.partText ?? '');
      formData.set('oemNumber', draft.oemNumber ?? '');
      formData.set('vin', draft.vin ?? '');
      formData.set('notes', 'عبر مساعد رفرف — بحث محلي وعالمي');
      formData.set('turnstileToken', turnstileToken);
      if (images.length) formData.set('images', JSON.stringify(images));

      const result = await submitRfq({}, formData);
      if (result.ok && result.code) {
        completed = true;
        setRfqCode(result.code);
        pushMessage(
          'bot',
          `تم إنشاء الطلب ${result.code}. بدأنا الآن فحص الموردين المحليين والعالميين.`,
        );
      } else {
        pushMessage('bot', result.error ?? 'تعذّر إنشاء الطلب. حاول مرة أخرى.');
      }
    } catch {
      pushMessage('bot', 'تعذّر إرسال الطلب. تحقق من الاتصال وحاول مرة أخرى.');
    } finally {
      if (!completed) {
        setTurnstileToken('');
        setTurnstileAttempt((current) => current + 1);
      }
      setBusy(false);
    }
  }

  async function showQuotes() {
    if (!rfqCode || busy || previewMode) return;
    setBusy(true);
    try {
      const result = await getQuotesComparison(rfqCode);
      if (result.error) pushMessage('bot', result.error);
      else if (result.pending)
        pushMessage(
          'bot',
          'البحث ما زال جاريًا. سنظهر المقارنة فور اعتماد العروض.',
        );
      else
        setMessages((current) => [
          ...current,
          {
            id: nextPreviewMessageId(),
            from: 'bot',
            text: result.explanationAr ?? 'اكتملت المقارنة المحلية والعالمية.',
            quotes: result,
          },
        ]);
    } catch {
      pushMessage('bot', 'تعذّر جلب العروض الآن. حاول بعد قليل.');
    } finally {
      setBusy(false);
    }
  }

  function showAllSources() {
    if (previewMode) {
      pushMessage(
        'bot',
        'تم فحص 12 موردًا محليًا و34 موردًا عالميًا. رتّبنا أفضل العروض حسب التوافق والموثوقية والتكلفة النهائية.',
      );
      return;
    }
    void showQuotes();
  }

  function handleApprovalSuccess(nextOrderCode: string, quoteId: string) {
    setOrderCode(nextOrderCode);
    setAcceptedQuoteId(quoteId);
    pushMessage(
      'bot',
      previewMode
        ? 'اكتملت معاينة اعتماد العرض. لم يُنشأ أي طلب حقيقي.'
        : `تم إنشاء أمر الشراء ${nextOrderCode}. حالته الآن بانتظار الدفع، ويمكنك تتبعه من هذه الشاشة.`,
    );
  }

  function saveVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const rawVin = String(formData.get('vin') ?? '').trim();
    const vin = normalizeVin(rawVin);
    if (rawVin && !vin) {
      setVehicleEditorError(
        'رقم الهيكل يجب أن يكون 17 خانة ولا يحتوي I أو O أو Q.',
      );
      return;
    }
    setDraft((current) => ({
      ...current,
      make: String(formData.get('make') ?? '').trim() || undefined,
      model: String(formData.get('model') ?? '').trim() || undefined,
      year: String(formData.get('year') ?? '').trim() || undefined,
      vin,
    }));
    setVehicleEditorError(null);
    setVehicleEditorOpen(false);
    setRfqCode(null);
    setOrderCode(null);
    setAcceptedQuoteId(null);
    setInsight(null);
    pushMessage(
      'bot',
      vin
        ? 'تم تحديث المركبة ورقم الهيكل وسأعيد التحقق.'
        : 'تم تحديث المركبة. المطابقة ستبقى أولية دون VIN.',
    );
  }

  function reset() {
    aiAvailableRef.current = true;
    setMessages([INITIAL_MESSAGE]);
    setDraft({});
    setInsight(null);
    setEngineMode('ready');
    setImages([]);
    setTurnstileToken('');
    setTurnstileAttempt((current) => current + 1);
    setRfqCode(null);
    setPreviewMode(false);
    setOrderCode(null);
    setAcceptedQuoteId(null);
    setVehicleEditorOpen(false);
    setVehicleEditorError(null);
    window.setTimeout(
      () =>
        document
          .querySelector<HTMLTextAreaElement>('.rf-assistant-composer-input')
          ?.focus(),
      0,
    );
  }

  function editDraft(fields: (keyof Draft)[]) {
    setDraft((current) => {
      const next = { ...current };
      for (const field of fields) delete next[field];
      return next;
    });
    setInsight(null);
    setEngineMode('ready');
    setRfqCode(null);
    setOrderCode(null);
    setAcceptedQuoteId(null);
    aiAvailableRef.current = true;
    pushMessage('bot', 'عدّل المعلومة المطلوبة وسأعيد التحقق مباشرة.');
    window.setTimeout(
      () =>
        document
          .querySelector<HTMLTextAreaElement>('.rf-assistant-composer-input')
          ?.focus(),
      0,
    );
  }

  const { vehicle, reviewRows } = reviewFor(draft);

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: busy,
    isSendDisabled: busy,
    convertMessage: toAssistantMessage,
    suggestions: draft.partText
      ? []
      : [
          { prompt: 'دينمو لكامري 2021' },
          { prompt: 'فحمات فرامل أمامية لكامري 2021' },
          { prompt: 'فلتر هواء لهايلكس 2022' },
        ],
    onNew: async (message: AppendMessage) => {
      const textPart = message.content.find((part) => part.type === 'text');
      if (!textPart || textPart.type !== 'text') return;
      await handleUser(textPart.text);
    },
  });

  return {
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
  };
}
