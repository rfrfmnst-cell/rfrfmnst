/**
 * قرار مزوّد نموذج المحادثة — منطق نقي بلا أي حزمة مزوّد، حتى يبقى قابلاً
 * للاختبار وحده ويبقى مصدر حقيقة واحداً لمسار الدردشة وفحص الجاهزية معاً.
 *
 * فصل القرار عن البناء مقصود: قابلية بناء المزوّد لا تعني نجاح استدعائه
 * (مشروع Vertex بلا فوترة يبني ثم يفشل عند أول طلب)، فالاختيار الصريح
 * يكشف العطل بدل إخفائه خلف ترتيب ضمني.
 */
export type ChatModelProvider =
  | 'vertex'
  | 'google-generative-ai'
  | 'openai-compatible'
  | 'huggingface'
  | 'anthropic';

/** مزوّدات مستضافة بعنوان ثابت ومفتاح واحد؛ لا تُختار إلا صراحةً. */
export type HostedChatModelProvider = 'huggingface' | 'anthropic';

export const DEFAULT_CHAT_MODEL_ID = 'gemini-2.5-flash';
export const DEFAULT_VERTEX_LOCATION = 'us-central1';

/**
 * عناوين ثابتة في الكود لا في البيئة: المفتاح وحده يُدار سراً، فلا يستطيع
 * إعداد خاطئ توجيه مفتاح Hugging Face أو Anthropic إلى مضيف آخر.
 */
export const HUGGINGFACE_ROUTER_BASE_URL = 'https://router.huggingface.co/v1';
export const ANTHROPIC_API_BASE_URL = 'https://api.anthropic.com/v1';

/**
 * نماذج افتراضية تدعم استدعاء الأدوات والصور والعربية؛ `RAFRAF_AI_MODEL` يتقدّم
 * دائماً. الدردشة ترسل صور القطع، فالنموذج الافتراضي يجب أن يقبل الصور.
 */
export const DEFAULT_HOSTED_CHAT_MODEL_IDS: Readonly<
  Record<HostedChatModelProvider, string>
> = {
  huggingface: 'Qwen/Qwen3-VL-235B-A22B-Instruct',
  anthropic: 'claude-opus-5-5',
};

export interface ChatProviderEnv {
  RAFRAF_AI_PROVIDER?: string;
  RAFRAF_AI_MODEL?: string;
  VERTEX_PROJECT?: string;
  GCLOUD_PROJECT?: string;
  GOOGLE_VERTEX_PROJECT?: string;
  VERTEX_LOCATION?: string;
  GOOGLE_VERTEX_LOCATION?: string;
  GOOGLE_APPLICATION_CREDENTIALS?: string;
  GOOGLE_CLOUD_CREDENTIALS?: string;
  GOOGLE_GENERATIVE_AI_API_KEY?: string;
  GEMINI_API_KEY?: string;
  RAFRAF_OPENAI_COMPATIBLE_BASE_URL?: string;
  RAFRAF_OPENAI_COMPATIBLE_API_KEY?: string;
  HF_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
  NODE_ENV?: string;
  // يقبل `process.env` مباشرة دون تحويل، مع إبقاء المفاتيح أعلاه موثِّقة لنفسها.
  [key: string]: string | undefined;
}

function trimmed(value: string | undefined): string | undefined {
  const clean = value?.trim();
  return clean ? clean : undefined;
}

export class ChatProviderConfigurationError extends Error {
  readonly code = 'UNKNOWN_CHAT_MODEL_PROVIDER';

  constructor(provider: string) {
    super(`Unsupported RAFRAF_AI_PROVIDER: ${provider}`);
    this.name = 'ChatProviderConfigurationError';
  }
}

function isHostedProvider(
  provider: ChatModelProvider | null | undefined,
): provider is HostedChatModelProvider {
  return provider === 'huggingface' || provider === 'anthropic';
}

/**
 * النموذج المطلوب. يُمرَّر المزوّد المقرَّر حتى يأخذ كل مزوّد مستضاف نموذجه
 * الافتراضي؛ بدونه يبقى نموذج الإطلاق السابق للتوافق.
 */
export function chatModelId(
  env: ChatProviderEnv,
  provider?: ChatModelProvider | null,
): string {
  const explicit = trimmed(env.RAFRAF_AI_MODEL);
  if (explicit) return explicit;
  return isHostedProvider(provider)
    ? DEFAULT_HOSTED_CHAT_MODEL_IDS[provider]
    : DEFAULT_CHAT_MODEL_ID;
}

/** مفتاح المزوّد المستضاف فقط؛ لا يقرأ مفاتيح مزوّد آخر أبداً. */
export function hostedProviderApiKey(
  env: ChatProviderEnv,
  provider: HostedChatModelProvider,
): string | undefined {
  if (provider === 'huggingface') return trimmed(env.HF_TOKEN);
  return trimmed(env.ANTHROPIC_API_KEY);
}

export function hostedProviderBaseUrl(
  provider: HostedChatModelProvider,
): string {
  if (provider === 'huggingface') return HUGGINGFACE_ROUTER_BASE_URL;
  return ANTHROPIC_API_BASE_URL;
}

export function hostedProviderConfigured(
  env: ChatProviderEnv,
  provider: HostedChatModelProvider,
): boolean {
  return Boolean(hostedProviderApiKey(env, provider));
}

export function vertexProject(env: ChatProviderEnv): string | undefined {
  return (
    trimmed(env.VERTEX_PROJECT) ??
    trimmed(env.GCLOUD_PROJECT) ??
    trimmed(env.GOOGLE_VERTEX_PROJECT)
  );
}

export function vertexLocation(env: ChatProviderEnv): string {
  return (
    trimmed(env.VERTEX_LOCATION) ??
    trimmed(env.GOOGLE_VERTEX_LOCATION) ??
    DEFAULT_VERTEX_LOCATION
  );
}

/**
 * Vertex يحتاج مشروعاً واعتماداً صريحاً: ملف ADC محلي أو JSON مضمّن.
 *
 * اشتراط الاعتماد مقصود ويختلف عن سلوك google-auth-library الافتراضي، الذي
 * يستطيع التقاط ADC من خادم بيانات وصفية على GCE أو Cloud Run. بنية نشر رفرف
 * (Vercel للتطبيقات، Hostinger VPS للـ API) لا تملك ذلك الخادم، فغياب المتغير
 * هناك يعني عطلاً مؤكداً عند أول طلب — وكشفه في الجاهزية أفضل من تمريره.
 * أي نقل مستقبلي إلى GCE يستلزم إعادة النظر في هذا الشرط.
 */
export function vertexConfigured(env: ChatProviderEnv): boolean {
  if (!vertexProject(env)) return false;
  return Boolean(
    trimmed(env.GOOGLE_APPLICATION_CREDENTIALS) ??
    trimmed(env.GOOGLE_CLOUD_CREDENTIALS),
  );
}

export function generativeAiApiKey(env: ChatProviderEnv): string | undefined {
  return (
    trimmed(env.GOOGLE_GENERATIVE_AI_API_KEY) ?? trimmed(env.GEMINI_API_KEY)
  );
}

export function generativeAiConfigured(env: ChatProviderEnv): boolean {
  return Boolean(generativeAiApiKey(env));
}

export function openAiCompatibleApiKey(
  env: ChatProviderEnv,
): string | undefined {
  return trimmed(env.RAFRAF_OPENAI_COMPATIBLE_API_KEY);
}

function isPrivateIpv4(hostname: string): boolean {
  const parts = hostname.split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part))) {
    return false;
  }
  const octets = parts.map(Number);
  if (octets.some((part) => part < 0 || part > 255)) return false;
  const [first = -1, second = -1] = octets;
  return (
    first === 0 ||
    first === 10 ||
    first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168)
  );
}

function isPrivateIpv6(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (!host.includes(':')) return false;
  if (host === '::' || host === '::1') return true;
  if (/^(?:fc|fd)/.test(host)) return true;
  if (/^fe[89ab]/.test(host)) return true;
  const mappedIpv4 = host.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (mappedIpv4) return isPrivateIpv4(mappedIpv4);
  const mappedHex = host.match(/^::ffff:([\da-f]{1,4}):([\da-f]{1,4})$/);
  if (!mappedHex) return false;
  const high = Number.parseInt(mappedHex[1] ?? '', 16);
  const low = Number.parseInt(mappedHex[2] ?? '', 16);
  return isPrivateIpv4(
    `${high >>> 8}.${high & 0xff}.${low >>> 8}.${low & 0xff}`,
  );
}

function isLocalOrPrivateHostname(hostname: string): boolean {
  const host = hostname
    .replace(/^\[|\]$/g, '')
    .replace(/\.$/, '')
    .toLowerCase();
  return (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    isPrivateIpv4(host) ||
    isPrivateIpv6(host)
  );
}

/**
 * يعيد عنوان API مطبّعاً فقط إن كان صالحاً لبيئة التشغيل.
 *
 * محلياً يُسمح بـ HTTP وlocalhost لتشغيل Ollama وLM Studio. في الإنتاج
 * يُقبل HTTPS عام فقط، ولا تُقبل بيانات اعتماد داخل الرابط أو query/hash.
 */
export function openAiCompatibleBaseUrl(
  env: ChatProviderEnv,
): string | undefined {
  const raw = trimmed(env.RAFRAF_OPENAI_COMPATIBLE_BASE_URL);
  if (!raw) return undefined;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return undefined;
  }
  if (
    env.NODE_ENV === 'production' &&
    (url.protocol !== 'https:' || isLocalOrPrivateHostname(url.hostname))
  ) {
    return undefined;
  }
  return url.toString().replace(/\/$/, '');
}

export function openAiCompatibleConfigured(env: ChatProviderEnv): boolean {
  const model = trimmed(env.RAFRAF_AI_MODEL);
  if (!model || !openAiCompatibleBaseUrl(env)) return false;
  // أي endpoint عام في الإنتاج يجب ألا يكون API مفتوحاً بلا مصادقة.
  return env.NODE_ENV !== 'production' || Boolean(openAiCompatibleApiKey(env));
}

/**
 * المزوّد الذي طلبه `RAFRAF_AI_PROVIDER` صراحةً، اكتمل إعداده أم لا؛ للعرض فقط
 * (مثلاً نموذج المزوّد المطلوب حين ينقصه مفتاحه)، ولا يختار مزوّداً أبداً.
 */
export function requestedChatProvider(
  env: ChatProviderEnv,
): ChatModelProvider | null {
  const preferred = trimmed(env.RAFRAF_AI_PROVIDER)?.toLowerCase();
  if (preferred === 'google') return 'google-generative-ai';
  return preferred === 'vertex' ||
    preferred === 'google-generative-ai' ||
    preferred === 'openai-compatible' ||
    isHostedProvider(preferred as ChatModelProvider)
    ? (preferred as ChatModelProvider)
    : null;
}

/**
 * يعيد المزوّد المطلوب، أو null إن لم يكتمل إعداده.
 * `RAFRAF_AI_PROVIDER` اختيار صريح لا يسقط إلى غيره، والقيمة المجهولة خطأ
 * إعداد. بدونه يُقدَّم Vertex ثم Gemini فقط للمحافظة على التوافق السابق؛
 * endpoint المفتوح المصدر والمزوّدات المستضافة (Hugging Face وAnthropic) لا
 * تُختار ضمنياً لأن كلاً منها حد ثقة جديد يجب إقراره صراحةً.
 */
export function resolveChatProvider(
  env: ChatProviderEnv,
): ChatModelProvider | null {
  const preferred = trimmed(env.RAFRAF_AI_PROVIDER)?.toLowerCase();
  if (preferred === 'vertex') {
    return vertexConfigured(env) ? 'vertex' : null;
  }
  if (preferred === 'google' || preferred === 'google-generative-ai') {
    return generativeAiConfigured(env) ? 'google-generative-ai' : null;
  }
  if (preferred === 'openai-compatible') {
    return openAiCompatibleConfigured(env) ? 'openai-compatible' : null;
  }
  if (isHostedProvider(preferred as ChatModelProvider)) {
    const hosted = preferred as HostedChatModelProvider;
    return hostedProviderConfigured(env, hosted) ? hosted : null;
  }
  if (preferred) throw new ChatProviderConfigurationError(preferred);
  if (vertexConfigured(env)) return 'vertex';
  if (generativeAiConfigured(env)) return 'google-generative-ai';
  return null;
}
