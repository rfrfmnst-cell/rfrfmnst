# بوابة المورد المستقلة على supplier.rfrf.net

حزمة مصدر معزولة مشتقة من `mubasatplatform-debug/rafraf`، فرع `main`،
بالنسخة `795d4d5121f73404141c0a53ead450216b30f7b7`. تضم تطبيق `supplier`
وتبعياته المشتركة بعد `turbo@2.10.4 prune supplier` لتشغيل بوابة المورد
للمنصة نفسها على النطاق الجديد. المقصود عزل حزمة المصدر، وليس إنشاء منصة
أو قاعدة جديدة. لا تمثل هذه الحزمة
إصدار الإنتاج الأصلي أو قبولاً تجارياً أو جاهزية الخدمات المتصلة.

## إعداد Hostinger Managed Node.js

| الحقل | القيمة |
| --- | --- |
| Domain | `supplier.rfrf.net` |
| App type | `express`؛ خادم HTTP المولد من Next standalone |
| Node.js | `24` |
| Package manager | `pnpm`؛ مثبت المصدر `pnpm@11.6.0` |
| Root directory | `.` |
| Build script | `build:hostinger` |
| Output directory | `.` |
| Entry file | `hostinger-runtime/bootstrap.cjs` |

يفك ZIP بحيث يكون `package.json` في جذر المشروع. يُنفذ
`pnpm install --frozen-lockfile` ثم `pnpm run build:hostinger`؛ يبني السكربت
`supplier...` عبر `next build --webpack` ويكمل ملفات SWC وPrisma
المتتبعة ويجمع الخادم وstatic وpublic في
`hostinger-runtime` بروابط pnpm نسبية. يشغل `pnpm start` bootstrap بصيغة CommonJS؛ يبدأ خادم المورد الأصلي
بواسطة require متزامن، ثم يجدول التشخيص بعد بدء الاستماع.
السكريبت العام `build` لا يجمع مخرجات Hostinger. يتحقق `pinned-pnpm.mjs` من
CLI الذي ورثه البناء عند وجوده، ويستخدم إصدار pnpm 11.6.0 نفسه؛ وإلا
يشغّل `npm exec --package=pnpm@11.6.0` ويتحقق من النسخة قبل البناء.
ينشئ أيضاً shim مؤقتاً داخل `.hostinger-tools` كي تبقى عمليات pnpm
التي يشغلها Turbo على النسخة نفسها. يستبعد ZIP هذه الملفات المؤقتة.
لا يعتمد على اختيار pnpm العام أو Corepack داخل العملية الفرعية.

تولد Prisma client ومكتباته الأصلية على المضيف أثناء التثبيت، وتولد مكتبات
البناء المشتركة أثناء البناء. لا يتضمن ZIP تبعيات مثبتة أو `.next` أو
runtime جاهزاً أو مخرجات بناء محلية أو ملفات بيئة أو تاريخ Git. لا ينفذ
البناء migration أو provisioning أو اتصالاً بقاعدة أو مزود. بعد الجمع
يفحص `verify-native-runtime.mjs` تحميل محرك Prisma الموافق لمنصة المضيف
وتحويل PNG بمقاس 1×1 بواسطة Sharp، دون إنشاء Prisma client أو طلب خارجي؛
يفشل البناء إذا عجزت مكتبات runtime الأصلية عن العمل على المضيف.

## البيئة العامة والخدمات

أثناء البناء والتشغيل:
`NEXT_PUBLIC_SUPPLIER_APP_URL=https://supplier.rfrf.net`؛ يستخدم سكربت البناء
هذا الأصل كافتراضي لأنه يُثبت داخل قيم Next العامة. يمرر أيضاً
`NEXT_PUBLIC_API_URL=https://api.rfrf.net`؛ لا يعتمد تطبيق المورد الحالي
على API المنفصل. تغيير الأصل العام يحتاج إعادة البناء.

أثناء التشغيل: `NODE_ENV=production`، `HOSTNAME=0.0.0.0`،
`RAFRAF_RELEASE_SHA=795d4d5121f73404141c0a53ead450216b30f7b7`، و`SESSION_SECRET`
بطول 32 حرفاً على الأقل من إعدادات تشغيل المنصة المعتمدة. يحدد Hostinger متغير `PORT`؛ لا تثبت منفذاً
مختلفاً. يجب تمرير Host وX-Forwarded-Host الصحيحين لحماية Server Actions.

لتسجيل المورد والتحقق الفعلي يلزم ضبط اتصال قاعدة المنصة المعتمدة ودور تشغيلها،
ومزود بريد Resend مع عنوان `SUPPLIER_EMAIL_FROM` موثق، وTurnstile مضبوط على
`supplier.rfrf.net`، ومزود OTP للجوال عند استخدامه. يلزم تخزين وثائق خاص
وفق المزود المختار. تضبط اتصالات قاعدة المنصة ومزوديها والأسرار المعتمدة
خارج ZIP في إعدادات المضيف؛ لا تتضمن الحزمة قيم الاعتماد ولا تتصل بها
أثناء هذا التحقق المحلي. لا تكفي صفحة
الدخول ذات HTTP 200 لإثبات نجاح البريد أو الجوال أو صلاحية الحساب.

التخزين `local` لا يصلح للإنتاج؛ استخدم مزوداً خاصاً أو filesystem دائماً
ومثبتاً عندما تسمح إعدادات الميزة بذلك. تبقى بوابات اعتماد المورد والملكية
والجلسة وأصل الطلب والمال والتكاملات قائمة. لا تفعّل ميزات مؤجلة أو أعلام
قبول تجاري بمجرد نجاح هذه الحزمة.

## اختلافات المصدر والتحقق المحلي

لا يحتاج مصدر المورد إلى تغيير عنوان HTTP ثابت: يستخدم أصل المورد العام
في روابط البريد وعودة التحقق وlogout وحراس الطلبات. ثبت فعلياً أن proxy
الأصلي يعيد `/login` نسبياً عند طلب HTML غير مخول وراء Host وforwarded host
للنطاق الجديد؛ حُفظ مصدر proxy الأصلي. أضيف سكربت الجمع و`start` ودعم
config وsetup-git-automation ومساعدات runtime، وثبتت بيئة Node.js على 24.
اختير Webpack لدعم fallback SWC WASM على المضيف مع إبقاء Next 16.3.8
وpnpm 11.6.0. نُقلت قاعدتا الطباعة العامتان لـsidebar وmain من CSS module
إلى `label-print.css` المستورد من صفحة بوليصة الشحن؛ ظلت المحددات والقيم
نفسها، وصارت قواعد CSS module مقبولة لدى Webpack. لا توجد تغييرات لمنطق
الجلسة أو المورد أو الطلبات. يُجمع Prisma client ومخططه ومحركاته في
مسارات pnpm نفسها لأن تتبع Webpack قد يحذفها عند دمج JavaScript الخاص به.

المساعدتان `runtime-public-web.mjs` و`runtime-qa-identity.mjs` من المصدر
الأصلي محفوظتان للاتساق فقط؛ فحص public-web خاص بالعميل ومسارات `/app`
في نشر Docker الأصلي. لا ينفذ جمع المورد هذه الفحوص ولا ينشئ هوية QA.

في تحقق الحزمة الأساسية المحفوظة، نجح التثبيت المجمد وبناء Webpack الإنتاجي
بأربع مهام مع فرض SWC WASM
محلياً وحجب تحميل SWC الأصلي. أكد `loadBindings().isWasm=true` الاختبار؛
استُخدم `NEXT_TEST_WASM` في تحقق مؤقت فقط ثم حُذف من إعداد Turbo النهائي.
نجح فحص Prisma/Sharp المدمج في البناء، وتشغيل standalone وliveness
بهوية المصدر. ردت صفحات الدخول والتسجيل ودخول الجوال وfavicon وJS وCSS
بـ200. حُفظت ترويسات الحماية الست وnoindex، ورُفض الطلب غير HTML بلا جلسة
بـ401 وأصل logout المخالف بـ403؛ أعاد الأصل الصحيح 303 إلى النطاق الجديد،
ورابط تحقق البريد غير الصالح 302 إلى صفحة الخطأ بلا استعلام قاعدة.

أعيد تشغيل runtime مع إخفاء node_modules و`.next` والمكتبات المشتركة
المبنية وpublic الأصلية؛ تحققت روابطه الـ178 نسبية وداخلية وصالحة.
نجح تحميل Prisma 6.19.3 ومحركه Debian OpenSSL 3 وتحويل PNG بواسطة Sharp
0.35.5، أيضاً مع إخفاء ملفات المصدر، دون فتح اتصال قاعدة. استُخدمت أسرار
محلية عشوائية في ذاكرة العملية وعنوان قاعدة تجريبي `127.0.0.1:1` فقط.

لم يفحص readiness المحمي أو تسجيل حقيقي أو رحلة بريد/OTP/وثائق أو
قبول تجاري أو صفحة بوليصة مصرح بها على قاعدة فعلية. لا رفع أو نشر أو
اتصال بمزود أو قاعدة أو تغيير للإنتاج.


## نسخة تشخيص التخزين الثابت بعد بدء الاستماع

هذه نسخة مصدر إضافية مستقلة عن حزمة المورد الأساسية المحفوظة. يجمع البناء
التشخيص وscheduler وreporter و`bootstrap.cjs` داخل `hostinger-runtime`.
يبدأ bootstrap خادم `apps/supplier/server.js` الأصلي بواسطة require متزامن
في المستوى الأعلى، حتى عندما يستدعيه loader المضيف بواسطة require؛ لا
يشترط تشغيله من CLI. لا يقرأ التشخيص أي filesystem قبل بدء التطبيق.
يراقب scheduler خادم HTTP فعلياً بدأ الاستماع، بانتظار محدود بخمس ثوانٍ
ومؤقتات unref، ثم يشغل التشخيص بصورة غير متزامنة تحت UID التطبيق.

يسجل سطر JSON بمفاتيح `timestamp` و`level` و`message`؛ يحتوي message فقط
الحدث وسطح `supplier` الثابت ورمز الحالة وUID والأوضاع والصلاحيات
وبصمة canary الاصطناعي ومعرفات الجهاز/inode. يحذف الحقول غير المعتمدة
ويختزل الأخطاء إلى رموز ثابتة. فشل التشخيص أو تحميل reporter أو المراقبة
لا يوقف التطبيق الذي بدأ بالفعل. تبقى صفحات ومسارات المورد وقواعد
الجلسة كما في الحزمة الأساسية.

التشخيص مقيد بالمنزل `/home/u374306905` ومساري
`/home/u374306905/.rafraf-storage/rfq-evidence` و
`/home/u374306905/.rafraf-storage/supplier-documents`. يتطلب ملكية UID
المعتمد وأوضاع المجلدات الخاصة `0700` وcanary خاصاً `0600`؛ ينشئ الملفات
الاصطناعية الناقصة فقط، ويرفض الروابط أو الأوضاع أو الملكية غير المتوقعة.
لا يقرأ ملفات المستخدم ولا يسرد التخزين، ولا يقبل اختيار المسارات من CLI
أو البيئة، ولا يضيف endpoint عامّاً أو اتصال قاعدة أو مزود.

نجح بناء النسخة محلياً عبر pnpm 11.6.0 وWebpack بأربع مهام، وفحص تحميل
محرك Prisma الموافق للمنصة وتحويل Sharp بمقاس 1×1 دون طلب قاعدة أو مزود.
تستخدم اختبارات التشخيص وreporter وscheduler بدائل في الذاكرة فقط؛
ويستخدم تشغيل runtime المحلي تشخيص نجاح وفشل محاكاً بعد بدء خادم المورد
الأصلي، مع إخفاء تبعيات المصدر ومخرجاته. لا ينفذ التشخيص الحقيقي على
مسارات `/home` المحلية ولا يدعي اشتراك التخزين أو استمراره على Hostinger.
يلزم قياس تحت UID كل تطبيق على المضيف ثم إعادة نشر مضبوطة لإثبات
المشاركة والاستمرار بين الأسطح الأربعة.


هذه الحزمة أُعيد تغليفها من main المدمج بعد إثبات تطابق المدخلات مع البناء المجرب. لم يرفعها أو ينشرها وكيل الحزم.

Final source provenance: fresh `turbo@2.10.4 prune` from merged `main@795d4d5121f73404141c0a53ead450216b30f7b7` has byte-identical pruned inputs to the locally built candidate `926429eb97ce1203e7fe6e83ae84198943d79af1`. The existing compiled outputs are reused only for isolated local runtime identity/fence checks; the ZIP contains source and Hostinger will build it. Runtime release identity comes from RAFRAF_RELEASE_SHA, not a baked commit literal. The archive and overlays are separately hashed in the adjacent manifest. No provider calls or upload/deployment were performed by the bundle task.
