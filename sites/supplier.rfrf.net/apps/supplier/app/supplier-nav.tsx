'use client';

import {
  BadgeCheck,
  Building2,
  FileCheck2,
  FileUp,
  LayoutDashboard,
  PackageCheck,
  PackageSearch,
  Truck,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/*
 * `title` على كل رابط: تحت 620px تُختصر الروابط إلى أيقوناتها لتتّسع الثمانية
 * في سطر الجوال، والأيقونة وحدها لا تُفهم بصرياً. النص الداخلي يبقى كما هو
 * فيظل الاسم المتاح لقارئ الشاشة سليماً.
 */
export function SupplierNav() {
  const pathname = usePathname();
  const onHome = pathname === '/';
  const onProfile = pathname === '/profile';
  const onQuotes = pathname === '/quotes';
  const onOrders = pathname === '/orders' || pathname.startsWith('/orders/');
  const onCatalog = pathname === '/catalog';
  const onCatalogImport = pathname.startsWith('/catalog/import');
  const onShipments = pathname === '/shipments';

  return (
    <nav aria-label="تنقل بوابة الموردين">
      <Link
        href="/#workspace"
        title="الرئيسية"
        className={onHome ? 'active' : undefined}
        aria-current={onHome ? 'page' : undefined}
      >
        <LayoutDashboard size={19} aria-hidden /> الرئيسية
      </Link>
      <Link
        href="/quotes"
        title="فرص وعروض التسعير"
        className={onQuotes ? 'active' : undefined}
        aria-current={onQuotes ? 'page' : undefined}
      >
        <FileCheck2 size={19} aria-hidden /> فرص وعروض التسعير
      </Link>
      <Link
        href="/catalog"
        title="المنتجات والمخزون"
        className={onCatalog ? 'active' : undefined}
        aria-current={onCatalog ? 'page' : undefined}
      >
        <PackageSearch size={19} aria-hidden /> المنتجات والمخزون
      </Link>
      <Link
        href="/catalog/import"
        title="استيراد CSV"
        className={onCatalogImport ? 'active' : undefined}
        aria-current={onCatalogImport ? 'page' : undefined}
      >
        <FileUp size={19} aria-hidden /> استيراد CSV
      </Link>
      <Link
        href="/orders"
        title="الطلبات"
        className={onOrders ? 'active' : undefined}
        aria-current={onOrders ? 'page' : undefined}
      >
        <PackageCheck size={19} aria-hidden /> الطلبات
      </Link>
      <Link
        href="/shipments"
        title="تجهيز وشحن"
        className={onShipments ? 'active' : undefined}
        aria-current={onShipments ? 'page' : undefined}
      >
        <Truck size={19} aria-hidden /> تجهيز وشحن
      </Link>
      <Link
        href="/profile"
        title="ملف المنشأة"
        className={onProfile ? 'active' : undefined}
        aria-current={onProfile ? 'page' : undefined}
      >
        <BadgeCheck size={19} aria-hidden /> ملف المنشأة
      </Link>
      <Link href="/#payouts" title="المستحقات">
        <Building2 size={19} aria-hidden /> المستحقات
      </Link>
    </nav>
  );
}
