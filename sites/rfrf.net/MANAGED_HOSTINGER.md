# نسخة العميل المستقلة على rfrf.net

هذه حزمة مصدر معزولة مشتقة من `mubasatplatform-debug/rafraf`، فرع `main`،
بالنسخة `795d4d5121f73404141c0a53ead450216b30f7b7`. تضم تطبيق `customer`
وتبعياته المشتركة فقط بعد `turbo@2.10.4 prune customer`.
ليست إصدار الإنتاج الأصلي أو دليلاً على قبول تجاري أو جاهزية الخدمات.

## إعداد Hostinger Managed Node.js

| الحقل | القيمة |
| --- | --- |
| Domain | `rfrf.net` |
| App type | `express` (خادم HTTP المولد من Next standalone) |
| Node.js | `24` |
| Package manager | `pnpm`؛ مثبت المصدر `pnpm@11.6.0` |
| Root directory | `.` |
| Build script | `build` (أو `build:hostinger`) |
| Output directory | `.` |
| Entry file | `hostinger-runtime/bootstrap.cjs` |

يفك ZIP بحيث يكون `package.json` في جذر المشروع.
يُنفّذ التثبيت `pnpm install --frozen-lockfile`، ثم
`pnpm run build:hostinger`. يبني السكربت `customer...`، يعوّض ملفات SWC
الناقصة من التتبع، ويجمع الخادم والأصول في `hostinger-runtime` مع روابط
pnpm نسبية. أمر `pnpm start` يشغّل نفس ملف الدخول مباشرة.
أصبح `pnpm run build` يجمع مخرجات Hostinger نفسها، حتى عند تثبيت أمر البناء
في اللوحة وعدم إمكانية تعديله. يعيد البناء استخدام CLI
الموروث بعد إثبات `pnpm@11.6.0`، أو يشغله صراحة بواسطة npm؛ وتستخدم مهام
Turbo التابعة مشغلاً مثبتاً مؤقتاً أيضاً، لتجنب انجراف Corepack.
يستخدم تطبيق العميل `next build --webpack` حتى يعمل عند انتقال SWC إلى
WASM على المضيف الذي لا يحقق متطلبات GLIBC للربط الأصلي. بقي Next16.3.8
دون تخفيض. يجمع البناء عميل Prisma الكامل والمخطط والمحركات في مسارات
pnpm نفسها إذا أغفلها تتبع Webpack، ويفحص تحميل المحرك الأصلي وتشغيل Sharp
في الذاكرة قبل إعلان نجاح الجمع، دون عميل قاعدة أو طلب خارجي.

تُعاد ترجمة المكتبات الأصلية على المضيف. لا تتضمن الحزمة `node_modules`
أو `.next` أو مخرجات بناء محلية أو بيئة خاصة أو تاريخ Git.

## البيئة العامة

أثناء البناء: `NEXT_PUBLIC_SUPPLIER_APP_URL=https://supplier.rfrf.net`؛
يستخدم السكربت هذه القيمة كافتراضي. يُمرر
`NEXT_PUBLIC_API_URL=https://api.rfrf.net` أيضاً؛ لا يعتمد تطبيق العميل الحالي
على API المنفصل. `RAFRAF_HERO_VIDEO_SRC` اختياري ويُقرأ أثناء البناء.

أثناء التشغيل: `NODE_ENV=production`، `HOSTNAME=0.0.0.0`،
`CUSTOMER_PUBLIC_URL=https://rfrf.net`، و
`RAFRAF_RELEASE_SHA=795d4d5121f73404141c0a53ead450216b30f7b7`.
يحدد Hostinger متغير `PORT`؛ لا تثبّت منفذاً مختلفاً.
هذه القيم العامة لا توصل قواعد أو مزودين.

للتسجيل والدردشة الفعلية يلزم اتصال معتمد بقاعدة المنصة ومخططها ودور تشغيلها،
و`SESSION_SECRET` المعتمد للمنصة بطول 32 حرفاً على الأقل، ثم مزودي البريد/OTP/AI
والتخزين الخاص بحسب الميزات المختارة. تُدار أسرار المنصة خارج ZIP. عند
استخدام حسابات قاعدة المنصة القائمة حافظ على سر الجلسة المعتمد؛ يدخل أيضاً
في تحقق كلمات المرور، ولا يمثل إضافة نطاق طلباً لتدوير هذا السر.
التخزين `local` ممنوع في الإنتاج؛ استخدم مزوداً خاصاً أو مسار filesystem
دائماً ومثبتاً. لا تنفذ migrations أو provisioning ضمن عملية البناء هذه.

يبقى الدفع مؤجلاً إذا ضبطت `PAYMENT_MODE=disabled` و
`PAYMENT_LAUNCH_REQUIRED=false`؛ لا تمثل هذه القيم قبولاً تجارياً.

## اختلافات المصدر المقصودة

- عنوان SEO وrobots وsitemap: `https://rfrf.net`.
- رابط تسجيل المورد الافتراضي: `https://supplier.rfrf.net/?register=1`.
- أساس تحقق مسارات عودة الدخول: `https://rfrf.net`.
- يحظر قارئ الويب `rfrf.net` وكل نطاقاته الفرعية مع إبقاء حظر النطاق الأصلي.
- أضيف سكربت جمع Hostinger و`start` وثبت Node.js على الإصدار 24.

دليل runtime-public-web المنسوخ من Docker يتحقق من الملفات أثناء جمع
الحزمة. فحصه التشغيلي الثابت يعتمد مسارات `/app` الخاصة بالخادم الأصلي؛
لا يُنفّذ هنا ولا تُستنتج منه موافقة إصدار الإنتاج.

التحقق المحلي أثبت بناء الإنتاج وتشغيل standalone وHTTP 200 للرئيسية
والدخول وrobots وsitemap وأصل ثابت، وliveness بهوية المصدر؛ وكذلك تحميل
محرك Prisma وعمل Sharp دون اتصال قاعدة. نُفّذ تشغيل ثانٍ مع إخفاء
`node_modules` و`.next` الأصليين، وتحققت روابط runtime الـ113 داخل مجلده.
نجح البناء النهائي المتكامل مع فرض SWC WASM للاختبار فقط؛ أزيل علم الاختبار
قبل ZIP. أثبت طلب `/api/chat/threads` دون جلسة رد 401 دون اتصال قاعدة.
لم يُفحص readiness المحمي أو تسجيل حقيقي أو دردشة بمزود، ولم يُنشر الموقع.

## متغير فحص مشاركة التخزين عند بدء التطبيق

هذه حزمة مستقلة فوق المصدر الأساسي، لا تستبدل ZIP الأساسي أو إعداداته تلقائياً.
ملف الدخول CommonJS `hostinger-runtime/bootstrap.cjs` يشغل خادم العميل
الأصلي `apps/customer/server.js` فوراً بواسطة require متزامن، حتى حين
يحمله مشغل Hostinger من وحدة أخرى. بعد بدء استماع خادم HTTP فقط،
ينفذ الفحص الثابت المعتمد بصورة غير متزامنة دون حجب التشغيل. و`pnpm start` يشغل
bootstrap نفسه. لا توجد نقطة HTTP جديدة أو قيمة بيئة تختار مسار الفحص.

الفحص يعمل بهوية عملية التطبيق على `/home/u374306905/.rafraf-storage` فقط،
ويتحقق من الملكية والمسارات والأوضاع الخاصة قبل إنشاء مجلدي
`rfq-evidence` و`supplier-documents` بأوضاع 0700 وملف canary اصطناعي
ثابت بأوضاع 0600. لا يعدل ملف canary موجوداً ولا يعدد ملفات المستخدمين.
السجل يعرض رموزاً ومعرف العملية والأوضاع والصلاحيات ومعرفات filesystem
وبصمة canary الاصطناعي فقط. لا يعدل مراقب الاستماع ترويسات HTTP أو prototypes ولا يرسل طلب شبكة،
ومهلته ثابتة بخمس ثوان. كل خطأ يتحول إلى رمز معقم ويستمر التطبيق؛ نجاح الصفحة ليس إثباتاً لمشاركة التخزين.

أثبتت الاختبارات المحلية سلوك bootstrap مع تشخيص اصطناعي ناجح وفاشل
وتشغيل خادم Next المعزول؛ لم ينفذ الفحص الفعلي للمجلد الخاص محلياً.
يلزم تطابق canary على التطبيقات الفعلية وفحص متكرر بعد إعادة النشر قبل
قبول المشاركة والاستمرارية. لا تتضمن الحزمة نقل ملفات أو تغيير مزود تخزين.


هذه الحزمة أُعيد تغليفها من main المدمج بعد إثبات تطابق المدخلات مع البناء المجرب. لم يرفعها أو ينشرها وكيل الحزم.

Final source provenance: fresh `turbo@2.10.4 prune` from merged `main@795d4d5121f73404141c0a53ead450216b30f7b7` has byte-identical pruned inputs to the locally built candidate `926429eb97ce1203e7fe6e83ae84198943d79af1`. The existing compiled outputs are reused only for isolated local runtime identity/fence checks; the ZIP contains source and Hostinger will build it. Runtime release identity comes from RAFRAF_RELEASE_SHA, not a baked commit literal. The archive and overlays are separately hashed in the adjacent manifest. No provider calls or upload/deployment were performed by the bundle task.
