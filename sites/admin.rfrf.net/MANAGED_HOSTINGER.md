# نسخة الإدارة المستقلة على admin.rfrf.net

حزمة مصدر مشتقة من `mubasatplatform-debug/rafraf@main` عند
`795d4d5121f73404141c0a53ead450216b30f7b7`، مقلمة بواسطة
`turbo@2.10.4 prune admin`. تضم `admin` والتبعيات المشتركة المطلوبة.
لا تمنح سلطة إصدار الإنتاج الأصلي ولا تتضمن أسراره أو اتصالاته.

## إعداد Hostinger Managed Node.js

| الحقل | القيمة |
| --- | --- |
| Domain | `admin.rfrf.net` |
| App type | `express` (خادم HTTP المولد من Next standalone) |
| Node.js | `24` |
| Package manager | `pnpm`؛ مثبت المصدر `pnpm@11.6.0` |
| Root directory | `.` |
| Build script | `build:hostinger` |
| Output directory | `.` |
| Entry file | `hostinger-runtime/bootstrap.cjs` |

يفك ZIP بحيث يكون `package.json` في الجذر. يُنفذ
`pnpm install --frozen-lockfile` ثم `pnpm run build:hostinger`؛ يجمع البناء
`admin...` بواسطة Next 16.3.8 وWebpack كي يعمل مسار SWC WASM عند
عدم توافق GLIBC على المضيف. يعوض ESM الخاص بـSWC وعميل Prisma المولد
كاملاً مع محركه، وينسخ standalone والأصول إلى
`hostinger-runtime` مع حفظ روابط pnpm النسبية. `pnpm start` يشغل ملف
الدخول نفسه. لا يجمع سكربت `build` العام مخرجات Hostinger. يعيد البناء
استخدام CLI الموروث بعد إثبات `pnpm@11.6.0`، أو يشغله صراحة بواسطة npm؛
وتستخدم مهام Turbo التابعة مشغلاً مثبتاً مؤقتاً لتجنب انجراف Corepack.
يختبر البناء تحميل محرك Prisma الملائم للمضيف وتحويل صورة مولدة في الذاكرة
بواسطة Sharp دون اتصال أو استعلام. إخفاق المكتبات الأصلية يوقف البناء؛
ZIP لا يشمل مخرجات البناء المحلية.

## البيئة والمجالات

أثناء التشغيل اضبط `NODE_ENV=production` و`HOSTNAME=0.0.0.0`، واترك
`PORT` للقيمة التي يوفرها Hostinger. اضبط
`ADMIN_PUBLIC_URL=https://admin.rfrf.net` و
`RAFRAF_RELEASE_SHA=795d4d5121f73404141c0a53ead450216b30f7b7`.
قيم البناء الافتراضية لا تُحفظ كإعدادات تشغيل.
عند احتياج وظائف مرتبطة بالعميل، اضبط
`CUSTOMER_PUBLIC_URL=https://rfrf.net`؛ وعنوان المورد
`NEXT_PUBLIC_SUPPLIER_APP_URL=https://supplier.rfrf.net`.

لا يحوي التطبيق أصلاً عاماً ثابتاً قديماً يحتاج الاستبدال. عدلنا نسخة
staging من `apps/admin/proxy.ts` كي تكون وجهة تحويل تسجيل الدخول
`ADMIN_PUBLIC_URL` صراحة عند استقلال عنوان الربط المحلي عن الأصل العام
خلف reverse proxy، وحتى مع ترويسات Host مخالفة.
بقي حظر الإدارة غير المهيأة ورد 401 دون جلسة.

## وظائف تحتاج إعداداً لاحقاً

تحتاج الإدارة `ADMIN_SESSION_SECRET` المعتمد بطول 32 حرفاً على الأقل،
وتهيئة MFA فعلية عبر `TWILIO_ACCOUNT_SID` و`VERIFY_SERVICE_SID` و
`TWILIO_API_KEY_SID` و`TWILIO_API_KEY_SECRET` المأذون بها لهذه النسخة.
الإنتاج لا يقبل OTP المحلي؛ غياب MFA يبقي صفحة الدخول 503 عمداً، بينما
يظل `/api/liveness` متاحاً. تُضبط أسرار المنصة المعتمدة خارج ZIP.

تحتاج جلسة فعلية اتصالاً معتمداً بقاعدة المنصة بمخططها ودور تشغيلها ومستخدم إدارة نشط
وصلاحياته. لا ينفذ البناء seed أو migrations أو provisioning.
قراءة الأدلة ومستندات المورد تحتاج تخزيناً خاصاً تشترك فيه الأسطح؛ مجلدات
`.data` في حزم منفصلة لا تحقق هذه المشاركة. اختر مزوداً خاصاً أو مسارات
filesystem مطلقة مشتركة ودائمة مثبتة. `STORAGE_PROVIDER=local` ممنوع
في الإنتاج، ولا يُعد نجاح الصفحة إثباتاً لتكامل التخزين أو المال أو الشحن.

لا تشغل runtime-public-web المنسوخ لأغراض توافق Docker؛ فحصه الثابت
يستخدم `/app` الخاصة بالخادم الأصلي، ولا يمثل وظيفة إدارة مطلوبة هنا.

## ما أثبته الفحص المحلي

نجح بناء Webpack مع إجبار SWC WASM محلياً، وتحميل Prisma الأصلي دون
اتصال وتشغيل Sharp، ثم boot وliveness
200 بهوية المصدر. مع بيانات MFA عشوائية ذات شكل صحيح في الذاكرة فقط،
نجح GET صفحة الدخول والأصل الثابت 200، وتحويل الجذر إلى
`https://admin.rfrf.net/login` برمز 307 مع تجاهل Host وforwarded-host
اختباريين مخالفين. دون MFA رُفض الجذر والدخول 503؛ وطلب محمي دون جلسة
رد 401. كانت ملفات المصدر `node_modules` و`.next` مخفية أثناء التشغيل؛
كل روابط runtime الـ181 نسبية وداخل مجلده. أزيل علم اختبار WASM قبل
تغليف المصدر؛ يختار Next على المضيف مترجمه المتاح تلقائياً.

لم تُرسل بيانات تسجيل دخول أو طلب Twilio، ولم تتصل قاعدة أو مزودون،
ولم يحدث عمل مالي أو فحص readiness المحمي أو رفع أو نشر.

## Fixed post-listen managed storage probe (CJS variant)

`hostinger-runtime/bootstrap.cjs` immediately synchronously requires the
original `./apps/admin/server.js`, including under a hosting require-loader.
It then schedules a fixed deferred observer of active `node:http.Server`
handles with `listening===true`, bounded to five seconds with unref timers.
Only after a listener is observed does it import the fixed reporter/diagnostic
and run the synthetic private storage probe. No prototype is patched, network
probe or public endpoint added, handle metadata logged, or original server
changed. Timeouts/observer/import/diagnostic/reporting failures produce only
sanitized fixed codes and do not block the already-started application.

The log envelope has exactly `timestamp`, `level`, `message`; its message has
a fixed `admin` surface and only allowlisted status/UID/private-root modes,
access booleans, synthetic canary hash/existence and device/inode identities.
Fixed home is `/home/u374306905`; roots are its
`.rafraf-storage/rfq-evidence` and `.rafraf-storage/supplier-documents`.
The runtime UID must own the home and `0700` private directories; the fixed
`0600` canary contains a synthetic marker plus 32 random bytes. Repeat runs
read only this known canary; unexpected metadata/content is rejected without
chmod or overwrite. No uploaded user file is read or enumerated, and no
CLI/environment storage path/surface/diagnostic option is accepted.

The build retains the original native Prisma/Sharp checks before copying
the four helper modules into the isolated runtime. Existing Admin MFA/auth
guards remain effective; no credentials, DB connection or provider request
is introduced. Local tests inject synthetic in-memory diagnostics and let
the actual original Next server listen before reporting. Hosted filesystem
sharing and persistence still require real runtime/redeploy proof. The
internal Node handle observer can fail safely with a bounded timeout if a
platform hides its listening server; that timeout is not storage acceptance.
Base Admin source ZIP/manifest/stage are preserved by this new local variant.


هذه الحزمة أُعيد تغليفها من main المدمج بعد إثبات تطابق المدخلات مع البناء المجرب. لم يرفعها أو ينشرها وكيل الحزم.

Final source provenance: fresh `turbo@2.10.4 prune` from merged `main@795d4d5121f73404141c0a53ead450216b30f7b7` has byte-identical pruned inputs to the locally built candidate `926429eb97ce1203e7fe6e83ae84198943d79af1`. The existing compiled outputs are reused only for isolated local runtime identity/fence checks; the ZIP contains source and Hostinger will build it. Runtime release identity comes from RAFRAF_RELEASE_SHA, not a baked commit literal. The archive and overlays are separately hashed in the adjacent manifest. No provider calls or upload/deployment were performed by the bundle task.
