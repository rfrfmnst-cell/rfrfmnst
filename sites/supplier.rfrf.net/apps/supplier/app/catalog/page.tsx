import {
  InventoryRowStatus,
  type Prisma,
  prisma,
  SupplierStatus,
} from '@rafraf/db';
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  CircleOff,
  FileUp,
  PackagePlus,
  Search,
} from 'lucide-react';
import { randomUUID } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../lib/session';
import { SubmitButton } from '@rafraf/ui/submit-button';
import { createSupplierCatalogItem } from './actions';
import { CatalogItemFields } from './catalog-item-fields';
import { CatalogInventoryItem } from './catalog-inventory-item';
import itemStyles from './catalog-item.module.css';
import styles from './catalog.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'المنتجات والمخزون — بوابة موردي رفرف',
  description: 'إدارة منتجات وأسعار وكميات المورد المحلي ضمن منشأته فقط.',
};

type CatalogPageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

type CatalogStatus = 'active' | 'inactive' | 'all';

const SUCCESS_MESSAGES: Record<string, string> = {
  created: 'أُضيف المنتج إلى مخزون منشأتك.',
  updated: 'حُفظت بيانات المنتج والمخزون.',
  activated: 'أُعيد تفعيل المنتج.',
  deactivated: 'عُطّل المنتج دون حذف سجله.',
};

const ERROR_MESSAGES: Record<string, string> = {
  auth: 'حساب المورد غير مخوّل لإدارة المخزون.',
  duplicate:
    'يوجد SKU مطابق في المستودع نفسه. عدّل السجل الحالي أو أعد تفعيله.',
  invalid: 'تحقق من SKU والسعر والكمية وبقية الحقول ثم حاول مجددًا.',
  not_found: 'تعذر العثور على المنتج ضمن منشأتك.',
  save: 'تعذر الحفظ بأمان. لم تُطبّق العملية.',
  warehouse: 'المستودع المحدد لا يتبع منشأتك.',
};

function firstParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? (value[0] ?? '') : (value ?? '');
}

function catalogStatus(value: string): CatalogStatus {
  return value === 'inactive' || value === 'all' ? value : 'active';
}

export default async function SupplierCatalogPage({
  searchParams,
}: CatalogPageProps) {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, businessName: true, status: true },
  });
  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');

  const params = await searchParams;
  const query = firstParam(params.q).trim().slice(0, 80);
  const status = catalogStatus(firstParam(params.status));
  const ok = firstParam(params.ok);
  const error = firstParam(params.err);
  const listWhere: Prisma.SupplierInventoryWhereInput = {
    supplierId,
    ...(status === 'active'
      ? { isActive: true }
      : status === 'inactive'
        ? { isActive: false }
        : {}),
    ...(query
      ? {
          OR: [
            { partNumber: { contains: query, mode: 'insensitive' } },
            { brand: { contains: query, mode: 'insensitive' } },
          ],
        }
      : {}),
  };

  const [
    items,
    matchingCount,
    activeCount,
    outOfStockCount,
    flaggedCount,
    warehouses,
  ] = await Promise.all([
    prisma.supplierInventory.findMany({
      where: listWhere,
      orderBy: [{ isActive: 'desc' }, { updatedAt: 'desc' }],
      take: 100,
      select: {
        id: true,
        partId: true,
        partNumber: true,
        brand: true,
        condition: true,
        quantity: true,
        price: true,
        currency: true,
        warrantyMonths: true,
        leadTimeDays: true,
        warehouseId: true,
        rowStatus: true,
        isActive: true,
        updatedAt: true,
        warehouse: { select: { name: true, city: true } },
        part: { select: { nameAr: true } },
      },
    }),
    prisma.supplierInventory.count({ where: listWhere }),
    prisma.supplierInventory.count({ where: { supplierId, isActive: true } }),
    prisma.supplierInventory.count({
      where: { supplierId, isActive: true, quantity: 0 },
    }),
    prisma.supplierInventory.count({
      where: {
        supplierId,
        isActive: true,
        rowStatus: InventoryRowStatus.FLAGGED,
      },
    }),
    prisma.supplierWarehouse.findMany({
      where: { supplierId },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
      select: { id: true, name: true, city: true },
    }),
  ]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p>SUPPLIER CATALOG · LOCAL INVENTORY</p>
          <h1>المنتجات والمخزون</h1>
          <span>
            إدارة مباشرة لمنتجات {supplier.businessName} وأسعارها وكمياتها.
          </span>
        </div>
        <Link href="/catalog/import" className={styles.secondaryAction}>
          <FileUp size={17} aria-hidden /> استيراد CSV
        </Link>
      </header>

      <section className={styles.metrics} aria-label="ملخص المخزون">
        <article>
          <Boxes size={22} aria-hidden />
          <span>منتجات مفعّلة</span>
          <strong>{activeCount}</strong>
        </article>
        <article>
          <CircleOff size={22} aria-hidden />
          <span>نفدت كميتها</span>
          <strong>{outOfStockCount}</strong>
        </article>
        <article>
          <AlertTriangle size={22} aria-hidden />
          <span>تحتاج مطابقة</span>
          <strong>{flaggedCount}</strong>
        </article>
      </section>

      {SUCCESS_MESSAGES[ok] ? (
        <p className={styles.successNotice} role="status">
          <CheckCircle2 size={18} aria-hidden /> {SUCCESS_MESSAGES[ok]}
        </p>
      ) : null}
      {ERROR_MESSAGES[error] ? (
        <p className={styles.errorNotice} role="alert">
          <AlertTriangle size={18} aria-hidden /> {ERROR_MESSAGES[error]}
        </p>
      ) : null}

      <details className={styles.createPanel} open={activeCount === 0}>
        <summary>
          <span>
            <PackagePlus size={19} aria-hidden /> إضافة منتج يدويًا
          </span>
          <small>للإضافة السريعة؛ استخدم CSV للكميات الكبيرة.</small>
        </summary>
        <form
          action={createSupplierCatalogItem}
          className={itemStyles.itemForm}
        >
          <input type="hidden" name="mutationToken" value={randomUUID()} />
          <CatalogItemFields warehouses={warehouses} />
          <div className={itemStyles.formActions}>
            <SubmitButton
              pendingLabel="جارٍ الإضافة…"
              className={itemStyles.primaryAction}
            >
              <PackagePlus size={17} aria-hidden /> إضافة المنتج
            </SubmitButton>
          </div>
        </form>
      </details>

      <section className={styles.inventoryPanel}>
        <div className={styles.panelHead}>
          <div>
            <h2>قائمة المنتجات</h2>
            <p>{matchingCount} نتيجة ضمن منشأتك</p>
          </div>
          <form method="get" className={styles.filters}>
            <label>
              <span className="sr-only">ابحث بـ SKU أو العلامة</span>
              <Search size={16} aria-hidden />
              <input
                type="search"
                name="q"
                maxLength={80}
                defaultValue={query}
                placeholder="SKU أو العلامة"
              />
            </label>
            <select
              name="status"
              defaultValue={status}
              aria-label="حالة المنتج"
            >
              <option value="active">المفعّلة</option>
              <option value="inactive">المعطّلة</option>
              <option value="all">الكل</option>
            </select>
            <button type="submit">تطبيق</button>
          </form>
        </div>

        {items.length === 0 ? (
          <div className={styles.emptyState}>
            <Boxes size={36} aria-hidden />
            <h3>لا توجد منتجات مطابقة</h3>
            <p>غيّر البحث أو الفلتر، أو أضف أول منتج إلى مخزون منشأتك.</p>
          </div>
        ) : (
          <div className={styles.inventoryList}>
            {items.map((item) => (
              <CatalogInventoryItem
                key={item.id}
                item={item}
                warehouses={warehouses}
              />
            ))}
          </div>
        )}

        {matchingCount > items.length ? (
          <p className={styles.limitNote}>
            تظهر أحدث 100 نتيجة. استخدم البحث لتضييق القائمة.
          </p>
        ) : null}
      </section>
    </div>
  );
}
