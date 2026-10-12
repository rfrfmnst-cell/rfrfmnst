# API

نواة NestJS للخدمات الخلفية المشتركة. Runtime الدردشة الحالية يبقى داخل تطبيق
العميل في هذه المرحلة؛ لا تنقله دون قرار معماري واختبارات تكامل.

```bash
pnpm --filter @rafraf/shared build
pnpm --filter api dev
pnpm --filter api test
pnpm --filter api build
```

المنفذ الافتراضي `4000` ويمكن تغييره عبر `PORT`.
