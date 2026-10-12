import { UserRound } from 'lucide-react';
import { SubmitButton } from '@rafraf/ui/submit-button';
import { AccountRegistrationFacts } from './account-registration-facts';
import { updateCustomerProfile } from './actions';
import { AddressManager } from './address-manager';
import styles from './account-styles';
import { customerSettingsInitialExpansion } from './customer-settings-state';
import { VehicleManager } from './vehicle-manager';

type SettingsCustomer = {
  fullName: string;
  city: string | null;
  user: {
    email: string | null;
    phone: string | null;
    phoneVerifiedAt: Date | null;
    createdAt: Date;
    lastLoginAt: Date | null;
    emailVerifiedAt: Date | null;
    googleSubject: string | null;
  };
};

type SettingsAddress = {
  id: string;
  label: string;
  city: string;
  district: string;
  street: string;
  buildingNumber: string;
  postalCode: string;
  additionalNumber: string | null;
  unitNumber: string | null;
  isDefault: boolean;
};

type SettingsVehicle = {
  id: string;
  make: string;
  model: string;
  year: number;
  engine: string | null;
  marketSpec: string | null;
  vin: string | null;
  plate: string | null;
  isDefault: boolean;
};

export function AccountSettingsContent({
  addresses,
  customer,
  profileStatus,
  vehicles,
}: {
  addresses: SettingsAddress[];
  customer: SettingsCustomer;
  profileStatus?: string;
  vehicles: SettingsVehicle[];
}) {
  const initialExpansion = customerSettingsInitialExpansion(
    addresses.length,
    vehicles.length,
  );

  return (
    <section className={styles.settings} aria-labelledby="settings-title">
      <header className={styles.settingsHeader}>
        <p className={styles.kicker}>ACCOUNT SETTINGS</p>
        <h1 id="settings-title">إعدادات الحساب</h1>
        <p>أدر بياناتك وعناوين الشحن ومركباتك في صفحة مستقلة وآمنة.</p>
      </header>

      <div className={styles.content}>
        <section
          id="profile"
          className={styles.panel}
          aria-labelledby="profile-title"
        >
          <header className={styles.panelHeader}>
            <UserRound size={21} aria-hidden />
            <div>
              <h2 id="profile-title">بيانات العميل والدفع</h2>
              <p className={styles.panelHint}>
                البريد يُستخدم لإيصالات الدفع، ويمكن استخدامه للدخول بعد توثيقه.
              </p>
            </div>
          </header>
          {profileStatus === 'saved' ? (
            <p
              className={`${styles.profileNotice} ${styles.profileSuccess}`}
              role="status"
            >
              تم حفظ بياناتك.
            </p>
          ) : ['invalid', 'duplicate', 'failed'].includes(
              profileStatus ?? '',
            ) ? (
            <p
              className={`${styles.profileNotice} ${styles.profileError}`}
              role="alert"
            >
              {profileStatus === 'duplicate'
                ? 'تعذّر حفظ هذا البريد؛ استخدم بريداً آخر.'
                : profileStatus === 'invalid'
                  ? 'راجع الاسم والبريد والمدينة ثم حاول مرة أخرى.'
                  : 'تعذّر حفظ البيانات الآن. حاول مرة أخرى.'}
            </p>
          ) : null}
          <form action={updateCustomerProfile} className={styles.profileForm}>
            <label>
              <span>الاسم الكامل</span>
              <input
                name="fullName"
                defaultValue={customer.fullName}
                minLength={2}
                maxLength={120}
                autoComplete="name"
                required
              />
            </label>
            <label>
              <span>المدينة</span>
              <input
                name="city"
                defaultValue={customer.city ?? ''}
                maxLength={80}
                autoComplete="address-level2"
              />
            </label>
            <label className={styles.profileWide}>
              <span>البريد الإلكتروني لإيصال الدفع</span>
              <input
                name="email"
                type="email"
                defaultValue={customer.user.email ?? ''}
                maxLength={254}
                autoComplete="email"
                inputMode="email"
                dir="ltr"
                required
              />
              <small>
                يمكن استخدام البريد للدخول بعد توثيقه، وتظل خيارات الجوال
                وGoogle متاحة.
              </small>
            </label>
            <label className={styles.profileWide}>
              <span>رقم الجوال الموثّق</span>
              <input
                value={customer.user.phone ?? ''}
                readOnly
                dir="ltr"
                aria-readonly="true"
              />
            </label>
            <SubmitButton
              className={styles.profileSubmit}
              pendingLabel="جارٍ الحفظ…"
            >
              حفظ بيانات العميل
            </SubmitButton>
          </form>
          <AccountRegistrationFacts
            createdAt={customer.user.createdAt}
            lastLoginAt={customer.user.lastLoginAt}
            googleLinked={Boolean(customer.user.googleSubject)}
            emailVerified={Boolean(customer.user.emailVerifiedAt)}
            phoneVerified={Boolean(customer.user.phoneVerifiedAt)}
          />
        </section>

        <AddressManager
          addresses={addresses}
          initiallyOpen={initialExpansion.address}
        />
        <VehicleManager
          vehicles={vehicles}
          initiallyOpen={initialExpansion.vehicle}
        />
      </div>
    </section>
  );
}
