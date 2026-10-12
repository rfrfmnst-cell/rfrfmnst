/**
 * ترويسات الحماية التي تصاحب كل استجابة من تطبيقات رفرف الثلاثة.
 *
 * لماذا في التطبيق لا في الحافة: كانت معرَّفة في `deploy/hostinger/Caddyfile`
 * وحده، ثم صارت حافة الإنتاج Envoy عند التدشين على Hostinger — فبقيت الحماية
 * في ملف لا يخدم حركة المرور، وخرج الموقع الحيّ بصفر ترويسات على المضيفات
 * الأربع. الترويسة التي تسكن التطبيق تسافر معه مهما تبدّل ما أمامه.
 *
 * ملف ESM عادي بلا بناء لأن `next.config.js` يُقرأ قبل أي خطوة ترجمة.
 */

/**
 * `frame-ancestors` وحدها من CSP.
 *
 * سياسة محتوى كاملة على موقع حيّ تكسر التصيير: التطبيقات تحقن سكربت تهيئة
 * السمة سطرياً، فأي `script-src` بلا nonce يُسقطه ويخرج الموقع بلا ثيم. أما
 * `frame-ancestors` فتحكم التأطير وحده ولا تمسّ تنفيذ أي مورد، فهي المقدار
 * الآمن الذي يُغلق الاختطاف البصري دون مخاطرة.
 */
const FRAME_ANCESTORS = "frame-ancestors 'none'";

export const SECURITY_HEADERS = [
  // سنة كاملة، ويشمل نطاقات رفرف الفرعية لأنها كلها HTTPS حصراً.
  // بلا `preload`: إدراج قائمة المتصفحات قرار يصعب التراجع عنه ويُتخذ منفصلاً.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains',
  },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Content-Security-Policy', value: FRAME_ANCESTORS },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  {
    key: 'Permissions-Policy',
    value: 'camera=(), geolocation=(), microphone=(), payment=()',
  },
];

/** يُدمج في `next.config.js`: يضيف الترويسات ويكتم بصمة الإطار. */
export function withSecurityHeaders(config, { allowMicrophone = false } = {}) {
  // Customer voice input needs the document policy on every entry route:
  // client navigation to /chat keeps the originating document's policy.
  // Other applications retain the default microphone denial.
  const headers = allowMicrophone
    ? SECURITY_HEADERS.map((header) =>
        header.key === 'Permissions-Policy'
          ? {
              ...header,
              value: 'camera=(), geolocation=(), microphone=(self), payment=()',
            }
          : header,
      )
    : SECURITY_HEADERS;
  return {
    ...config,
    // `x-powered-by: Next.js` يعلن الإطار ونسخته لكل ماسح، بلا فائدة تشغيلية.
    poweredByHeader: false,
    async headers() {
      const inherited = config.headers ? await config.headers() : [];
      return [...inherited, { source: '/:path*', headers }];
    },
  };
}
