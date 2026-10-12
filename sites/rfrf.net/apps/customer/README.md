# تطبيق العميل

واجهة RTL للبحث عن القطع والدردشة مع مساعد رفرف وتوثيق الجوال واستعادة
المحادثات وتتبع الطلبات.

```bash
pnpm --filter customer dev
pnpm --filter customer check-types
pnpm --filter customer lint
pnpm --filter customer build
```

- المنفذ المحلي: `3001`
- فحص الجاهزية: `GET /api/readiness`
- المعاينة البصرية متاحة في التطوير فقط عبر `/chat?preview=1`، ولا يجوز
  استخدامها كدليل على عمل المسار الإنتاجي.
- تخزين الأدلة موثق في `../../docs/operations/rfq-evidence-storage.md`.
