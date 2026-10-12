// RFC 2606 reserved identity: never send email, SMS, or verification messages.
export const QA_NAME = 'فحص جاهزية تقني';
const QA_EMAIL = 'rafraf-runtime-probe@example.invalid';
const LINKED_FIELDS = [
  'phone',
  'phoneVerifiedAt',
  'emailVerifiedAt',
  'passwordHash',
  'googleSubject',
  'emailVerificationTokenHash',
  'emailVerificationBrowserHash',
  'emailVerificationExpiresAt',
];
const requireTrue = (value, code) => {
  if (!value) throw Object.assign(new Error(code), { safeCode: code });
};

export async function qaCustomer(db, provision) {
  const select = {
    email: true,
    emailNormalized: true,
    ...Object.fromEntries(LINKED_FIELDS.map((key) => [key, true])),
    fullName: true,
    isActive: true,
    role: { select: { name: true } },
    customer: { select: { id: true, fullName: true } },
  };
  let user = await db.user.findUnique({ where: { email: QA_EMAIL }, select });
  if (!user && provision) {
    await db.$transaction(async (tx) => {
      await tx.user.create({
        data: {
          email: QA_EMAIL,
          emailNormalized: QA_EMAIL,
          fullName: QA_NAME,
          role: { connect: { name: 'CUSTOMER' } },
          customer: { create: { fullName: QA_NAME } },
        },
        select: { id: true },
      });
    });
    user = await db.user.findUnique({ where: { email: QA_EMAIL }, select });
  }
  requireTrue(user, 'qa_identity_missing');
  requireTrue(
    user.email === QA_EMAIL &&
      user.emailNormalized === QA_EMAIL &&
      LINKED_FIELDS.every((key) => user[key] === null) &&
      user.fullName === QA_NAME &&
      user.isActive === true &&
      user.role?.name === 'CUSTOMER' &&
      user.customer?.fullName === QA_NAME,
    'qa_identity_conflict',
  );
  return user.customer.id;
}
