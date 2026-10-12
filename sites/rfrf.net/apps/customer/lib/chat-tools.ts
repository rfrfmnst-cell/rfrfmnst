import {
  approveOwnedQuote,
  createRfqFromOwnedThread,
  getOwnedQuotes,
  updateOwnedDraft,
  validateOwnedVehicle,
} from './chat-domain';
import { tool, type InferUITools, type ToolSet, type UIMessage } from 'ai';
import { z } from 'zod';
import { getOwnedRequestStatus } from './chat-request-status';
import { confirmOwnedPartNumber } from './chat-draft-service';
import { createWebResearchTools } from './chat-web-research-tools';

const draftSchema = z.object({
  partText: z.string().trim().min(1).max(240).optional(),
  oemNumber: z.string().trim().min(3).max(40).optional(),
  make: z.string().trim().min(1).max(60).optional(),
  model: z.string().trim().min(1).max(80).optional(),
  year: z
    .string()
    .regex(/^(?:19[8-9]\d|20[0-2]\d)$/)
    .optional(),
  vin: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-HJ-NPR-Z0-9]{17}$/)
    .optional(),
  notes: z.string().trim().max(500).optional(),
});

// A run aborted by its deadline never starts new database work in a tool.
export function createChatTools(customerId: string, threadId: string): ToolSet {
  return {
    ...createWebResearchTools(customerId, threadId),
    updateRequestDraft: tool({
      description: 'تحديث حقول مسودة طلب القطعة بما ذكره العميل صراحة فقط.',
      inputSchema: draftSchema,
      execute: async (input, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return updateOwnedDraft(customerId, threadId, input);
      },
    }),
    validateVehicle: tool({
      description:
        'التحقق من صيغة VIN وOEM واكتمال بيانات المركبة دون ادعاء توافق غير موجود.',
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return validateOwnedVehicle(customerId, threadId);
      },
    }),
    confirmPartNumber: tool({
      description:
        'تأكيد رقم القطعة المستنتج من صورة عبر بطاقة موافقة صريحة؛ استخدم proposalId وvalue من partNumberProvenance المحفوظ. لا يؤكد التوافق مع السيارة ولا ينشئ طلب تسعير.',
      inputSchema: z
        .object({
          proposalId: z.string().uuid(),
          partNumber: z.string().min(3).max(40),
        })
        .strict(),
      needsApproval: true,
      execute: async ({ proposalId, partNumber }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return confirmOwnedPartNumber(
          customerId,
          threadId,
          proposalId,
          partNumber,
        );
      },
    }),
    createRfq: tool({
      description:
        'إنشاء طلب تسعير RFQ من المسودة المحفوظة. يتطلب موافقة العميل الصريحة.',
      inputSchema: z.object({ confirmation: z.literal('create-rfq') }),
      needsApproval: true,
      execute: async (_, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return createRfqFromOwnedThread(customerId, threadId);
      },
    }),
    getQuotes: tool({
      description:
        'جلب أفضل عرض حقيقي مؤهل في كل سوق سعودي وخليجي وعالمي، مع missingMarkets للأسواق التي لم يصل منها عرض. يمنع اختلاق عرض أو إعادة تسمية سوق.',
      inputSchema: z.object({}),
      execute: async (_, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return getOwnedQuotes(customerId, threadId);
      },
    }),
    getRequestStatus: tool({
      description:
        'قراءة مرحلة الطلب والخطوة التالية من المحادثة المملوكة للعميل فقط، دون تغيير بيانات أو استدعاء مزود خارجي.',
      inputSchema: z.object({}).strict(),
      execute: async (_, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return getOwnedRequestStatus(customerId, threadId);
      },
    }),
    approveQuote: tool({
      description:
        'اعتماد عرض حقيقي محدد وإنشاء Order بصورة idempotent. يتطلب موافقة العميل الصريحة.',
      inputSchema: z.object({ quoteId: z.string().min(10).max(64) }),
      needsApproval: true,
      execute: async ({ quoteId }, { abortSignal }) => {
        abortSignal?.throwIfAborted();
        return approveOwnedQuote(customerId, threadId, quoteId);
      },
    }),
  };
}

export type ChatUIMessage = UIMessage<
  unknown,
  never,
  InferUITools<ReturnType<typeof createChatTools>>
>;
