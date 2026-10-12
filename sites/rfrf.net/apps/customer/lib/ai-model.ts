import { createAnthropic } from '@ai-sdk/anthropic';
import { createGoogle } from '@ai-sdk/google';
import { createVertex } from '@ai-sdk/google-vertex';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  chatModelId,
  generativeAiApiKey,
  hostedProviderApiKey,
  hostedProviderBaseUrl,
  openAiCompatibleApiKey,
  openAiCompatibleBaseUrl,
  resolveChatProvider,
  vertexConfigured,
  vertexLocation,
  vertexProject,
  type ChatModelProvider,
} from '@rafraf/shared/ai/model-provider';
import {
  defaultSettingsMiddleware,
  wrapLanguageModel,
  type LanguageModel,
  type LanguageModelMiddleware,
} from 'ai';

/**
 * بناء المزوّد الذي قرّرته `resolveChatProvider`. القرار نقي ومختبَر في
 * packages/shared؛ هذه الطبقة تتولى التوصيل بالحزم فقط.
 */
export interface ChatModelSelection {
  provider: ChatModelProvider;
  modelId: string;
  builtProvider: string;
  builtModelId: string;
  model: LanguageModel;
}

function vertexModel(modelId: string) {
  // نفس شرط طبقة القرار، حتى لا تختلف الطبقتان في تعريف «مُهيّأ».
  if (!vertexConfigured(process.env)) return null;
  const project = vertexProject(process.env);
  if (!project) return null;

  const inline = process.env.GOOGLE_CLOUD_CREDENTIALS?.trim() || undefined;
  let credentials: Record<string, unknown> | undefined;
  if (inline) {
    try {
      credentials = JSON.parse(inline) as Record<string, unknown>;
    } catch {
      console.error('[chat] GOOGLE_CLOUD_CREDENTIALS is invalid JSON');
      return null;
    }
  }

  const provider = createVertex({
    project,
    location: vertexLocation(process.env),
    ...(credentials ? { googleAuthOptions: { credentials } } : {}),
  });
  return provider(modelId);
}

function generativeAiModel(modelId: string) {
  const apiKey = generativeAiApiKey(process.env);
  if (!apiKey) return null;
  return createGoogle({ apiKey })(modelId);
}

function openAiCompatibleModel(modelId: string) {
  const baseURL = openAiCompatibleBaseUrl(process.env);
  if (!baseURL) return null;
  return createOpenAICompatible({
    name: 'rafraf-openai-compatible',
    baseURL,
    apiKey: openAiCompatibleApiKey(process.env),
    includeUsage: true,
  })(modelId);
}

/** موجّه Hugging Face يتكلم بروتوكول Chat Completions المتوافق مع OpenAI. */
function huggingFaceModel(modelId: string) {
  const apiKey = hostedProviderApiKey(process.env, 'huggingface');
  if (!apiKey) return null;
  return createOpenAICompatible({
    name: 'rafraf-huggingface',
    baseURL: hostedProviderBaseUrl('huggingface'),
    apiKey,
    includeUsage: true,
  })(modelId);
}

/** نماذج Anthropic التي تقبل خيار الجهد (`effort`) ويعمل فيها التفكير دائماً. */
const ANTHROPIC_EFFORT_MODEL = /^claude-(?:opus|sonnet|fable|mythos)-5(?:-|$)/;

/**
 * التفكير في هذه النماذج يُحتسب من سقف المخرجات، وسقف الدردشة (1024) مصمَّم
 * لنماذج بلا تفكير فقد يقطع الرد أو استدعاء الأداة قبل اكتماله. أرضية أعلى
 * لهذه النماذج وحدها؛ طول الرد المرئي يحكمه موجّه النظام، والجهد المنخفض
 * يُبقي التفكير قصيراً.
 */
export const ANTHROPIC_THINKING_OUTPUT_FLOOR = 8192;

const thinkingOutputFloor: LanguageModelMiddleware = {
  specificationVersion: 'v4',
  transformParams: async ({ params }) => ({
    ...params,
    maxOutputTokens: Math.max(
      params.maxOutputTokens ?? 0,
      ANTHROPIC_THINKING_OUTPUT_FLOOR,
    ),
  }),
};

/**
 * Anthropic عبر حزمته الأصلية. الحزمة تُسقط `temperature` عن النماذج التي
 * ترفضه. لا رجوع خادمي إلى نموذج آخر: كل رد يُنسب للنموذج المطلوب نفسه في
 * الأدلة و`AIDecision`، كما تشترط قاعدة «لا رجوع صامت».
 */
function anthropicModel(modelId: string) {
  const apiKey = hostedProviderApiKey(process.env, 'anthropic');
  if (!apiKey) return null;
  // baseURL صريح حتى لا يحوّل متغير ANTHROPIC_BASE_URL المفتاح إلى مضيف آخر.
  const model = createAnthropic({
    apiKey,
    baseURL: hostedProviderBaseUrl('anthropic'),
  })(modelId);
  if (!ANTHROPIC_EFFORT_MODEL.test(modelId)) return model;
  return wrapLanguageModel({
    model,
    middleware: [
      defaultSettingsMiddleware({
        settings: {
          providerOptions: {
            anthropic: { effort: 'low' },
          },
        },
      }),
      thinkingOutputFloor,
    ],
  });
}

function buildModel(provider: ChatModelProvider, modelId: string) {
  switch (provider) {
    case 'vertex':
      return vertexModel(modelId);
    case 'google-generative-ai':
      return generativeAiModel(modelId);
    case 'openai-compatible':
      return openAiCompatibleModel(modelId);
    case 'huggingface':
      return huggingFaceModel(modelId);
    case 'anthropic':
      return anthropicModel(modelId);
  }
}

export function selectChatModel(): ChatModelSelection | null {
  const provider = resolveChatProvider(process.env);
  if (!provider) return null;
  const modelId = chatModelId(process.env, provider);
  const model = buildModel(provider, modelId);
  return model
    ? {
        provider,
        modelId,
        builtProvider: model.provider,
        builtModelId: model.modelId,
        model,
      }
    : null;
}

/** جاهزية الذكاء الاصطناعي = وجود مزوّد مقرَّر فعلاً، لا مجرد متغيرات بيئة. */
export function chatModelConfigured(): boolean {
  return resolveChatProvider(process.env) !== null;
}
