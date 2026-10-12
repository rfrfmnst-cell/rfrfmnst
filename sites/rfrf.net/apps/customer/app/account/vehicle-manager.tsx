'use client';

import {
  Car,
  Check,
  ChevronDown,
  Pencil,
  Plus,
  Star,
  Trash2,
} from 'lucide-react';
import { useActionState } from 'react';
import {
  maskCustomerVehicleVin,
  maxCustomerVehicleYear,
  MIN_CUSTOMER_VEHICLE_YEAR,
} from '../../lib/customer-vehicle';
import { SubmitButton } from '@rafraf/ui/submit-button';
import styles from './account-styles';
import {
  createCustomerVehicle,
  deleteCustomerVehicle,
  setDefaultCustomerVehicle,
  updateCustomerVehicle,
  type VehicleActionState,
} from './vehicle-actions';

export interface AccountVehicle {
  id: string;
  make: string;
  model: string;
  year: number;
  engine: string | null;
  marketSpec: string | null;
  vin: string | null;
  plate: string | null;
  isDefault: boolean;
}

const initialState: VehicleActionState = {};

function VehicleFields({
  idPrefix,
  vehicle,
}: {
  idPrefix: string;
  vehicle?: AccountVehicle;
}) {
  return (
    <div className={styles.vehicleFormGrid}>
      <label htmlFor={`${idPrefix}-make`}>
        الشركة
        <input
          id={`${idPrefix}-make`}
          name="make"
          required
          maxLength={60}
          defaultValue={vehicle?.make}
          placeholder="تويوتا"
        />
      </label>
      <label htmlFor={`${idPrefix}-model`}>
        الموديل
        <input
          id={`${idPrefix}-model`}
          name="model"
          required
          maxLength={80}
          defaultValue={vehicle?.model}
          placeholder="كامري"
        />
      </label>
      <label htmlFor={`${idPrefix}-year`}>
        سنة الصنع
        <input
          id={`${idPrefix}-year`}
          name="year"
          type="number"
          inputMode="numeric"
          required
          min={MIN_CUSTOMER_VEHICLE_YEAR}
          max={maxCustomerVehicleYear()}
          defaultValue={vehicle?.year}
          placeholder="2024"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${idPrefix}-engine`}>
        المحرك <small>اختياري</small>
        <input
          id={`${idPrefix}-engine`}
          name="engine"
          maxLength={80}
          defaultValue={vehicle?.engine ?? ''}
          placeholder="2.5L"
          dir="ltr"
        />
      </label>
      <label htmlFor={`${idPrefix}-market`}>
        مواصفات السوق <small>اختياري</small>
        <input
          id={`${idPrefix}-market`}
          name="marketSpec"
          maxLength={40}
          defaultValue={vehicle?.marketSpec ?? ''}
          placeholder="GCC"
        />
      </label>
      <label htmlFor={`${idPrefix}-plate`}>
        رقم اللوحة <small>اختياري</small>
        <input
          id={`${idPrefix}-plate`}
          name="plate"
          maxLength={20}
          defaultValue={vehicle?.plate ?? ''}
          placeholder="أ ب ج 1234"
          dir="ltr"
        />
      </label>
      <label className={styles.vehicleVinField} htmlFor={`${idPrefix}-vin`}>
        رقم الهيكل VIN <small>اختياري — 17 خانة</small>
        <input
          id={`${idPrefix}-vin`}
          name="vin"
          minLength={17}
          maxLength={24}
          pattern="[A-HJ-NPR-Za-hj-npr-z0-9 -]{17,24}"
          defaultValue={vehicle?.vin ?? ''}
          placeholder="JTNB11HK5M3087962"
          autoCapitalize="characters"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
        />
      </label>
      <label className={styles.vehicleDefaultField}>
        <input
          name="isDefault"
          type="checkbox"
          defaultChecked={vehicle?.isDefault}
        />
        استخدمها افتراضياً في طلبات القطع
      </label>
    </div>
  );
}

function ActionFeedback({ state }: { state: VehicleActionState }) {
  if (state.error)
    return (
      <p className={styles.vehicleError} role="alert">
        {state.error}
      </p>
    );
  if (state.message)
    return (
      <p className={styles.vehicleSuccess} role="status">
        <Check size={15} aria-hidden /> {state.message}
      </p>
    );
  return null;
}

function VehicleCard({ vehicle }: { vehicle: AccountVehicle }) {
  const [updateState, updateAction] = useActionState(
    updateCustomerVehicle,
    initialState,
  );
  const [deleteState, deleteAction] = useActionState(
    deleteCustomerVehicle,
    initialState,
  );
  const [defaultState, defaultAction] = useActionState(
    setDefaultCustomerVehicle,
    initialState,
  );
  const feedback =
    deleteState.error || deleteState.message ? deleteState : defaultState;

  return (
    <article className={styles.vehicleCard}>
      <header className={styles.vehicleCardHeader}>
        <span className={styles.vehicleIcon}>
          <Car size={22} aria-hidden />
        </span>
        <div>
          <div className={styles.vehicleTitle}>
            <strong>
              {vehicle.make} {vehicle.model} {vehicle.year}
            </strong>
            {vehicle.isDefault ? (
              <span className={styles.defaultBadge}>
                <Star size={12} fill="currentColor" aria-hidden /> افتراضية
              </span>
            ) : null}
          </div>
          <div className={styles.vehicleMeta}>
            <bdi dir="ltr">{maskCustomerVehicleVin(vehicle.vin)}</bdi>
            {vehicle.plate ? <bdi dir="ltr">لوحة {vehicle.plate}</bdi> : null}
            {vehicle.marketSpec ? <span>{vehicle.marketSpec}</span> : null}
          </div>
        </div>
      </header>

      <div className={styles.vehicleActions}>
        {!vehicle.isDefault ? (
          <form action={defaultAction}>
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <SubmitButton
              className={styles.vehicleSecondaryButton}
              pendingLabel="جارٍ التعيين…"
            >
              <Star size={15} aria-hidden /> تعيين كافتراضية
            </SubmitButton>
          </form>
        ) : null}
        <details className={styles.vehicleEditor}>
          <summary>
            <Pencil size={15} aria-hidden /> تعديل
            <ChevronDown size={15} aria-hidden />
          </summary>
          <form action={updateAction} className={styles.vehicleEditForm}>
            <input type="hidden" name="vehicleId" value={vehicle.id} />
            <VehicleFields idPrefix={`edit-${vehicle.id}`} vehicle={vehicle} />
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
          <input type="hidden" name="vehicleId" value={vehicle.id} />
          <SubmitButton
            className={styles.vehicleDeleteButton}
            pendingLabel="جارٍ الحذف…"
            onClick={(event) => {
              if (!window.confirm('هل تريد حذف هذه المركبة من حسابك؟')) {
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

export function VehicleManager({
  vehicles,
  initiallyOpen = vehicles.length === 0,
}: {
  vehicles: AccountVehicle[];
  initiallyOpen?: boolean;
}) {
  const [createState, createAction] = useActionState(
    createCustomerVehicle,
    initialState,
  );

  return (
    <section
      className={`${styles.panel} ${styles.vehicleManager}`}
      aria-labelledby="vehicles-title"
    >
      <header className={styles.panelHeader}>
        <Car size={21} aria-hidden />
        <div>
          <h2 id="vehicles-title">مركباتي المحفوظة</h2>
          <p>احفظ بيانات المركبة لتسريع المطابقة وطلب القطعة.</p>
        </div>
      </header>

      <details className={styles.vehicleCreate} open={initiallyOpen}>
        <summary>
          <Plus size={17} aria-hidden /> إضافة مركبة
          <ChevronDown size={16} aria-hidden />
        </summary>
        <form action={createAction} className={styles.vehicleCreateForm}>
          <VehicleFields idPrefix="create-vehicle" />
          <ActionFeedback state={createState} />
          <SubmitButton
            className={styles.vehiclePrimaryButton}
            pendingLabel="جارٍ الإضافة…"
          >
            <Plus size={16} aria-hidden /> حفظ المركبة
          </SubmitButton>
        </form>
      </details>

      {vehicles.length === 0 ? (
        <div className={styles.vehicleEmpty}>
          <Car size={28} aria-hidden />
          <strong>لا توجد مركبة محفوظة بعد</strong>
          <span>أضف مركبتك الأولى، وستصبح الافتراضية تلقائياً.</span>
        </div>
      ) : (
        <div className={styles.vehicleCards}>
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </div>
      )}
    </section>
  );
}
