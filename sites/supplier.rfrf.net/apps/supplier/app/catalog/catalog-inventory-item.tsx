import { InventoryRowStatus } from '@rafraf/db';
import { Boxes, PencilLine, Warehouse } from 'lucide-react';
import { randomUUID } from 'node:crypto';
import { SubmitButton } from '@rafraf/ui/submit-button';
import {
  setSupplierCatalogItemActive,
  updateSupplierCatalogItem,
} from './actions';
import {
  CATALOG_CONDITION_LABELS,
  CatalogItemFields,
  type CatalogWarehouseOption,
  type EditableCatalogItem,
} from './catalog-item-fields';
import styles from './catalog-item.module.css';

export type CatalogInventoryItemValue = EditableCatalogItem & {
  id: string;
  rowStatus: InventoryRowStatus;
  isActive: boolean;
  updatedAt: Date;
  warehouse: { name: string; city: string } | null;
  part: { nameAr: string } | null;
};

function money(value: { toString(): string }, currency: string): string {
  return new Intl.NumberFormat('ar-SA', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value.toString()));
}

function date(value: Date): string {
  return new Intl.DateTimeFormat('ar-SA', {
    dateStyle: 'medium',
  }).format(value);
}

export function CatalogInventoryItem({
  item,
  warehouses,
}: {
  item: CatalogInventoryItemValue;
  warehouses: CatalogWarehouseOption[];
}) {
  return (
    <article
      className={`${styles.inventoryItem} ${item.isActive ? '' : styles.inactive}`}
    >
      <div className={styles.itemIdentity}>
        <div className={styles.itemIcon} aria-hidden>
          <Boxes size={21} />
        </div>
        <div>
          <h3>{item.part?.nameAr ?? item.brand ?? 'قطعة مخزون'}</h3>
          <code dir="ltr">{item.partNumber}</code>
        </div>
      </div>

      <dl className={styles.itemFacts}>
        <div>
          <dt>الكمية</dt>
          <dd className={item.quantity === 0 ? styles.stockOut : undefined}>
            {item.quantity === 0 ? 'نفدت' : item.quantity}
          </dd>
        </div>
        <div>
          <dt>السعر</dt>
          <dd>{money(item.price, item.currency)}</dd>
        </div>
        <div>
          <dt>المستودع</dt>
          <dd>
            {item.warehouse ? (
              <>
                <Warehouse size={14} aria-hidden /> {item.warehouse.name}
              </>
            ) : (
              'غير محدد'
            )}
          </dd>
        </div>
        <div>
          <dt>الحالة</dt>
          <dd>
            {!item.isActive
              ? 'معطّل'
              : item.rowStatus === InventoryRowStatus.FLAGGED
                ? 'تحتاج مطابقة'
                : 'مفعّل'}
          </dd>
        </div>
      </dl>

      <div className={styles.itemMeta}>
        <span>{CATALOG_CONDITION_LABELS[item.condition]}</span>
        <span>تحديث {date(item.updatedAt)}</span>
      </div>

      <div className={styles.itemActions}>
        <details className={styles.editor}>
          <summary>
            <PencilLine size={16} aria-hidden /> تعديل
          </summary>
          <form action={updateSupplierCatalogItem} className={styles.itemForm}>
            <input type="hidden" name="itemId" value={item.id} />
            <input type="hidden" name="mutationToken" value={randomUUID()} />
            <CatalogItemFields item={item} warehouses={warehouses} />
            <div className={styles.formActions}>
              <SubmitButton
                pendingLabel="جارٍ الحفظ…"
                className={styles.primaryAction}
              >
                حفظ التعديلات
              </SubmitButton>
            </div>
          </form>
        </details>
        <form action={setSupplierCatalogItemActive}>
          <input type="hidden" name="itemId" value={item.id} />
          <input type="hidden" name="mutationToken" value={randomUUID()} />
          <input
            type="hidden"
            name="nextActive"
            value={item.isActive ? 'false' : 'true'}
          />
          <SubmitButton
            pendingLabel={item.isActive ? 'جارٍ التعطيل…' : 'جارٍ التفعيل…'}
            className={
              item.isActive ? styles.deactivateAction : styles.activateAction
            }
          >
            {item.isActive ? 'تعطيل' : 'إعادة التفعيل'}
          </SubmitButton>
        </form>
      </div>
    </article>
  );
}
