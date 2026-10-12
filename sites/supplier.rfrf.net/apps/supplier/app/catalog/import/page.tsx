import { InventoryRowStatus, prisma, SupplierStatus } from '@rafraf/db';
import { ArrowLeft, FileText } from 'lucide-react';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../../lib/session';
import { CatalogImportWorkspace } from './import-workspace';
import styles from './import-shell.module.css';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'استيراد الكتالوج — بوابة موردي رفرف',
  description: 'استيراد مخزون المورد من CSV ضمن تدفق تحقق وتدقيق محكوم.',
};

export default async function SupplierCatalogImportPage() {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: { id: true, businessName: true, status: true },
  });
  if (!supplier || supplier.status !== SupplierStatus.APPROVED) redirect('/');

  const [currentInventoryCount, flaggedInventoryCount, warehouses] =
    await Promise.all([
      prisma.supplierInventory.count({
        where: { supplierId, isActive: true },
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
        select: {
          id: true,
          name: true,
          city: true,
          isDefault: true,
        },
      }),
    ]);

  return (
    <div className={styles.page}>
      <header className={styles.pageHeader}>
        <div>
          <p>
            <FileText size={16} aria-hidden /> SUPPLIER CATALOG · PRODUCT OS
            V1.1
          </p>
          <h1>استيراد كتالوج المخزون</h1>
          <span>تحقق صريح قبل أن تدخل أي بيانات إلى مخزون منشأتك.</span>
        </div>
        <Link href="/">
          <ArrowLeft size={16} aria-hidden /> لوحة المورد
        </Link>
      </header>

      <CatalogImportWorkspace
        supplierName={supplier.businessName}
        currentInventoryCount={currentInventoryCount}
        flaggedInventoryCount={flaggedInventoryCount}
        warehouses={warehouses}
      />
    </div>
  );
}
