import { SubmitButton } from '@rafraf/ui/submit-button';
import { registerSupplierManagedShipment } from './actions';
import styles from './carrier-registration-form.module.css';

export function CarrierRegistrationForm({
  orderId,
  routeId,
}: {
  orderId: string;
  routeId: string;
}) {
  return (
    <form action={registerSupplierManagedShipment} className={styles.form}>
      <input type="hidden" name="orderId" value={orderId} />
      <input type="hidden" name="routeId" value={routeId} />
      <label>
        <span>شركة الشحن الفعلية</span>
        <select name="carrier" required defaultValue="">
          <option value="" disabled>
            اختر الناقل
          </option>
          <option value="DHL">DHL</option>
          <option value="FEDEX">FedEx</option>
          <option value="UPS">UPS</option>
          <option value="ARAMEX">Aramex</option>
          <option value="SMSA">SMSA</option>
          <option value="DPD">DPD</option>
          <option value="USPS">USPS</option>
          <option value="ROYAL_MAIL">Royal Mail</option>
          <option value="CANADA_POST">Canada Post</option>
          <option value="AUSTRALIA_POST">Australia Post</option>
          <option value="EMS">EMS</option>
          <option value="SF_EXPRESS">SF Express</option>
          <option value="OTHER">ناقل آخر</option>
        </select>
      </label>
      <label>
        <span>رقم التتبع</span>
        <input
          name="trackingNumber"
          dir="ltr"
          required
          minLength={4}
          maxLength={80}
          pattern="[A-Za-z0-9][A-Za-z0-9._-]{3,79}"
          autoComplete="off"
        />
      </label>
      <small>
        يُسجل الرقم للمراجعة ولا يُعد إثبات استلام أو تسليم حتى تعتمد الإدارة
        حدث الناقل.
      </small>
      <SubmitButton className={styles.submit} pendingLabel="جارٍ الحفظ…">
        ربط الناقل ورقم التتبع
      </SubmitButton>
    </form>
  );
}
