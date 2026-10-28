# Isolated Rafraf API on Hostinger managed Node

This source bundle comes from `mubasatplatform-debug/rafraf@main`, source SHA
`795d4d5121f73404141c0a53ead450216b30f7b7`. It is a staging adaptation for the
owner-authorized deployment at `api.rfrf.net`. Canonical Git is untouched.

## Hostinger configuration

- App type: `express` (Nest uses the Express adapter).
- Node: `24`; package manager: `pnpm`, pinned to `11.6.0` by package.json.
- Root and output directory: `.`.
- Build script: `build` (or the equivalent `build:hostinger`).
- Entry file: `hostinger-runtime/bootstrap.cjs`.
- Start command: `node hostinger-runtime/bootstrap.cjs`.

Hostinger injects `PORT`; do not hard-code a public service port.
Set `NODE_ENV=production`,
`RAFRAF_RELEASE_SHA=795d4d5121f73404141c0a53ead450216b30f7b7`,
`API_DOCS_ENABLED=false`, and
`API_ALLOWED_ORIGINS=https://rfrf.net,https://supplier.rfrf.net,https://admin.rfrf.net`.
The staged CORS fallback also uses those three client origins.

After a frozen pnpm install, `build:hostinger` compiles the API and builds a
production-only runtime with `pnpm deploy --legacy --prod`. The runtime is
independent from the source node_modules. It includes the pg driver for the optional, protected database readiness probe; ordinary startup opens no database connection.
The default `pnpm run build` now invokes the same runtime packager, including
when the build command in hPanel cannot be edited.

## Scope and limits

`/` (Hello World) and `/api/liveness` remain credential-free. The additive `/api/readiness` endpoint requires server probe authorization and a separately configured read-only database connection; see `API_DATABASE_READINESS.md`.
Swagger is closed in production unless `API_DOCS_ENABLED=true` is explicitly
selected. Its OpenAPI document describes these health endpoints; tags and the
Bearer scheme do not implement marketplace endpoints or authentication.
The business routes remain in Customer, Supplier and Admin Next.js BFFs.

This bundle needs no database, Redis, AI, payment or provider credentials to
serve its current controller routes. No such credentials are included.
Liveness proves process availability and reports a source SHA. It does not
attest commercial readiness, customer journeys, backups, source approval or
canonical production release authority. The separately saved manifest records
the staging patch and archive hash; the reported source SHA is the upstream
base, not a claim that the staged tree is identical to canonical Git.

The ZIP is source-only; node_modules, compiled dist, hostinger-runtime, caches,
environment files and local smoke logs are excluded. It must be rebuilt by the
Hostinger managed Node service.

## Fixed post-listen managed storage probe (CJS variant)

During normal startup, `hostinger-runtime/bootstrap.cjs` synchronously requires
the existing `./dist/main.js` immediately, including when Hostinger requires
the entry from its loader. No synthetic diagnostic operation precedes startup.
The explicit temporary private seed/verify modes described below run their
bounded filesystem check first and fail closed on errors.
An inert fixed scheduler then observes active `node:http.Server` handles until
one is listening, using deferred unref timers bounded to five seconds. It
does not patch prototypes, instrument application code, open a network socket,
or expose handle metadata. Only after that observation does it import the
fixed reporter/diagnostic and run the synthetic storage probe. Timeout or
observer/import/reporting failure produces a fixed sanitized code; diagnostic
failures cannot delay the initial listen or crash the running application.

The reporter logs one JSON envelope containing only `timestamp`, `level` and
`message`. Its message contains a fixed event/surface `api` and allowlisted
code/UID/private directory modes/access booleans/synthetic canary hash and
device-inode metadata. Fixed home: `/home/u374306905`; private storage roots:
`.rafraf-storage/rfq-evidence` and `.rafraf-storage/supplier-documents`.
The actual runtime UID must own that home and private `0700` directories. Only
a fixed `0600` synthetic canary with a marker and 32 random bytes is created;
repeated runs read it without changing it. No uploads are read or enumerated,
no caller/env paths or diagnostic flags are accepted, and no endpoint is added.

This separate artifact preserves the original API ZIP/manifest and the earlier
ESM probe archive/manifest. Its local tests use synthetic in-memory diagnostics
and post-listen observation; they do not prove actual managed filesystem access
or persistence. `process._getActiveHandles()` is a Node internal observer; a
platform that hides its listening handle yields a bounded timeout, not storage
acceptance. Hosted runtime logs plus public liveness and cross-app/redeploy
proof remain necessary. No local test runs the fixed-host diagnostic against
the real `/home` or reads user data.


هذه الحزمة أُعيد تغليفها من main المدمج بعد إثبات تطابق المدخلات مع البناء المجرب. لم يرفعها أو ينشرها وكيل الحزم.

## نقل خاص محدود عبر بيئة API المؤقتة

يحذف bootstrap قيمة `RAFRAF_CLIENT_STORAGE_SEED` من بيئة العملية قبل
تحميل أي وحدة تطبيق. إذا كانت موجودة، يتحقق من JSON بإصدار 1 وصفيفي
`evidence` و`supplier_documents` فقط. كل عنصر يحوي key/base64/size/sha256؛
حد JSON هو 49152 بايت، والمحتوى الخام 32768 بايت، و128 ملفاً إجمالاً.
المسارات ثابتة داخل `/home/u374306905/.rafraf-storage`، والمفاتيح تقبل
صيغة التخزين الأصلية فقط. لا تحفظ الحزمة أو الاختبارات بيانات المستخدمين.

يستورد الملفات بأوضاع 0600 داخل مجلدات 0700، ويرفض الروابط والملكية
غير المتوقعة أو اختلاف المحتوى. يعيد التنفيذ فقط عند تطابق البايتات والبصمات،
ولا يستبدل ملفاً موجوداً. خطأ الاستيراد يوقف API قبل البدء برمز معقم فقط.
يحتفظ على المضيف بسجل خاص `.client-storage-seed-manifest.json` بلا base64.
هذا السجل غير قابل للاستبدال عند اختلاف مجموعة المصدر؛ اختلاف البذرة
النهائية بعد إيقاف الكتابة يتطلب مراجعة وتسوية صريحة.

بعد حذف البذرة من إعداد Hostinger، يتحقق bootstrap من الملفات والسجل
عند `RAFRAF_CLIENT_STORAGE_VERIFY=true` فقط. يعرض عدداً وحجم بايتات
وبصمة مجمعة مع verified=true، دون مفاتيح أو بصمات منفردة. البصمة متوافقة
مع cutover: records مرتبة حسب store/key، مع مفاتيح JSON ASCII المرتبة
bytes/key/sha256/store، وJSON مضغوط، و`sha256-v1:` ثم SHA256.
احذف علم VERIFY بعد القبول؛ التشغيل الطبيعي لا يقرأ سجل الترحيل، كيلا
يتسبب حذف مشروع لملف قديم لاحقاً في تعطيل API. التشخيص الاصطناعي
اللاحق للاستماع يبقى غير حاجب للتطبيق كما كان.

شهادة البدء الواحدة تستخدم event=`rafraf.client_storage_seed_verified` مع
files/bytes/manifest_sha256/verified فقط، إضافة إلى release_sha كامل صالح من
RAFRAF_RELEASE_SHA وuid الفعلي الموجب. ظرف السجل هو timestamp حديث بصيغة ISO
وlevel=info وmessage نص JSON. هوية الإصدار أو UID غير الصالح توقف وضع
الترحيل قبل قراءة التخزين. لا يطبع السجل قيمة البذرة أو مفاتيح الملفات أو
بصمات منفردة. ربط شهادة الإطلاق يتطلب إصداراً وUID متوقعين ووقتاً بعد آخر
restart؛ تجميع السجلات الرسمي وظيفة منسق النشر ولا يضيف HTTP endpoint.

Final source provenance: fresh `turbo@2.10.4 prune` from merged `main@795d4d5121f73404141c0a53ead450216b30f7b7` has byte-identical pruned inputs to the locally built candidate `926429eb97ce1203e7fe6e83ae84198943d79af1`. The existing compiled outputs are reused only for isolated local runtime identity/fence checks; the ZIP contains source and Hostinger will build it. Runtime release identity comes from RAFRAF_RELEASE_SHA, not a baked commit literal. The archive and overlays are separately hashed in the adjacent manifest. No provider calls or upload/deployment were performed by the bundle task.
