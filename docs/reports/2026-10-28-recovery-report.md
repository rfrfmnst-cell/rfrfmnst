# تسليم إصلاحات رفرف — 28 أكتوبر 2026

الحالة: تم جزئيًا، مع حفظ عاجل بطلب المالك لقرب انتهاء حصة Codex.
المستودع المعتمد وحده: https://github.com/rfrfmnst-cell/rfrfmnst
الفرع: `codex/rafraf-main-recovery-20261028` من `main@b9ea7f6`.
لم يحدث دمج أو نشر أو تعديل قاعدة إنتاج أو عملية دفع أو شحنة أو شراء.

## المنجز المحفوظ

- مراجعة PR #9 ومقارنته بأحدث main وحل تعارضاته الـ17. معظم إصلاحاته
  موجودة أصلًا في main؛ حُفظت الأحدث ومنها رابط تيك توك وفحص أخطاء QA.
  نقل التغييرات المتبقية في الالتزام `5a1df85` دون حذف ملفات من main.
- إصلاح قبول OTP بعد انتهاء المهلة أثناء انتظار المزوّد للعملاء والموردين.
  اختبارات regression فشلت قبل الإصلاح ثم نجحت بعده. إبقاء حدود المحاولات
  ومنع replay والحسابات المعطلة والمورد الموقوف وفصل الجلسات.
- قبول أرقام OTP العربية والفارسية في بوابة الإدارة، مع اختبارات التطبيع.
- جعل تحميل ts-jest صريحًا من حزمة المستهلك مع tsconfig صريح، وتحديد
  عاملَي Jest؛ إصلاح ESLint لملفات الاختبار دون إدخالها في بناء الإنتاج.
- إصلاح فحوص عزل الموردين لتجد تطبيقات المصادر المتجاورة، وإصلاح مسار
  ملفات الاختبار المؤقتة ليعمل خارج بيئة التحضير الأصلية.
- تشغيل اختبارات التطبيقات ضمن pnpm test، وإضافة verifier وCI للتطبيقات
  الأربعة، وبناء Hostinger وتشغيل runtime دون أسرار أو طلبات مزودين.
- تنقيح أخطاء قاعدة بيانات OTP لتسجل رموزًا ثابتة دون رسالة Prisma الخام.
- حفظ خطة نشر ونسخ احتياطي واستعادة ورجوع مستقلة، وفهرس بصمات ملفات المصدر.

## نتائج الاختبارات المثبتة عند الحفظ

| المجال | النتيجة |
| --- | --- |
| الجذر وTap وOTO المحاكيان | 45 ناجحًا، منها 34 لتكاملي Supabase |
| API | TypeScript وLint و15 Jest و3 HTTP e2e و57 اختبار حزمة؛ البناء والإقلاع ناجحان |
| العميل | TypeScript وLint و25 سلوك و331 Jest و7 UI و35 اختبار حزمة ناجحة |
| المورد | 20 سلوك و331 Jest و7 UI و35 اختبار حزمة وLint ناجحة؛ بناء وإقلاع دورة سابقة ناجحان |
| الإدارة | TypeScript وLint و7 سلوك و331 Jest و7 UI و30 اختبار حزمة ناجحة |
| Figma | اختبار واحد متجاوز صراحة في كل نسخة UI بسبب غياب ملفات التأليف؛ مطابقة Figma غير متحقق منها |
| أبنية العميل والإدارة وإعادة التحقق النهائي للمورد وفحص المتصفح | قيد التشغيل وقت أخذ اللقطة؛ لا تُعتبر ناجحة حتى مراجعة النتائج |

الأعداد تشمل نسخ المكتبة المشتركة المتطابقة في مساحات العمل الثلاث؛ ليست
كلها اختبارات فريدة. تفاصيل الدورة الأخيرة والأخطاء السابقة في
[سجل التحقق](2026-10-28-validation.json). السجلات الكاملة المحلية في
`outputs/verification/`، وسجلات المهام في `/tmp/rafraf-verify-*.log`.
المخرجات المولدة محفوظة محليًا ومُستبعدة من Git عمدًا.

## حدود التحقق والمتبقي

- TypeScript المورد أخفق أولًا لأن حالة expired الجديدة غابت من اتحاد
  النوع. حُدّث النوع بأمان؛ يجب قراءة نتيجة إعادة التحقق الجارية قبل اعتماده.
- ملف CSV يحصر ملفات المصدر وبصماتها ومقارنتها بـmain؛ لا يُمثل مراجعة
  يدوية كاملة لكل سطر. لا ملفات محذوفة من خط أساس main وقت الحفظ.
- قاعدة المنصة الأصلية للعملاء والموردين والطلبات غير متاحة في البيئة؛
  سلامة بياناتها واتصالها وتطبيق RLS عليها غير متحقق منها. Supabase المتاح
  قاعدة تكامل Tap فقط، وقراءة الصلاحيات أكدت منع anon/authenticated.
- Tap وOTO أعادا health 200 ورفض الوصول غير المصرح به 401، لكن إعدادات
  المزودين غائبة. اختبارات sandbox الحقيقية وتسليم OTP غير متحقق منها.
- صفحات المشغّل المحمية وواجهات الحسابات الفعلية تحتاج staging وقاعدة اختبار
  اصطناعية ومزودي OTP/البريد المصرح بهم؛ لا تعتمد HTTP200 وحده.
- لا اتصال إدارة استضافة Hostinger مثبت في هذه الجلسة. لا جاهزية نشر إنتاج
  قبل إكمال الاختبارات والمراجعة وتجربة الاستعادة والحصول على موافقة المالك.

## كيفية الاستكمال

1. افتح الفرع الصحيح، وافحص git status وorigin/main؛ حافظ على أي عمل أحدث.
2. اقرأ `outputs/verification/*/report.json` إن استمرت البيئة، ثم سجلات
   build/runtime ونتيجة المتصفح في `sites/*/outputs/visual-review/report.json`.
   بعض المهام قد تنتهي بعد لقطة هذا التقرير؛ لا تعتمد سجلات قديمة لبناء جديد.
3. على بيئة جديدة: Node.js 24 وpnpm 11.6.0، ثم في كل موقع
   `pnpm install --frozen-lockfile`، ومن جذر المستودع:

```sh
node scripts/verify-site.mjs api.rfrf.net
node scripts/verify-site.mjs rfrf.net
node scripts/verify-site.mjs supplier.rfrf.net
node scripts/verify-site.mjs admin.rfrf.net
node --test scripts/*.test.mjs supabase/tests/*.test.mjs
```

4. لا تضف ملفات أسرار؛ verifier يرفض ملفات البيئة الخاصة ويحذف أسرار الخدمات
   من بيئة أبنائه. يولّد Prisma محليًا دون migration أو seed أو اتصال قاعدة.
5. اختبر الواجهات من الحزم المكتملة باستخدام Playwright؛ يمكن ضبط
   `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH` إلى Chromium المحلي. راجع desktop
   وmobile وRTL والتجاوز الأفقي ورسائل الخطأ. سكربت المورد بالجذر مصمم أيضًا
   للنسخ إلى بيئة Playwright كما في workflow؛ التبعيات متوفرة داخل موقع المورد.
6. أصلح أي فشل آمن، ثم حدّث سجل النتائج والتقرير وادفع إلى فرع الإصلاحات
   نفسه. لا تعلن اكتمال البناء أو تسجيل الدخول الفعلي دون دليل جديد.
7. راجع [خطة النشر الآمن](../hostinger-safe-release-2026-10-28.md)، ثم جهّز
   staging بموافقة المالك. لا تنشر الإنتاج أو تدمج main في هذه المهمة.

## API V2 متوقفة مؤقتًا

التصميم محفوظ ومرفوع في https://github.com/rfrfmnst-cell/rfrfmnst/pull/10
على `codex/rafraf-api-v2-design-20261028` بالالتزام `4adb9e3`.
يتضمن `docs/api-v2/README.md` وخطة النقل والمخاطر و`openapi.json`.
نجح تحقق بنية OpenAPI. لا توجد مسارات V2 منفذة ولا حذف للـAPI القديمة.
العمل التالي بعد استئناف التطوير: جرد العقود، adapter هوية وصلاحيات معتمد،
قراءة الطلبات خلف علم مغلق، اختبارات DB معزولة، ثم نقل الأوامر تدريجيًا.
لا يبدأ هذا العمل الإضافي قبل استئناف المالك؛ الأولوية الآن حفظ الإصلاحات.

## الملفات المعدلة والجديدة في فرع الإصلاحات

- `.github/workflows/rafraf-hourly-review.yml`
- `.github/workflows/rafraf-verified-build.yml`
- `README.md`
- `docs/hostinger-safe-release-2026-10-28.md`
- `docs/reports/2026-10-18-interfaces.md`
- `docs/reports/2026-10-28-source-inventory.csv`
- `docs/reports/2026-10-28-validation.json`
- `scripts/qa-public-sites.mjs`
- `scripts/qa-public-sites.test.mjs`
- `scripts/verify-site.mjs`
- `scripts/visual-qa-supplier.mjs`
- `sites/admin.rfrf.net/apps/admin/app/login/page.tsx`
- `sites/admin.rfrf.net/apps/admin/app/login/verify/route.ts`
- `sites/admin.rfrf.net/apps/admin/lib/auth-input.test.mjs`
- `sites/admin.rfrf.net/apps/admin/lib/auth-input.ts`
- `sites/admin.rfrf.net/apps/admin/package.json`
- `sites/admin.rfrf.net/package.json`
- `sites/admin.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/admin.rfrf.net/packages/shared/eslint.config.mjs`
- `sites/admin.rfrf.net/packages/shared/jest.config.ts`
- `sites/admin.rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/admin.rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/admin.rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
- `sites/api.rfrf.net/apps/api/jest.config.ts`
- `sites/api.rfrf.net/apps/api/test/app.e2e-spec.ts`
- `sites/api.rfrf.net/apps/api/test/jest-e2e.json`
- `sites/api.rfrf.net/package.json`
- `sites/api.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/api.rfrf.net/scripts/managed-storage-seed.test.mjs`
- `sites/rfrf.net/apps/customer/lib/auth-flow.test.mjs`
- `sites/rfrf.net/apps/customer/lib/customer-auth-service.ts`
- `sites/rfrf.net/apps/customer/package.json`
- `sites/rfrf.net/package.json`
- `sites/rfrf.net/packages/jest-config/src/nest.ts`
- `sites/rfrf.net/packages/shared/eslint.config.mjs`
- `sites/rfrf.net/packages/shared/jest.config.ts`
- `sites/rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
- `sites/rfrf.net/scripts/visual-qa-customer.mjs`
- `sites/supplier.rfrf.net/apps/supplier/app/login/actions.ts`
- `sites/supplier.rfrf.net/apps/supplier/lib/auth-flow.test.mjs`
- `sites/supplier.rfrf.net/apps/supplier/lib/auth-input.test.mjs`
- `sites/supplier.rfrf.net/apps/supplier/package.json`
- `sites/supplier.rfrf.net/package.json`
- `sites/supplier.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/supplier.rfrf.net/packages/shared/eslint.config.mjs`
- `sites/supplier.rfrf.net/packages/shared/jest.config.ts`
- `sites/supplier.rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/supplier.rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/supplier.rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
