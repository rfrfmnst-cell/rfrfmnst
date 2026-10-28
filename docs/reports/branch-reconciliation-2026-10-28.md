# تقرير مقارنة الفروع وحماية تكاملات رفرف

تاريخ الفحص: 2026-10-28

## النطاق والمرجع

- فرع المراجعة: `codex/rafraf-main-reconcile-20261028`
- أساس الفرع: `origin/main` عند `b9ea7f63156934b34cc53fa4f82c7fdc077fc266`
- PR #9: `codex/rafraf-verified-fixes` عند `7abecf5ba273d02a1d7eadb3e6d7459e339d8979`
- PR #10: `codex/rafraf-api-v2-design-20261028` عند `4adb9e3a958db52252d5e5d6294cb1657e6b7f4d`

لم يتغير أي من فرعي PR #9 وPR #10، ولم تُدمج تغييرات أو تُنشر إلى Hostinger.

## نتيجة المقارنة

### PR #9

مقارنة شجرتي `main` وPR #9 تُظهر 67 مسارًا مختلفًا: 31 ملفًا موجودًا في `main` وغير موجود في شجرة PR #9، و35 مسارًا معدلًا، وملفًا واحدًا موجودًا في PR #9 فقط. هذه ملفات موجودة في `main` وليست ملفات مفقودة من المستودع.

أُجري دمج افتراضي غير مطبق لتحديد التعارضات الفعلية. أبلغ Git عن 17 تعارضًا:

- تعارضات `add/add`:
  - `.github/workflows/rafraf-hourly-review.yml`
  - `docs/development-status.md`
  - `docs/releases/2026-10-18-header-offer.json`
  - `docs/releases/2026-10-19-login-audit.json`
  - `docs/reports/2026-10-18-header-offer.md`
  - `docs/reports/2026-10-19-login-audit-evidence.json`
  - `docs/reports/2026-10-19-login-audit.md`
  - `scripts/qa-public-sites.mjs`
  - `scripts/qa-public-sites.test.mjs`
  - `sites/rfrf.net/apps/customer/app/site-footer.module.css`
  - `sites/rfrf.net/apps/customer/app/site-footer.tsx`
  - `sites/rfrf.net/apps/customer/lib/auth-flow.test.mjs`
  - `sites/rfrf.net/apps/customer/lib/part-search-intake.ts`
  - `sites/rfrf.net/apps/customer/lib/vin-lookup.ts`
  - `sites/supplier.rfrf.net/apps/supplier/lib/auth-flow.test.mjs`
  - `sites/supplier.rfrf.net/apps/supplier/lib/auth-input.test.mjs`
- تعارض محتوى:
  - `sites/admin.rfrf.net/apps/admin/app/login/verify/route.ts`

لم يُطبّق الدمج الافتراضي ولم تُحل هذه التعارضات. يوجد أيضًا اختلاف في مسارات الدفع والشحن بين الشجرتين؛ يجب إبقاء نسخ `main` من هذه التكاملات وعدم استبدالها بنسخ PR #9 القديمة.

### ملفات `main` الـ31 غير الموجودة في شجرة PR #9

هذه الملفات باقية في `main`، ولم تُنسخ أو تُحذف:

```text
.github/agents/rafraf-developer.agent.md
.github/workflows/hostinger-build.yml
.github/workflows/supabase-integrations.yml
.gitignore
docs/deployment-review-2026-10-26.md
docs/oto-integration.md
docs/tap-integration.md
scripts/qa-hostinger-runtime.mjs
sites/admin.rfrf.net/apps/admin/lib/shipping/oto-supabase.ts
sites/rfrf.net/GOOGLE_FREE_SETUP.md
sites/rfrf.net/apps/customer/app/api/payments/checkout/route.ts
sites/rfrf.net/apps/customer/app/api/payments/tap/webhook/route.ts
sites/rfrf.net/apps/customer/app/google-tracking-consent.module.css
sites/rfrf.net/apps/customer/app/google-tracking-consent.tsx
sites/rfrf.net/apps/customer/lib/payments/tap-launch.ts
sites/rfrf.net/apps/customer/lib/payments/tap-supabase-provider.ts
supabase/.env.example
supabase/config.toml
supabase/functions/_shared/oto-service.ts
supabase/functions/_shared/tap-hosted.ts
supabase/functions/_shared/tap-service.ts
supabase/functions/_shared/tap-store.ts
supabase/functions/rafraf-oto/deno.json
supabase/functions/rafraf-oto/index.ts
supabase/functions/rafraf-tap/deno.json
supabase/functions/rafraf-tap/index.ts
supabase/migrations/20261026005747_tap_payment_attempts.sql
supabase/tests/oto-service.test.mjs
supabase/tests/tap-bridge.test.mjs
supabase/tests/tap-hosted.test.mjs
supabase/tests/tap-service.test.mjs
```

### المصادقة والواجهات

- وحدات OTP وإدخال بيانات المصادقة للعميل والمورد متطابقة في Git بين `main` وPR #9. تغييرات PR #9 في اختبارات المصادقة تقتصر على استيراد `node:process` وإعادة تسمية متغير fixture؛ لم يظهر فيها إصلاح لسلوك OTP أو تسجيل الدخول يمكن استعادته.
- مسار تحقق دخول الإدارة يختلف في الدمج الافتراضي، لكن المقارنة مع تجاهل المسافات لا تعرض فرقًا نصيًا. مع ذلك يبقى تعارض Git قائمًا، لذلك لم يُستبدل الملف ولم يُعاد تنسيقه.
- تعديلات الواجهة في PR #9 تزيل مكوّن الموافقة على Google Tag Manager والبيانات المنظمة، كما تغيّر رابط TikTok إلى عنصر غير تفاعلي. لم تُنقل هذه التغييرات لأنها قد تقلل وظائف `main` وليست إصلاحات توافق جوال مثبتة.
- تعديلا البحث عن القطع وفك VIN في PR #9 إعادة صياغة لمعالجة أحرف التحكم، لكن كليهما ضمن تعارض دمج فعلي. لم يُستبدل أي منهما دون اختبار تكاملي على نسخة `main`.

### PR #10

يضيف PR #10 ملفي توثيق فقط: `docs/api-v2/README.md` و`docs/api-v2/openapi.json`. لم تُكتشف تغييرات في تنفيذ API أو قاعدة البيانات، ولا توجد مسارات مضافة في PR #10 تتداخل مع ملفات `main`. بقي التصميم والعقد في PR #10 ولم يُنسخا إلى فرع المراجعة.

## ما تم حفظه وما لم يُنفذ

حُفظ هذا التقرير فقط على فرع المراجعة. لم تُعدّل ملفات التطبيق، أو API، أو قاعدة البيانات، أو إعدادات الدفع والشحن، أو الأسرار. لم تُشغّل migrations أو اختبارات مزودين فعلية.

لم تُستعد تغييرات تسجيل الدخول أو الواجهات من PR #9 لعدم وجود تغيير آمن في سلوك OTP يمكن استعادته، ولوجود تعارضات فعلية أو تغييرات تزيل ميزات موجودة. يلزم حل تعارضات الملفات السبعة عشر بمراجعة مستقلة قبل أي تسوية للكود.

## التحقق وحدوده

- نجح جلب `main` ومرجعي PR #9 وPR #10، وتأكد أن فرع المراجعة بدأ من أحدث `origin/main` وقت الفحص.
- اكتملت مقارنة الشجرتين ونتيجة الدمج الافتراضي؛ لم يُنشأ merge commit ولم تتغير ملفات العمل نتيجة الفحص.
- لم تُشغّل اختبارات تطبيق أو بناء في هذه الجولة: لا توجد تبعيات `node_modules` في worktrees الحالية. لم تُثبّت تبعيات لتجنب تغييرات غير لازمة.
- هذا التقرير يوثق اختلافات الشيفرة فقط؛ لا يثبت جاهزية النشر أو تكامل مزودي الدفع والشحن.
