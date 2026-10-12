import type { ThreadMessageLike } from '@assistant-ui/react';
import type { QuotesComparison } from '../actions';
import { extractVin } from '../../lib/vin';

export type Sender = 'bot' | 'user';
export type EngineMode = 'ready' | 'ai' | 'rules';

export interface Message {
  id: number;
  from: Sender;
  text: string;
  image?: string;
  quotes?: QuotesComparison;
}

export interface Draft {
  partText?: string;
  oemNumber?: string;
  vin?: string;
  make?: string;
  model?: string;
  year?: string;
  phone?: string;
  fullName?: string;
}

export interface AiInsight {
  confidence: number;
  missingFields: string[];
  handoffRequired: boolean;
  evidenceCount: number;
}

export const INITIAL_MESSAGE: Message = {
  id: 1,
  from: 'bot',
  text: 'هلا، أنا مساعد رفرف. ابحث معك بالنص أو الصورة أو رقم الهيكل، ثم أقارن أفضل الخيارات المحلية والعالمية بالسعر النهائي الواصل.',
};

export const PREVIEW_MESSAGES: Message[] = [
  {
    id: 9101,
    from: 'user',
    text: 'أبحث عن الدينمو المناسب لسيارتي تويوتا كامري 2021',
    image: '/rafraf-alternator-product.webp',
  },
  {
    id: 9102,
    from: 'bot',
    text: 'تم فهم طلبك والتحقق من الصورة ورقم الهيكل. قارنت الآن بين الموردين المحليين والعالميين، مع التكلفة النهائية ومدة الوصول والضمان.',
  },
];

const MAKES = [
  'تويوتا',
  'هيونداي',
  'نيسان',
  'كيا',
  'فورد',
  'شفروليه',
  'هوندا',
  'مازدا',
  'لكزس',
  'مرسيدس',
  'بي ام دبليو',
  'شانجان',
  'جيلي',
];

export const SAUDI_PHONE = /(?:\+9665|05|9665)\d{8}/;
let idSequence = 10;

export function nextPreviewMessageId(): number {
  return idSequence++;
}

function extractOemNumber(text: string): string | undefined {
  return text
    .match(/\b[A-Z0-9]{2,}[-\s][A-Z0-9][A-Z0-9-\s]{2,}\b/gi)
    ?.map((value) => value.replace(/\s+/g, '').toUpperCase())
    .find((value) => value.length >= 6 && value.length <= 24);
}

export function extractVehicle(text: string): Partial<Draft> {
  const result: Partial<Draft> = {};
  const year = text.match(/(?:19[8-9]\d|20[0-2]\d)/)?.[0];
  if (year) result.year = year;

  for (const make of MAKES) {
    const index = text.indexOf(make);
    if (index === -1) continue;
    result.make = make;
    const model = text
      .slice(index + make.length)
      .trim()
      .split(/[\s،,.-]+/)
      .find((part) => part && !/^\d/.test(part));
    if (model) result.model = model;
    break;
  }

  const oemNumber = extractOemNumber(text);
  if (oemNumber) result.oemNumber = oemNumber;
  const vin = extractVin(text);
  if (vin) result.vin = vin;
  return result;
}

export function completionFor(draft: Draft): number {
  const required = [
    draft.partText,
    draft.make,
    draft.model,
    draft.year,
    draft.phone,
    draft.fullName,
  ];
  return Math.round((required.filter(Boolean).length / required.length) * 100);
}

export function nextPrompt(draft: Draft): string {
  if (!draft.partText)
    return 'وش القطعة التي تحتاجها؟ اكتب اسمها أو أرفق صورة واضحة.';
  if (!draft.make || !draft.model || !draft.year)
    return 'أحتاج الماركة والموديل وسنة الصنع، مثال: تويوتا كامري 2021.';
  if (!draft.phone)
    return draft.vin
      ? 'تم حفظ رقم الهيكل. اكتب رقم الجوال بصيغة 05xxxxxxxx لإرسال العروض.'
      : 'إذا توفر رقم الهيكل VIN أرسله لرفع دقة المطابقة، أو اكتب رقم الجوال بصيغة 05xxxxxxxx للمتابعة.';
  if (!draft.fullName) return 'بقي الاسم الذي تريد تسجيل الطلب به.';
  return 'اكتملت البيانات. راجع التحقق ثم اعتمد إرسال الطلب لبدء البحث المحلي والعالمي.';
}

export function toAssistantMessage(message: Message): ThreadMessageLike {
  const content: Array<
    { type: 'image'; image: string } | { type: 'text'; text: string }
  > = [];
  if (message.image) {
    content.push({ type: 'image', image: message.image });
  }
  content.push({ type: 'text', text: message.text });

  return {
    id: String(message.id),
    role: message.from === 'bot' ? 'assistant' : 'user',
    content,
  };
}

export interface PreviewReviewRow {
  label: string;
  value: string | undefined;
  fields: (keyof Draft)[];
}

export function reviewFor(draft: Draft): {
  vehicle: string;
  reviewRows: PreviewReviewRow[];
} {
  const vehicle = [draft.make, draft.model, draft.year]
    .filter(Boolean)
    .join(' ');
  const reviewRows: PreviewReviewRow[] = [
    {
      label: 'القطعة',
      value: draft.partText,
      fields: ['partText'],
    },
    {
      label: 'السيارة',
      value: vehicle,
      fields: ['make', 'model', 'year'],
    },
    {
      label: 'الجوال',
      value: draft.phone,
      fields: ['phone'],
    },
    {
      label: 'VIN اختياري',
      value: draft.vin,
      fields: ['vin'],
    },
    {
      label: 'الاسم',
      value: draft.fullName,
      fields: ['fullName'],
    },
  ];

  return { vehicle, reviewRows };
}
