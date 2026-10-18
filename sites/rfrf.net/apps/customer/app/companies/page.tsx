import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { BrandLogo } from "@rafraf/ui/brand-logo";
import { companyCategory } from "../../lib/parts-companies";
import { SiteFooter } from "../site-footer";
import { CompanyDirectory } from "./company-directory";
import styles from "./companies.module.css";

export const metadata: Metadata = {
  title: "شركات قطع الغيار في السعودية — رفرف",
  description:
    "استكشف شركات قطع غيار السيارات والشاحنات والمعدات في السعودية وروابط مواقعها الرسمية.",
  alternates: { canonical: "/companies" },
};

export default async function CompaniesPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string | string[] }>;
}) {
  const category = companyCategory((await searchParams).category);
  return (
    <>
      <main className={styles.page} id="main-content">
        <header className={styles.header}>
          <Link href="/" aria-label="رفرف — الرئيسية">
            <BrandLogo />
          </Link>
          <Link href="/">
            <ArrowRight size={18} aria-hidden /> الرئيسية
          </Link>
        </header>
        <section className={styles.intro} aria-labelledby="companies-title">
          <p className={styles.eyebrow}>دليلك في السوق السعودي</p>
          <h1 id="companies-title">
            شركات قطع الغيار،
            <br />
            في مكان واحد.
          </h1>
          <p>
            سيارات، شاحنات، ومعدات. اختر المجال أو ابحث باسم الشركة أو علامة
            المركبة، ثم انتقل إلى موقعها الرسمي.
          </p>
        </section>
        <CompanyDirectory key={category} initialCategory={category} />
        <aside className={styles.help}>
          <div>
            <h2>عندك رقم قطعة أو صورة؟</h2>
            <p>ابدأ طلبك في رفرف وأضف تفاصيل المركبة لتوضيح احتياجك.</p>
          </div>
          <Link href="/chat">
            ابدأ طلب قطعة <ArrowRight size={18} aria-hidden />
          </Link>
        </aside>
        <p className={styles.note}>
          دليل استكشافي لمواقع الشركات الرسمية؛ لا يمثل مخزونًا متاحًا أو شراكة
          مع رفرف. آخر مراجعة للروابط: 18 أكتوبر 2026.
        </p>
      </main>
      <SiteFooter />
    </>
  );
}
