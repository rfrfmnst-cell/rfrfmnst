import { prisma } from '@rafraf/db';
import {
  BadgeCheck,
  Building2,
  CalendarClock,
  FileCheck2,
  Mail,
  MapPin,
  Phone,
  ShieldCheck,
  Store,
  UserRound,
  Warehouse,
} from 'lucide-react';
import { redirect } from 'next/navigation';
import { getSessionSupplierId } from '../../lib/session';
import { SupplierDocumentUpload } from '../supplier-document-upload';
import {
  ar,
  DOCUMENT_STATUS_AR,
  DOCUMENT_TYPE_AR,
  SUPPLIER_STATUS_AR,
} from '../../lib/supplier-labels';
import styles from './profile.module.css';

export const dynamic = 'force-dynamic';

const DATE_TIME = new Intl.DateTimeFormat('ar-SA', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'Asia/Riyadh',
});

export default async function SupplierProfilePage() {
  const supplierId = await getSessionSupplierId();
  if (!supplierId) redirect('/login');

  const supplier = await prisma.supplier.findUnique({
    where: { id: supplierId },
    select: {
      businessName: true,
      crNumber: true,
      status: true,
      city: true,
      countryCode: true,
      contactPhone: true,
      contactEmail: true,
      score: true,
      returnRate: true,
      slaOnTimeRate: true,
      createdAt: true,
      updatedAt: true,
      users: {
        orderBy: [{ isOwner: 'desc' }, { id: 'asc' }],
        select: {
          id: true,
          position: true,
          isOwner: true,
          user: {
            select: {
              fullName: true,
              phone: true,
              email: true,
              isActive: true,
              lastLoginAt: true,
              createdAt: true,
            },
          },
        },
      },
      documents: {
        orderBy: { createdAt: 'desc' },
        select: { id: true, type: true, status: true, createdAt: true },
      },
      warehouses: {
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          city: true,
          isDefault: true,
          _count: { select: { inventory: true } },
        },
      },
      _count: {
        select: {
          inventory: true,
          quotes: true,
          orders: true,
          payouts: true,
        },
      },
    },
  });

  if (!supplier) redirect('/login');

  return (
    <div className={styles.page}>
      <header className={styles.hero}>
        <div className={styles.mark}>
          <Store size={28} aria-hidden />
        </div>
        <div>
          <p className={styles.kicker}>SUPPLIER PROFILE</p>
          <h1>{supplier.businessName}</h1>
          <span>
            <MapPin size={15} aria-hidden />{' '}
            {supplier.city ?? 'المدينة غير مسجلة'}
          </span>
        </div>
        <span className={styles.status}>
          <BadgeCheck size={16} aria-hidden />{' '}
          {ar(SUPPLIER_STATUS_AR, supplier.status)}
        </span>
      </header>

      <section className={styles.facts} aria-label="بيانات المنشأة">
        <article>
          <Building2 size={18} aria-hidden />
          <span>رقم التسجيل القانوني</span>
          <strong dir="ltr">{supplier.crNumber ?? 'غير مسجل'}</strong>
        </article>
        <article>
          <MapPin size={18} aria-hidden />
          <span>دولة التسجيل</span>
          <strong dir="ltr">{supplier.countryCode}</strong>
        </article>
        <article>
          <Phone size={18} aria-hidden />
          <span>جوال التواصل</span>
          <strong dir="ltr">{supplier.contactPhone}</strong>
        </article>
        <article>
          <Mail size={18} aria-hidden />
          <span>البريد</span>
          <strong dir="ltr">{supplier.contactEmail ?? 'غير مسجل'}</strong>
        </article>
        <article>
          <CalendarClock size={18} aria-hidden />
          <span>تاريخ الانضمام (بتوقيت الرياض)</span>
          <strong>{DATE_TIME.format(supplier.createdAt)}</strong>
        </article>
        <article>
          <ShieldCheck size={18} aria-hidden />
          <span>تقييم المورد</span>
          <strong>
            {supplier.score.toLocaleString('ar-SA')} /{' '}
            {(100).toLocaleString('ar-SA')}
          </strong>
        </article>
        <article>
          <BadgeCheck size={18} aria-hidden />
          <span>الالتزام بالموعد</span>
          <strong>
            {supplier.slaOnTimeRate == null
              ? 'لا توجد بيانات كافية'
              : Math.round(supplier.slaOnTimeRate * 100).toLocaleString(
                  'ar-SA',
                ) + '%'}
          </strong>
        </article>
      </section>

      <section className={styles.metrics} aria-label="ملخص النشاط">
        <article>
          <span>المخزون</span>
          <strong>{supplier._count.inventory.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>العروض</span>
          <strong>{supplier._count.quotes.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>الطلبات</span>
          <strong>{supplier._count.orders.toLocaleString('ar-SA')}</strong>
        </article>
        <article>
          <span>معدل الإرجاع</span>
          <strong>
            {Math.round(supplier.returnRate * 100).toLocaleString('ar-SA')}%
          </strong>
        </article>
      </section>

      <p className={styles.notice}>
        <ShieldCheck size={16} aria-hidden /> هذا العرض خاص بمنشأتك. لا يعرض
        بيانات عملاء أو موردين منافسين أو روابط مستندات داخلية.
      </p>

      <div className={styles.grid}>
        <section className={styles.panel}>
          <header>
            <UserRound size={20} aria-hidden />
            <h2>مستخدمو المنشأة</h2>
            <span>{supplier.users.length}</span>
          </header>
          {supplier.users.length ? (
            supplier.users.map((member) => (
              <article className={styles.row} key={member.id}>
                <strong>
                  {member.user.fullName ?? 'مستخدم المنشأة'}
                  {member.isOwner ? ' · المالك' : ''}
                </strong>
                <span>
                  {member.position ?? 'دور غير محدد'} ·{' '}
                  {member.user.isActive ? 'نشط' : 'غير نشط'}
                </span>
                <small dir="ltr">
                  {member.user.phone} · {member.user.email ?? 'لا يوجد بريد'}
                </small>
                <small>
                  آخر دخول:{' '}
                  {member.user.lastLoginAt
                    ? DATE_TIME.format(member.user.lastLoginAt)
                    : 'لم يسجل بعد'}
                </small>
              </article>
            ))
          ) : (
            <p className={styles.empty}>لا يوجد مستخدمون.</p>
          )}
        </section>

        <section className={styles.panel}>
          <header>
            <FileCheck2 size={20} aria-hidden />
            <h2>حالة المستندات</h2>
            <span>{supplier.documents.length}</span>
          </header>
          {supplier.documents.length ? (
            supplier.documents.map((document) => (
              <article className={styles.row} key={document.id}>
                <strong>{ar(DOCUMENT_TYPE_AR, document.type)}</strong>
                <span>
                  {ar(DOCUMENT_STATUS_AR, document.status, 'بانتظار التصنيف')}
                </span>
                <small>{DATE_TIME.format(document.createdAt)}</small>
              </article>
            ))
          ) : (
            <p className={styles.empty}>لا توجد مستندات مسجلة.</p>
          )}
          {/*
            كان الرفع معروضاً في مسار ما-قبل-الاعتماد وحده، فالمورد المعتمد لا
            يملك أي طريق لتجديد سجل منتهٍ أو استبدال وثيقة مرفوضة أو إضافة
            المطلوب بعد المراجعة — وهو يرى حالتها هنا ولا يستطيع فعل شيء
            حيالها. المسار الخلفي يقبله أصلاً: `/api/documents` لا يحجب إلا
            `REJECTED` و`SUSPENDED`، فالنقص كان في الواجهة وحدها.
          */}
          <div className={styles.upload}>
            <SupplierDocumentUpload />
          </div>
        </section>

        <section className={styles.panel + ' ' + styles.wide}>
          <header>
            <Warehouse size={20} aria-hidden />
            <h2>المستودعات</h2>
            <span>{supplier.warehouses.length}</span>
          </header>
          {supplier.warehouses.length ? (
            supplier.warehouses.map((warehouse) => (
              <article className={styles.row} key={warehouse.id}>
                <strong>
                  {warehouse.name}
                  {warehouse.isDefault ? ' · الافتراضي' : ''}
                </strong>
                <span>{warehouse.city}</span>
                <small>
                  {warehouse._count.inventory.toLocaleString('ar-SA')} صنف مخزون
                </small>
              </article>
            ))
          ) : (
            <p className={styles.empty}>لا توجد مستودعات مسجلة.</p>
          )}
        </section>
      </div>
    </div>
  );
}
