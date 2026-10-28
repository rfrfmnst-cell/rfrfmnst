# تقرير جاهزية رفرف للإنتاج — 28 أكتوبر 2026

**الحالة: مرشح قابل للمراجعة، غير معتمد للنشر الإنتاجي.** اكتملت اختبارات
الكود والبناء والتشغيل المعزول للتطبيقات الأربعة. لم يثبت قبول Staging أو
اتصال API بقاعدة الأعمال الحالية، ولم يحدث دمج أو نشر أو تعديل بيانات إنتاج.

المستودع المعتمد: `rfrfmnst-cell/rfrfmnst`. فرع الفحص المستقل:
`codex/rafraf-production-readiness-20261028`.
[مسودة المراجعة PR #14](https://github.com/rfrfmnst-cell/rfrfmnst/pull/14).
السجل المنظم والبصمات ونتائج كل مرحلة في
[ملف الأدلة](production-readiness-evidence-2026-10-28.json).

## مراجعة الفروع وGitHub Actions

- أساس المرشح أحدث `main@b9ea7f63156934b34cc53fa4f82c7fdc077fc266` وقت
  المراجعة. جُمعت رؤوس PR #12 وPR #13 في فرع الفحص دون تعارض ودون تعديل
  فرعيهما أو دمجهما في main. بقيت تكاملات Tap وOTO وSupabase كما في main.
- [PR #12](https://github.com/rfrfmnst-cell/rfrfmnst/pull/12) عند `20c38e7`:
  نجحت مهام Actions الأربع للبناء والتشغيل. حافظ المرشح على تحرير حجز
  محاولة OTP عند تعذر Twilio؛ اختباره التدفقّي ما زال ناجحًا بعد التصحيح.
- [PR #13](https://github.com/rfrfmnst-cell/rfrfmnst/pull/13) عند `e925f14`:
  نجحت المهام الخمس، بما فيها API وPostgreSQL المحلية المعزولة.
- فحوص PRs السابقة لم تشمل كل اختبارات تطبيقات الويب والصلاحيات. أضيفت
  بوابات للأنواع وLint وJest والسلوك وOTP ومخططات Prisma والأبنية والإقلاع
  للتطبيقات الأربعة، مع بقاء اختبارات المصدر والأمان فعالة.
- تُراجع نتائج PR #14 للـSHA المحدد في ملف الأدلة. لا تُنسب نتائج SHA قديمة
  تلقائيًا إلى رأس أحدث، ولا تمثل علامة Actions الخضراء قبول Staging.

## الأخطاء المثبتة والإصلاحات

1. **تجاوز متوقع لحماية TLS في عنوان اتصال API.** كان قارئ URL يفحص أول
   قيمة `sslmode` بينما يأخذ مشغّل pg الأخيرة؛ أثبتت تجربة بلا شبكة أن
   `verify-full` ثم `disable` يمرّان من الحارس ويعطّلان TLS عند المشغّل.
   صار التكرار مرفوضًا قبل فتح الحوض، حتى عند ترميز اسم الوسيط. فشل اختبار
   regression قبل التصحيح ونجح بعده.
2. **قبول OTP بعد انتهاء المهلة المحلية.** أثبتت حالتان أن رد المزوّد
   المتأخر قد يُنتج جلسة للعميل والمورد بعد خمس دقائق. بعد موافقة المالك
   الصريحة، أضيف فحص المهلة داخل معاملة إتمام التحقق بعد أقفالها، ومعالجة
   إعادة توجيه المورد إلى انتهاء الرمز. نجحت 12 حالة بعد التصحيح مقابل
   فشل حالتين قبله. لم تتغير حدود المحاولات أو منطق PR #12 أو فرع Copilot.
   ملف `docs/release-gates/otp-expiry-fix.patch` سجل التصحيح المطبق بالفعل.
3. **Lint لا يشمل الاختبارات بصورة صحيحة.** أعيد إنتاج 11 خطأ لأن ملفات
   spec مستبعدة من مشروع TypeScript المستخدم في ESLint. أضيف مشروع ESLint
   خاص بها، وبقي استبعادها من بناء الإنتاج. عُرّف `process` كمتغير Node
   للملفات الاختبارية عند المورد دون تخفيف قواعد شيفرة التطبيق.
4. **فحوص عزل الموردين تفترض المستودع الأصلي الكامل.** كانت تفشل في النسخ
   المنفصلة، أو قد تمسح مجلدًا غائبًا. صار الفحص يجد مصادر التطبيق المجاور
   ويتأكد من وجودها، ويستمر في فحص الحقول المالية وملكية استعلامات المورد.
5. **أصول Figma غير مرفقة بالمصدر المنقول.** فُصل اختبار مكون OfferRow الفعلي
   عن مطابقة ملفات التأليف الخارجية؛ الأول يعمل، والثاني يسجل skip صريحًا
   واحدًا في كل نسخة UI. مطابقة Figma **غير متحقق منها**، وليست نجاحًا مصطنعًا.
6. شُغلت اختبارات سلوك العميل والمورد والإدارة ضمن `pnpm test`، وثُبت حل
   محول ts-jest لكل حزمة، وحددت موارد Jest، وأصبحت أوامر `verify` تستدعي
   المشغّل الفعلي بدل أدوات من المستودع الأصلي غير مرفقة بالحزم.

لم تُعدّل واجهات أو تصاميم أو سياسات تجارية. تعديل تسجيل الدخول اقتصر على
التصحيح المحدود الذي وافق عليه المالك. لا API V2 جديدة ولا migrations.

## النتائج المحلية النهائية

Node.js 24.19.0، pnpm 11.6.0، تثبيت مقيد بالـlockfiles، دون تمرير اعتماد
قاعدة أو مزود حقيقي إلى مشغّل التحقق.

| التطبيق | الأنواع وLint | سلوك التطبيق | Jest المشتركة | UI | اختبارات الحزمة | البناء والإقلاع |
| --- | --- | ---: | ---: | --- | ---: | --- |
| العميل | ناجحان | 24 ناجحًا | 331 ناجحًا | 7 ناجحة، 1 اختياري متجاوز | 35 ناجحًا | ناجحان |
| المورد | ناجحان | 20 ناجحًا | 331 ناجحًا | 7 ناجحة، 1 اختياري متجاوز | 35 ناجحًا | ناجحان |
| الإدارة | ناجحان | 5 ناجحة | 331 ناجحًا | 7 ناجحة، 1 اختياري متجاوز | 30 ناجحًا | ناجحان |
| API | ناجحان | 5 HTTP ناجحة | 23 ناجحًا | لا ينطبق | 57 ناجحًا | ناجحان |

اختبارات المكتبة المشتركة مكررة عبر ثلاث نسخ مستقلة، وليست 993 اختبارًا
فريدًا. أضيفت 5 فحوص حدود جلسات العميل والمورد والإدارة وMFA والصلاحيات،
وتندرج ضمن 46 فحصًا ناجحًا للجذر والتكاملات. شمل ذلك 34 حالة Tap/OTO.
نجحت بوابة مهلة OTP في 12 حالة مستقلة، بما فيها استمرار نجاح إصلاح انقطاع
Twilio. لا اختبارات متعثرة في الدورة المحلية النهائية؛ بقيت ثلاثة اختبارات
Figma الاختيارية متجاوزة صراحة.

نجحت أيضًا 9 تحققات للحزمة الإنتاجية مقابل PostgreSQL 17 محلية مؤقتة:
رفض مخطط ناقص، ودور قراءة فقط لا يملك INSERT، وسحب SELECT ثم إعادتها،
ونقص جدول، وبقاء liveness مستقلة. أزيلت حاوية الاختبار وحدها. ليست هذه
القاعدة نسخة من بيانات الإنتاج ولا دليلًا على صلاحية اعتماد قاعدة المنصة.

## PostgreSQL وPrisma وSupabase

- لا يوجد `DATABASE_URL` أو `API_DATABASE_URL` أو اعتماد جلسات أو Staging
  في بيئة المهمة. لم تُقرأ أسرار GitHub؛ محاولة قراءة أسماء إعداداته فقط
  رفضت بـ403، ولا بيئات أو Deployments مسجلة ظاهرة عبر اتصال GitHub المتاح.
- أُنجز فحص PostgreSQL فعلي عبر موصل Supabase داخل `BEGIN READ ONLY` ثم
  `ROLLBACK`. الخادم 17.11، والمشروع `gfxnwfjjpxmzvnylushd` يحوي جدول
  `public.tap_payment_attempts` فقط. الجداول `users/customers/suppliers/
  rfqs/quotes/orders` و`_prisma_migrations` غير موجودة في هذا المشروع.
- هذا مشروع التكامل، وليس دليلًا على فقدان جداول قاعدة الأعمال. **لا تُنشأ
  فيه جداول Prisma لمعالجة المشكلة**. يبقى مصدر حسابات وطلبات المنصة قاعدة
  PostgreSQL التي تستخدمها تطبيقات BFF الثلاثة؛ عنوانها واعتمادها غير متاحين
  لهذه الجلسة، لذلك اتصال API بها وتوافق المخطط الحي غير متحقق منهما.
- ملفات مخطط Prisma الثلاثة في كل تطبيق متطابقة بين التطبيقات، ببصمة
  SHA256 المسجلة في الأدلة، ونجح `prisma validate` لكل نسخة باستخدام عناوين
  loopback اصطناعية بلا اتصال. Prisma Client المولد 6.19.3. لا ترقية شاملة
  أو seed أو migration أو db push. يوجد تحذير ترقية إعداد Prisma إلى تنسيق
  Prisma 7 مستقبلًا، وليس فشلًا في الإصدار الحالي.
- تطابقت الأعمدة والقيود والفهارس الظاهرة لجدول Tap مع migration الموجودة.
  RLS وFORCE RLS مفعلان، وanon وauthenticated لا يقرآن أو يكتبان. الفهرس
  الفريد لحجز الطلب النشط موجود. لا تحذير أمان خطير؛ توجد ملاحظة معلوماتية
  متوقعة عن غياب سياسات العملاء لجدول خادم فقط:
  [شرح مستشار Supabase](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy).

## المصادقة وStaging والفحص العام

أفاد المالك بوجود Staging وتعذر إرسال روابطها. لم تُفترض نطاقات الإنتاج
كبديل لها. لم يتوفر هدف Staging أو حسابات اختبار معتمدة أو اتصال آمن إليه،
لذا تسليم OTP والبريد وتحديث الجلسات والصلاحيات على بيانات Staging الفعلية
**غير متحقق منها**. الاختبارات المنفذة محلية ومحاكية ومعزولة.

أثبتت اختبارات الكود: فصل توكنات البوابات رغم وجود مفتاح جلسة مشترك للعميل
والمورد، وعدم استخدام تحدي MFA كجلسة إدارة، وانتهاء الجلسات، والحظر عند
إيقاف المورد أو تعذر القاعدة، ورفض الصلاحيات غير المدرجة، ومنع OTP المحلي
في إنتاج الإدارة. لم يرسل أي رمز إلى عميل أو مورد حقيقي.

في فحص GET عام للقراءة فقط على النطاقات الحالية:

| المسار | النتيجة المرصودة | الحد العملي |
| --- | --- | --- |
| حياة العميل والمورد والإدارة | HTTP 200 | حياة عملية فقط؛ لا تثبت الدخول أو صحة البيانات |
| `https://api.rfrf.net/api/liveness` | HTTP 404 | لا يمكن إثبات تشغيل نسخة API المطابقة للمصدر الحالي |
| صفحة دخول العميل | HTTP 200 ورسالة عدم إتاحة الدخول | تحتاج مراجعة إعدادات المضيف واتصال القاعدة؛ HTTP 200 ليس قبولًا |
| صفحتا دخول المورد والإدارة | HTTP 200 | لم يُرسل نموذج أو OTP ولم تُختبر جلسة فعلية |

لا يكفي هذا لتحديد إعداد مفقود بعينه في Hostinger؛ صلاحيات قراءة إعدادات
الاستضافة غير متاحة. لم يُستبدل المصدر العامل أو يُغيّر DNS أو إعداد تشغيل.

## Tap وOTO

بقيت ملفات التكاملات وSupabase مطابقة لـmain. نجحت محاكاة التوقيع والحجز
والتكرار والمبلغ والتاجر والحالات غير المحسومة وحظر الدفع والشحن الحي.
فحوص الصحة العامة للدالتين أعادت 200، لكنها صرحت بما يلي:

- Tap: مفتاح التاجر ومعرفه والوضع الصحيح غير متاحة للدالة المتصلة.
- OTO: رمز التحديث غير موجود والخدمة غير مفعلة، وتهيئة إيقاف الشحن الآلي
  الصريحة غير مكتملة؛ الدالة نفسها تصرح بأنها لا تنشئ شحنات.

لم يُجرَ checkout مصرح به أو استرداد أو تسوية أو إنشاء طلب شحن أو بوليصة.
المطلوب لاحقًا إعداد Sandbox في بيئة اختبار مصرح بها، وضبط الإشعارات
والتحقق من المصالحة والاسترداد وعزل الموردين قبل أي تحصيل أو شحن.

## المتبقي قبل اعتماد الإنتاج

1. توفير هدف Staging يمكن الوصول إليه عبر اتصال معتمد دون إرسال أسرار في
   المحادثة. تجهيز بيانات وحسابات اصطناعية للعميل وموردين ومدير بصلاحيات مختلفة.
2. ضبط اعتماد PostgreSQL قراءة فقط لقاعدة الأعمال في البيئة الآمنة، والوصول
   الشبكي المأذون، وTLS موثق. تنفيذ `/api/readiness` المحمية ومراجعة توافق
   الأعمدة والقيود وسجل migrations وRLS والعلاقات دون تعديل إنتاج.
3. إثبات التسجيل وOTP الصحيح والخاطئ والمنتهي والمكرر وتعذر المزوّد، وبقاء
   الجلسة وإبطالها وإيقاف الحساب، وعزل طلبات عميلين وموردين، وMFA وصلاحيات الإدارة.
4. تشخيص اختلاف API المنشورة عن عقد liveness ورسالة عدم إتاحة دخول العميل
   من إعدادات الاستضافة وسجلات منقحة، وتجربة الحل في Staging أولًا.
5. إكمال Tap/OTO Sandbox والإشعارات الموقعة، دون معاملات إنتاجية، ومراجعة
   إعدادات كل خدمة في بيئتها الخاصة؛ أسرار Hostinger لا تنتقل تلقائيًا إلى Supabase.
6. اختبار استعادة نسخة احتياطية من قاعدة الأعمال والتخزين الخاص إلى بيئة
   معزولة، وتثبيت SHA مرشح وخطة رجوع وموافقة صريحة على النشر المستهدف.

لا يجوز وصف المرشح بأنه جاهز للإنتاج قبل إغلاق البنود السابقة بأدلة فعلية.
مسودة PR #14 تحفظ الإصلاحات والفحوص وتبقى للمراجعة فقط.

## تسليم عاجل وحماية العمل

أُوقف التوسع بطلب المالك. ملفات الإصلاحات والتوثيق محفوظة على GitHub،
وحالة العمل المحلية نظيفة وقت التحقق. طُوبقت بصمات Git blob للملفات المعدلة
مع شجرة GitHub الفعلية، ولم يُكتفَ بنجاح الأمر المحلي.

- [فرع المرشح وPR #14](https://github.com/rfrfmnst-cell/rfrfmnst/pull/14).
- التزام الشيفرة: `e733ac50ea98a05a5749a9e37712ccbd728b3ca5`. نجحت
  workflows الثلاثة لهذا الرأس: بناء Hostinger، فحوص API، والتحقق الشامل.
- التزام التقرير قبل هذا الملحق: `37a59324fdb5a22090cdffd40ae1516ddd5e0f43`،
  لا يغير شيفرة الإصلاحات. نتائج Actions النهائية لكل رأس تُراجع من تبويب Checks؛
  لا تُنسب نتيجة التزام إلى التزام أحدث تلقائيًا.
- [نسخة استرجاع العمل السابق](https://github.com/rfrfmnst-cell/rfrfmnst/tree/codex/rafraf-recovered-snapshot-20261028)
  عند `322f454` محفوظة أيضًا؛ لا تستبدل بها main أو عمل Copilot الأحدث.
- [إصلاح المورد السابق #12](https://github.com/rfrfmnst-cell/rfrfmnst/pull/12)
  و[إصلاح API السابق #13](https://github.com/rfrfmnst-cell/rfrfmnst/pull/13)
  محفوظان دون تعديل فرعيهما. تصحيح مهلة OTP في المرشح أجيز صراحة من المالك.

قاعدة الأعمال الأصلية مستخدمة عبر Prisma و`DATABASE_URL` في تطبيقات
العميل والمورد والإدارة. لا يتوفر عنوانها أو اعتمادها في هذه الجلسة، فلا
يمكن الجزم باسم المضيف أو فحص بياناتها. مشروع Supabase المتصل للتكاملات
فقط وليس قاعدة بديلة. لا تنشئ قاعدة أو جداول لتعويض غياب الاعتماد.

للاستكمال: افتح فرع PR #14، اقرأ ملف الأدلة ونتائج Checks للرأس الحالي،
ثم جهّز اتصالًا آمنًا بقاعدة الأعمال بدور قراءة فقط وTLS موثق وهدف Staging
معتمد. لا ترسل الأسرار في المحادثة. نفّذ بوابات التحقق المسجلة أعلاه،
واختبر الجلسات وOTP والحقوق في Staging فقط قبل طلب اعتماد الإنتاج.
لا توجد تغييرات شيفرة غير مكتملة تحتاج النقل من ملفات مؤقتة؛ السجلات
المولدة الكاملة محلية في `outputs/verification/`، والنتائج اللازمة للتسليم
محفوظة في JSON داخل GitHub. لا دمج أو نشر أو تعديل إنتاج في هذه الجلسة.

### الملفات المعدلة في المرشح مقارنةً بـmain

- `.github/workflows/rafraf-api-readiness.yml`
- `.github/workflows/rafraf-release-gates.yml`
- `docs/release-gates/otp-expiry-fix.patch`
- `docs/reports/api-recovery-handoff-2026-10-28.md`
- `docs/reports/api-recovery-validation-2026-10-28.json`
- `docs/reports/production-readiness-2026-10-28.md`
- `docs/reports/production-readiness-evidence-2026-10-28.json`
- `scripts/audit-otp-expiry.mjs`
- `scripts/auth-boundaries.test.mjs`
- `scripts/verify-site.mjs`
- `sites/admin.rfrf.net/apps/admin/package.json`
- `sites/admin.rfrf.net/package.json`
- `sites/admin.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/admin.rfrf.net/packages/shared/eslint.config.mjs`
- `sites/admin.rfrf.net/packages/shared/jest.config.ts`
- `sites/admin.rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/admin.rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/admin.rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
- `sites/api.rfrf.net/API_DATABASE_READINESS.md`
- `sites/api.rfrf.net/MANAGED_HOSTINGER.md`
- `sites/api.rfrf.net/apps/api/jest.config.ts`
- `sites/api.rfrf.net/apps/api/package.json`
- `sites/api.rfrf.net/apps/api/src/app.module.ts`
- `sites/api.rfrf.net/apps/api/src/database-readiness.spec.ts`
- `sites/api.rfrf.net/apps/api/src/database-readiness.ts`
- `sites/api.rfrf.net/apps/api/src/readiness.controller.ts`
- `sites/api.rfrf.net/apps/api/test/app.e2e-spec.ts`
- `sites/api.rfrf.net/apps/api/test/jest-e2e.json`
- `sites/api.rfrf.net/package.json`
- `sites/api.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/api.rfrf.net/pnpm-lock.yaml`
- `sites/api.rfrf.net/scripts/managed-storage-seed.test.mjs`
- `sites/api.rfrf.net/scripts/test-api-database.mjs`
- `sites/rfrf.net/apps/customer/lib/customer-auth-service.ts`
- `sites/rfrf.net/apps/customer/package.json`
- `sites/rfrf.net/package.json`
- `sites/rfrf.net/packages/jest-config/src/nest.ts`
- `sites/rfrf.net/packages/shared/eslint.config.mjs`
- `sites/rfrf.net/packages/shared/jest.config.ts`
- `sites/rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
- `sites/supplier.rfrf.net/apps/supplier/app/login/actions.ts`
- `sites/supplier.rfrf.net/apps/supplier/eslint.config.mjs`
- `sites/supplier.rfrf.net/apps/supplier/lib/auth-flow.test.mjs`
- `sites/supplier.rfrf.net/apps/supplier/package.json`
- `sites/supplier.rfrf.net/package.json`
- `sites/supplier.rfrf.net/packages/jest-config/src/nest.ts`
- `sites/supplier.rfrf.net/packages/shared/eslint.config.mjs`
- `sites/supplier.rfrf.net/packages/shared/jest.config.ts`
- `sites/supplier.rfrf.net/packages/shared/src/security/source-guard.spec.ts`
- `sites/supplier.rfrf.net/packages/shared/tsconfig.eslint.json`
- `sites/supplier.rfrf.net/packages/ui/test/offer-row-code-connect-contract.test.mjs`
