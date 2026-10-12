import type { INestApplication } from '@nestjs/common';

/**
 * ترويسات الحماية على سطح الـAPI.
 *
 * نسخة مطابقة لما في `config/security-headers.mjs` الذي يخدم التطبيقات الثلاثة.
 * لم تُستورد منه لأن `apps/api` يُبنى بـtsc بجذر خاص، واستيراد ملف خارج الجذر
 * يزحزح `outDir` ويكسر شكل المخرجات. فالتطابق يُحرس باختبار يقارن القائمتين
 * حرفاً بحرف بدل أن يُترك لليقظة البشرية.
 *
 * الحافز واقعة مقيسة: بعد نقل الترويسات إلى التطبيقات خرجت المضيفات الثلاث
 * بست ترويسات من ست، وبقي `api.` على خمس — بلا سياسة محتوى — ويعلن
 * `x-powered-by: Express` لكل ماسح.
 */
export const API_SECURITY_HEADERS = [
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), microphone=(), payment=()',
  },
] as const;

/**
 * الأصول التي يخدمها الـAPI عبر المتصفح.
 *
 * `enableCors()` بلا وسائط تعني `Access-Control-Allow-Origin: *` — وهو ما كان
 * يرد فعلاً من الإنتاج على كل الطرق بما فيها POST وDELETE. ولا سطح من أسطح
 * رفرف ينادي الـAPI من المتصفح أصلاً: التطبيقات الثلاثة تمرّ عبر وسيط على
 * الخادم (`proxy.ts`)، فالبديل المفتوح لم يكن يخدم أحداً ويمنح كل موقع على
 * الشبكة إذن القراءة عبر الأصول.
 *
 * القائمة أصول رفرف وحدها، وتُضبط عند الحاجة بـ`API_ALLOWED_ORIGINS`
 * (مفصولة بفواصل). أصلٌ خارجها يُرفض — على نهج «الرفض الآمن».
 */
export const DEFAULT_ALLOWED_ORIGINS = [
  'https://rfrf.net',
  'https://supplier.rfrf.net',
  'https://admin.rfrf.net',
] as const;

export function allowedOrigins(env: NodeJS.ProcessEnv = process.env): string[] {
  const configured = env.API_ALLOWED_ORIGINS?.trim();
  if (!configured) return [...DEFAULT_ALLOWED_ORIGINS];
  return configured
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin !== '');
}

/** وسيط Express يضع ترويسات الحماية على كل استجابة. */
export function securityHeadersMiddleware() {
  return (
    _req: unknown,
    res: { setHeader(key: string, value: string): void },
    next: () => void,
  ): void => {
    for (const { key, value } of API_SECURITY_HEADERS) {
      res.setHeader(key, value);
    }
    next();
  };
}

/** يركّب الترويسات وسياسة الأصول ويكتم بصمة الإطار. */
export function applyApiSecurity(
  app: INestApplication,
  env: NodeJS.ProcessEnv = process.env,
): void {
  // `x-powered-by: Express` يعلن الإطار لكل ماسح بلا فائدة تشغيلية.
  const httpAdapter = app.getHttpAdapter().getInstance() as {
    disable?: (setting: string) => void;
  };
  httpAdapter.disable?.('x-powered-by');

  app.use(securityHeadersMiddleware());
  app.enableCors({ origin: allowedOrigins(env) });
}
