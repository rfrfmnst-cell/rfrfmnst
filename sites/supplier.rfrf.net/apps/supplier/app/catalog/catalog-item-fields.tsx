import { CATALOG_CONDITIONS, CATALOG_CURRENCIES } from './catalog-policy';
import styles from './catalog-item.module.css';

export const CATALOG_CONDITION_LABELS = {
  NEW: 'جديد',
  USED: 'مستعمل',
  REFURBISHED: 'مجدد',
} as const;

export type CatalogWarehouseOption = {
  id: string;
  name: string;
  city: string;
};

export type EditableCatalogItem = {
  partNumber: string;
  brand: string | null;
  condition: keyof typeof CATALOG_CONDITION_LABELS;
  quantity: number;
  price: { toString(): string };
  currency: string;
  warrantyMonths: number;
  leadTimeDays: number;
  warehouseId: string | null;
};

export function CatalogItemFields({
  item,
  warehouses,
}: {
  item?: EditableCatalogItem;
  warehouses: CatalogWarehouseOption[];
}) {
  return (
    <fieldset className={styles.formGrid}>
      <legend className="sr-only">بيانات المنتج والمخزون</legend>
      <label className={styles.wideField}>
        <span>SKU / رقم القطعة</span>
        <input
          name="partNumber"
          required
          minLength={2}
          maxLength={80}
          autoCapitalize="characters"
          defaultValue={item?.partNumber}
          placeholder="مثال: 04465-0K240"
        />
      </label>
      <label>
        <span>العلامة التجارية</span>
        <input
          name="brand"
          maxLength={80}
          defaultValue={item?.brand ?? ''}
          placeholder="اختياري"
        />
      </label>
      <label>
        <span>الحالة</span>
        <select name="condition" defaultValue={item?.condition ?? 'NEW'}>
          {CATALOG_CONDITIONS.map((condition) => (
            <option key={condition} value={condition}>
              {CATALOG_CONDITION_LABELS[condition]}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>الكمية</span>
        <input
          name="quantity"
          type="number"
          inputMode="numeric"
          min={0}
          max={1_000_000}
          step={1}
          required
          defaultValue={item?.quantity ?? 0}
        />
      </label>
      <label>
        <span>السعر</span>
        <input
          name="price"
          type="number"
          inputMode="decimal"
          min="0.01"
          max="999999999.99"
          step="0.01"
          required
          defaultValue={item?.price.toString()}
        />
      </label>
      <label>
        <span>العملة</span>
        <select name="currency" defaultValue={item?.currency ?? 'SAR'}>
          {CATALOG_CURRENCIES.map((currency) => (
            <option key={currency} value={currency}>
              {currency}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>المستودع</span>
        <select name="warehouseId" defaultValue={item?.warehouseId ?? ''}>
          <option value="">بدون مستودع محدد</option>
          {warehouses.map((warehouse) => (
            <option key={warehouse.id} value={warehouse.id}>
              {warehouse.name} — {warehouse.city}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>الضمان بالأشهر</span>
        <input
          name="warrantyMonths"
          type="number"
          inputMode="numeric"
          min={0}
          max={120}
          step={1}
          defaultValue={item?.warrantyMonths ?? 0}
        />
      </label>
      <label>
        <span>مدة التوريد بالأيام</span>
        <input
          name="leadTimeDays"
          type="number"
          inputMode="numeric"
          min={0}
          max={365}
          step={1}
          defaultValue={item?.leadTimeDays ?? 0}
        />
      </label>
    </fieldset>
  );
}
