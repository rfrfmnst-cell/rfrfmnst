# لوحة العمليات

واجهة فريق رفرف لمراجعة RFQ والتوافق والمخاطر والعروض والطلبات والأدلة الخاصة.

```bash
pnpm --filter admin dev
pnpm --filter admin check-types
pnpm --filter admin lint
pnpm --filter admin build
```

- المنفذ المحلي: `3003`
- فحص الجاهزية: `GET /api/readiness`
- صور الأدلة لا تُعرض من مفتاح Storage مباشرة؛ تمر عبر مسار موثّق ورابط
  موقّع قصير العمر.
