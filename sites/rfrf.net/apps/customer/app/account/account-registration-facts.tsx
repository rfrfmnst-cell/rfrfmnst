import styles from './account-styles';
import { accountIdentityPresentation } from './account-identity';

const ACCOUNT_DATE_TIME = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Riyadh',
});

export function AccountRegistrationFacts({
  createdAt,
  lastLoginAt,
  googleLinked,
  emailVerified,
  phoneVerified,
}: {
  createdAt: Date;
  lastLoginAt: Date | null;
  googleLinked: boolean;
  emailVerified: boolean;
  phoneVerified: boolean;
}) {
  const identity = accountIdentityPresentation({
    googleLinked,
    emailVerified,
    phoneVerified,
  });
  return (
    <dl className={styles.accountFacts} aria-label="تفاصيل تسجيل الحساب">
      <div>
        <dt>طريقة التسجيل</dt>
        <dd>{identity.registrationMethod}</dd>
      </div>
      <div>
        <dt>وقت التسجيل (بتوقيت الرياض)</dt>
        <dd>{ACCOUNT_DATE_TIME.format(createdAt)}</dd>
      </div>
      <div>
        <dt>آخر دخول (بتوقيت الرياض)</dt>
        <dd>
          {lastLoginAt
            ? ACCOUNT_DATE_TIME.format(lastLoginAt)
            : 'لا يوجد دخول سابق مسجّل'}
        </dd>
      </div>
      <div>
        <dt>حالة الحساب</dt>
        <dd>{identity.accountStatus}</dd>
      </div>
    </dl>
  );
}
