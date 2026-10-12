'use client';

import {
  Check,
  ChevronDown,
  MapPin,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useActionState } from 'react';
import { SubmitButton } from '@rafraf/ui/submit-button';
import styles from './account-styles';
import {
  createCustomerAddress,
  deleteCustomerAddress,
  setDefaultCustomerAddress,
  updateCustomerAddress,
  type AddressActionState,
} from './address-actions';

export interface AccountAddress {
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
}

const initialState: AddressActionState = {};
const fourDigitPattern = '[0-9٠-٩۰-۹]{4}';
const fiveDigitPattern = '[0-9٠-٩۰-۹]{5}';
const unitPattern = '[0-9٠-٩۰-۹]{1,6}';

function AddressFields({
  idPrefix,
  address,
}: {
  idPrefix: string;
  address?: AccountAddress;
}) {
  return (
    <div className={styles.vehicleFormGrid}>
      <label htmlFor={`${idPrefix}-label`}>
        اسم العنوان
        <input
          id={`${idPrefix}-label`}
          name="label"
          required
          minLength={2}
          maxLength={40}
          defaultValue={address?.label}
          placeholder="المنزل"
          autoComplete="off"
        />
      </label>
      <label htmlFor={`${idPrefix}-city`}>
        المدينة
        <input
          id={`${idPrefix}-city`}
          name="city"
          required
          minLength={2}
          maxLength={80}
          defaultValue={address?.city}
          placeholder="الرياض"
          autoComplete="address-level2"
        />
      </label>
      <label htmlFor={`${idPrefix}-district`}>
        الحي
        <input
          id={`${idPrefix}-district`}
          name="district"
          required
          minLength={2}
          maxLength={80}
          defaultValue={address?.district}
          placeholder="الياسمين"
          autoComplete="address-level3"
        />
      </label>
      <label htmlFor={`${idPrefix}-street`}>
        الشارع
        <input
          id={`${idPrefix}-street`}
          name="street"
          required
          minLength={2}
          maxLength={120}
          defaultValue={address?.street}
          placeholder="شارع أنس بن مالك"
          autoComplete="street-address"
        />
      </label>
      <label htmlFor={`${idPrefix}-building`}>
        رقم المبنى
        <input
          id={`${idPrefix}-building`}
          name="buildingNumber"
          required
          minLength={4}
          maxLength={4}
          pattern={fourDigitPattern}
          inputMode="numeric"
          defaultValue={address?.buildingNumber}
          placeholder="1234"
          autoComplete="off"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${idPrefix}-postal`}>
        الرمز البريدي
        <input
          id={`${idPrefix}-postal`}
          name="postalCode"
          required
          minLength={5}
          maxLength={5}
          pattern={fiveDigitPattern}
          inputMode="numeric"
          defaultValue={address?.postalCode}
          placeholder="13325"
          autoComplete="postal-code"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${idPrefix}-additional`}>
        الرقم الإضافي <small>اختياري</small>
        <input
          id={`${idPrefix}-additional`}
          name="additionalNumber"
          minLength={4}
          maxLength={4}
          pattern={fourDigitPattern}
          inputMode="numeric"
          defaultValue={address?.additionalNumber ?? ''}
          placeholder="5678"
          autoComplete="off"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${idPrefix}-unit`}>
        رقم الوحدة <small>اختياري</small>
        <input
          id={`${idPrefix}-unit`}
          name="unitNumber"
          minLength={1}
          maxLength={6}
          pattern={unitPattern}
          inputMode="numeric"
          defaultValue={address?.unitNumber ?? ''}
          placeholder="12"
          autoComplete="off"
          dir="ltr"
        />
      </label>
      <label className={styles.vehicleDefaultField}>
        <input
          name="isDefault"
          type="checkbox"
          defaultChecked={address?.isDefault}
        />
        استخدمه كعنوان افتراضي
      </label>
    </div>
  );
}

function ActionFeedback({ state }: { state: AddressActionState }) {
  if (state.error) {
    return (
      <p className={styles.vehicleError} role="alert">
        {state.error}
      </p>
    );
  }
  if (state.message) {
    return (
      <p className={styles.vehicleSuccess} role="status">
        <Check size={15} aria-hidden /> {state.message}
      </p>
    );
  }
  return null;
}

function AddressCard({ address }: { address: AccountAddress }) {
  const [updateState, updateAction] = useActionState(
    updateCustomerAddress,
    initialState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteCustomerAddress,
    initialState,
  );
  const [defaultState, defaultAction] = useActionState(
    setDefaultCustomerAddress,
    initialState,
  );
  const feedback =
    deleteState.error || deleteState.message ? deleteState : defaultState;

  return (
    <article className={styles.vehicleCard}>
      <header className={styles.vehicleCardHeader}>
        <span className={styles.vehicleIcon}>
          <MapPin size={22} aria-hidden />
        </span>
        <div>
          <div className={styles.vehicleTitle}>
            <strong>{address.label}</strong>
            {address.isDefault ? (
              <span className={styles.defaultBadge}>
                <Star size={12} fill="currentColor" aria-hidden /> افتراضي
              </span>
            ) : null}
          </div>
          <div className={styles.vehicleMeta}>
            <span>
              {address.street}، مبنى{' '}
              <bdi dir="ltr">{address.buildingNumber}</bdi>
            </span>
            <span>
              {address.district}، {address.city}
            </span>
            <bdi dir="ltr">{address.postalCode}</bdi>
            {address.additionalNumber ? (
              <bdi dir="ltr">إضافي {address.additionalNumber}</bdi>
            ) : null}
            {address.unitNumber ? (
              <bdi dir="ltr">وحدة {address.unitNumber}</bdi>
            ) : null}
          </div>
        </div>
      </header>

      <div className={styles.vehicleActions}>
        {!address.isDefault ? (
          <form action={defaultAction}>
            <input type="hidden" name="addressId" value={address.id} />
            <SubmitButton
              className={styles.vehicleSecondaryButton}
              pendingLabel="جارٍ التعيين…"
            >
              <Star size={15} aria-hidden /> تعيين كافتراضي
            </SubmitButton>
          </form>
        ) : null}
        <details className={styles.vehicleEditor}>
          <summary>
            <Pencil size={15} aria-hidden /> تعديل
            <ChevronDown size={15} aria-hidden />
          </summary>
          <form action={updateAction} className={styles.vehicleEditForm}>
            <input type="hidden" name="addressId" value={address.id} />
            <AddressFields
              idPrefix={`edit-address-${address.id}`}
              address={address}
            />
            <ActionFeedback state={updateState} />
            <SubmitButton
              className={styles.vehiclePrimaryButton}
              pendingLabel="جارٍ الحفظ…"
            >
              حفظ التعديلات
            </SubmitButton>
          </form>
        </details>
        <form action={deleteAction}>
          <input type="hidden" name="addressId" value={address.id} />
          <SubmitButton
            className={styles.vehicleDeleteButton}
            pendingLabel="جارٍ الحذف…"
            onClick={(event) => {
              if (!window.confirm('هل تريد حذف هذا العنوان من حسابك؟')) {
                event.preventDefault();
              }
            }}
          >
            <Trash2 size={15} aria-hidden /> حذف
          </SubmitButton>
        </form>
      </div>
      <ActionFeedback state={feedback} />
    </article>
  );
}

export function AddressManager({
  addresses,
  initiallyOpen = addresses.length === 0,
}: {
  addresses: AccountAddress[];
  initiallyOpen?: boolean;
}) {
  const [createState, createAction] = useActionState(
    createCustomerAddress,
    initialState,
  );

  return (
    <section
      className={`${styles.panel} ${styles.vehicleManager}`}
      aria-labelledby="addresses-title"
    >
      <header className={styles.panelHeader}>
        <MapPin size={21} aria-hidden />
        <div>
          <h2 id="addresses-title">عناويني المحفوظة</h2>
          <p>احفظ حتى 10 عناوين سعودية واختر عنواناً افتراضياً.</p>
        </div>
      </header>

      <details className={styles.vehicleCreate} open={initiallyOpen}>
        <summary>
          <Plus size={17} aria-hidden /> إضافة عنوان
          <ChevronDown size={16} aria-hidden />
        </summary>
        <form action={createAction} className={styles.vehicleCreateForm}>
          <AddressFields idPrefix="create-address" />
          <ActionFeedback state={createState} />
          <SubmitButton
            className={styles.vehiclePrimaryButton}
            pendingLabel="جارٍ الإضافة…"
          >
            <Plus size={16} aria-hidden /> حفظ العنوان
          </SubmitButton>
        </form>
      </details>

      {addresses.length === 0 ? (
        <div className={styles.vehicleEmpty}>
          <MapPin size={28} aria-hidden />
          <strong>لا يوجد عنوان محفوظ بعد</strong>
          <span>أضف عنوانك الأول، وسيصبح الافتراضي تلقائياً.</span>
        </div>
      ) : (
        <div className={styles.vehicleCards}>
          {addresses.map((address) => (
            <AddressCard key={address.id} address={address} />
          ))}
        </div>
      )}
    </section>
  );
}
