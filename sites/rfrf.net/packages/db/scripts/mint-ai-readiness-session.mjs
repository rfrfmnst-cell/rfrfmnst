/**
 * يطبع قيمة `AI_READINESS_SMOKE_SESSION` — كوكي `cu_auth` خام لعميل صناعي
 * مخصص لفحص جاهزية الذكاء الاصطناعي داخل workflow الـPreview.
 *
 * لماذا سكربت بدل تركيب القيمة يدوياً: التوقيع HMAC-SHA256 فوق مجال مفصول
 * (`rafraf-customer-session:`) بمدة ثلاثين يوماً بالضبط، و`verifySession` ترفض
 * أي انحراف في الصيغة أو المدة. القيمة المركّبة يدوياً تفشل بـ401 داخل
 * الـworkflow بعد بناء ثلاثة تطبيقات، وهو أغلى موضع لاكتشاف الخطأ.
 *
 * ولا يكفي توقيع سليم: `getSessionCustomerId` تقرأ العميل من قاعدة البيانات
 * وتتحقق من `user.isActive`، فجلسة موقّعة لعميل غير موجود مرفوضة. لذلك يتحقق
 * السكربت من وجود العميل ولا ينشئه إلا بطلب صريح عبر `--create`.
 *
 * يُشغَّل على بيئة Preview وحدها، بـ`SESSION_SECRET` الخاص بها:
 *   DATABASE_URL=… SESSION_SECRET=… pnpm --filter @rafraf/db run session:mint -- --create
 *
 * المخرج على stdout سرّ يُنسخ إلى GitHub → Environments → preview → Secrets،
 * ولا يُحفظ في ملف ولا في سجل الأوامر. ينتهي بعد ثلاثين يوماً ويُدوَّر قبلها.
 */
import { createHmac } from 'node:crypto';
import { PrismaClient } from '@prisma/client';

const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const MIN_SECRET_LENGTH = 32;
const SMOKE_PHONE = '+966500000001';
const SMOKE_NAME = 'فحص جاهزية تقني';

const secret = process.env.SESSION_SECRET?.trim() ?? '';
if (secret.length < MIN_SECRET_LENGTH) {
  throw new Error(
    `SESSION_SECRET must be at least ${MIN_SECRET_LENGTH} characters, and must belong to the environment being probed`,
  );
}
if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required');
}

const create = process.argv.includes('--create');
const prisma = new PrismaClient();
try {
  let customer = await prisma.customer.findFirst({
    where: { user: { phone: SMOKE_PHONE } },
    select: { id: true, user: { select: { isActive: true } } },
  });

  if (!customer) {
    if (!create) {
      throw new Error(
        `No synthetic customer for ${SMOKE_PHONE} in this database. Re-run with --create to provision one.`,
      );
    }
    const role = await prisma.role.findUnique({ where: { name: 'CUSTOMER' } });
    if (!role) {
      throw new Error('The CUSTOMER role is missing; run the seed first');
    }
    const user = await prisma.user.create({
      data: { phone: SMOKE_PHONE, fullName: SMOKE_NAME, roleId: role.id },
      select: { id: true },
    });
    customer = await prisma.customer.create({
      data: { userId: user.id, fullName: SMOKE_NAME },
      select: { id: true, user: { select: { isActive: true } } },
    });
    console.error(`Provisioned synthetic customer ${customer.id}`);
  }

  // تعطيل الحساب يبطل الجلسة عند القراءة، فالفشل كان سيقع بعد البناء لا قبله.
  if (!customer.user.isActive) {
    throw new Error(
      `Synthetic customer ${customer.id} is disabled; re-enable it before minting`,
    );
  }

  const issuedAt = Math.floor(Date.now() / 1000);
  const expiresAt = issuedAt + SESSION_TTL_SECONDS;
  const payload = `${customer.id}.${issuedAt}.${expiresAt}`;
  const signature = createHmac('sha256', secret)
    .update(`rafraf-customer-session:${payload}`)
    .digest('hex');

  console.error(
    `Expires ${new Date(expiresAt * 1000).toISOString()} — rotate before then`,
  );
  console.log(`v3.${payload}.${signature}`);
} finally {
  await prisma.$disconnect();
}
