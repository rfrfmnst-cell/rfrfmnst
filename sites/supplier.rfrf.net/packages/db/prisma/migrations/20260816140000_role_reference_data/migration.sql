-- بيانات مرجعية للأدوار.
--
-- `users.roleId` مفتاح أجنبي إلزامي نحو `roles`، ومسار توثيق العميل يربط الدور
-- عبر `role: { connect: { name: 'CUSTOMER' } }`. على قاعدة بيانات مُهجَّرة حديثاً
-- كان جدول `roles` فارغاً، فيفشل إنشاء أول عميل بالخطأ P2025 ويتعذّر تسجيل
-- الدخول في أي بيئة جديدة (CI أو Preview أو Production).
--
-- الأدوار بيانات مرجعية لا بيانات تجريبية، لذلك مكانها الهجرة لا ملف البذور:
-- ملف البذور يُنشئ كذلك مستخدم إدارة تجريبياً ولا يصحّ تشغيله على Production.
-- العملية idempotent، فتكرارها على قاعدة مأهولة لا يغيّر شيئاً.
INSERT INTO "roles" ("id", "name", "description") VALUES
  ('role_customer', 'CUSTOMER', 'عميل رفرف'),
  ('role_supplier', 'SUPPLIER', 'مورد قطع الغيار'),
  ('role_admin', 'ADMIN', 'فريق عمليات رفرف')
ON CONFLICT ("name") DO NOTHING;
